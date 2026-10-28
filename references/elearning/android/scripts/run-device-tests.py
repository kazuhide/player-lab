#!/usr/bin/env python3
"""Run the owned Android reference tests on one explicitly selected, already running device."""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
from urllib.parse import urlsplit
import uuid

APP_ID = "com.playerlab.elearning"
COMPONENT = f"{APP_ID}.test/androidx.test.runner.AndroidJUnitRunner"
ROOT = Path(__file__).resolve().parents[1]


@dataclass
class TestResult:
    name: str
    command_exit: int
    instrumentation_exit: int | None
    expected: int
    started: int
    passed: int
    failed: int
    skipped: int
    success: bool


def test_result(name: str, exit_code: int, output: str, expected: int) -> TestResult:
    codes = [int(code) for code in re.findall(r"^INSTRUMENTATION_STATUS_CODE:\s*(-?\d+)\s*$", output, re.MULTILINE)]
    finish = re.findall(r"^INSTRUMENTATION_CODE:\s*(-?\d+)\s*$", output, re.MULTILINE)
    totals = [int(value) for value in re.findall(r"^INSTRUMENTATION_STATUS:\s*numtests=(\d+)\s*$", output, re.MULTILINE)]
    started, passed = codes.count(1), codes.count(0)
    failed = sum(code in (-1, -2) for code in codes)
    skipped = sum(code in (-3, -4) for code in codes)
    instrumentation_exit = int(finish[-1]) if len(finish) == 1 else None
    success = (exit_code == 0 and instrumentation_exit == -1 and totals and set(totals) == {expected}
               and started == passed == expected and failed == skipped == 0
               and not re.search(r"INSTRUMENTATION_FAILED:|FAILURES!!!|Process crashed", output))
    return TestResult(name, exit_code, instrumentation_exit, expected, started, passed, failed, skipped, bool(success))


class Commands:
    def __init__(self, directory: Path):
        self.directory = directory
        self.index = 0

    def run(self, name: str, command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
        self.index += 1
        log = self.directory / f"{self.index:02d}-{name}.log"
        print(f"Running {name}", flush=True)
        try:
            result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
            log.write_text(result.stdout, encoding="utf-8")
            return result
        except subprocess.TimeoutExpired as error:
            output = error.output or ""
            log.write_text(output.decode(errors="replace") if isinstance(output, bytes) else output, encoding="utf-8")
            raise RuntimeError(f"{name} exceeded {timeout} seconds; private log: {log.name}") from error


class DeviceRun:
    def __init__(self, args: argparse.Namespace, commands: Commands):
        self.args, self.commands = args, commands
        self.results: list[TestResult] = []
        self.prefix = [args.adb] + (["-P", str(args.server_port)] if args.server_port else []) + ["-s", args.serial]
        self.app_apk = ROOT / "app/build/outputs/apk/debug/app-debug.apk"
        self.test_apk = ROOT / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"

    def call(self, name: str, parts: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
        result = self.commands.run(name, self.prefix + parts, timeout)
        if result.returncode:
            raise RuntimeError(f"{name} failed (command exit {result.returncode})")
        return result

    def force_stop(self, name: str) -> None:
        self.call(name, ["shell", shlex.join(["am", "force-stop", APP_ID])])

    def instrument(self, name: str, class_name: str, expected: int, format_name: str, **extra: str) -> None:
        base = self.args.media_base_url
        source = base + ("EDU-FX-01/dash/manifest.mpd" if format_name == "dash" else "EDU-FX-01/hls/media.m3u8")
        arguments = {"class": f"{APP_ID}.{class_name}", "mediaBaseUrl": base, "streamFormat": format_name,
                     "sourceUrl": source, "subtitleUrl": base + "subtitles/EDU-FX-01.en.vtt", **extra}
        remote = ["am", "instrument", "-w", "-r", "--no-window-animation"]
        for key, value in arguments.items():
            remote += ["-e", key, value]
        remote.append(COMPONENT)
        result = self.commands.run(name, self.prefix + ["shell", shlex.join(remote)], self.args.timeout_seconds)
        record = test_result(name, result.returncode, result.stdout, expected)
        self.results.append(record)
        print(f"{name}: tests={record.started}, passed={record.passed}, failed={record.failed}, skipped={record.skipped}, "
              f"command_exit={record.command_exit}, instrumentation_exit={record.instrumentation_exit}", flush=True)
        if not record.success:
            raise RuntimeError(f"{name} did not execute and pass all {expected} expected tests")

    def suite(self) -> None:
        state = self.call("device-state", ["get-state"], 15)
        state_lines = [line.strip() for line in state.stdout.splitlines() if line.strip()]
        if not state_lines or state_lines[-1] != "device":
            raise RuntimeError("The explicitly selected device is not ready")
        self.call("install-app", ["install", "-r", str(self.app_apk)], 120)
        self.call("install-tests", ["install", "-r", str(self.test_apk)], 120)
        formats = ("hls", "dash") if self.args.stream_format == "both" else (self.args.stream_format,)
        for format_name in formats:
            self.instrument(f"core-{format_name}", "CoreLearningTest", 6, format_name)
            self.instrument(f"ownership-{format_name}", "UiOwnershipTest", 3, format_name)
            self.instrument(f"mandatory-{format_name}", "MandatoryBehaviorTest", 6, format_name)
            self.instrument(f"checkpoint-prepare-{format_name}", "ProcessDeathCheckpointTest", 1, format_name, processDeathPhase="prepare")
            self.force_stop(f"checkpoint-external-force-stop-{format_name}")
            self.instrument(f"checkpoint-verify-{format_name}", "ProcessDeathCheckpointTest", 1, format_name, processDeathPhase="verify")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True, help="Exact ADB serial; the script never chooses a device")
    parser.add_argument("--media-base-url", required=True, help="Owned fixture server directory URL, with a trailing slash")
    parser.add_argument("--adb", default="adb", help="ADB-compatible executable")
    parser.add_argument("--server-port", type=int)
    parser.add_argument("--stream-format", choices=("hls", "dash", "both"), default="both")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=300, help="Bound per instrumentation invocation (default: 300)")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", args.serial):
        parser.error("Use an exact ADB serial without whitespace or shell syntax")
    media = urlsplit(args.media_base_url)
    if (media.scheme not in ("http", "https") or not media.hostname or media.username is not None or media.password is not None
            or media.query or media.fragment or not media.path.endswith("/") or any(char.isspace() for char in args.media_base_url)):
        parser.error("Media base must be an HTTP(S) directory URL without credentials, query or fragment")
    if args.server_port is not None and not 1 <= args.server_port <= 65535:
        parser.error("Server port must be in 1..65535")
    if not 30 <= args.timeout_seconds <= 900:
        parser.error("Instrumentation timeout must be in 30..900 seconds")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    directory = ROOT / "build/device-tests" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, exist_ok=False)
    commands = Commands(directory)
    device = DeviceRun(args, commands)
    failure = None
    hashes = {}
    try:
        if not args.skip_build:
            result = commands.run("build", [str(ROOT / "gradlew"), ":app:assembleDebug", ":app:assembleDebugAndroidTest", ":app:testDebugUnitTest", ":app:lintDebug", "--console=plain"], 900)
            if result.returncode:
                raise RuntimeError(f"Build failed (exit {result.returncode})")
        result = commands.run("junit-signatures", [sys.executable, str(ROOT / "scripts/check_junit_signatures.py")], 90)
        if result.returncode:
            raise RuntimeError("JUnit test method signatures are invalid; see the private preflight log")
        artifacts = directory / "artifacts"
        artifacts.mkdir()
        frozen = []
        for path in (device.app_apk, device.test_apk):
            before = sha256(path)
            copy = artifacts / path.name
            shutil.copyfile(path, copy)
            if before != sha256(path) or before != sha256(copy):
                raise RuntimeError("An APK changed during snapshot; finish the other build before retrying")
            hashes[path.name] = before
            frozen.append(copy)
        device.app_apk, device.test_apk = frozen
        device.suite()
    except KeyboardInterrupt:
        failure = "Interrupted; only this reference app will be force-stopped"
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        failure = str(error)
    finally:
        try:
            device.force_stop("final-own-app-force-stop")
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            failure = failure or f"Own-app cleanup failed: {error}"
    summary = {"success": failure is None, "error": failure, "deviceSerial": args.serial, "adbExecutable": args.adb,
               "adbServerPort": args.server_port, "mediaBaseUrl": args.media_base_url, "apkSha256": hashes,
               "results": [asdict(result) for result in device.results]}
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"{'PASS' if failure is None else 'FAIL'}: {sum(result.passed for result in device.results)} tests passed; private logs: {directory}")
    if failure:
        print(failure, file=sys.stderr)
    return 0 if failure is None else 1


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
