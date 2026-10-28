#!/usr/bin/env python3
"""Run this reference's APKs on one explicitly selected Android device."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

PACKAGE = "com.playerlab.sportsstreaming"
RUNNER = PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner"
ANDROID = Path(__file__).resolve().parents[1]


def sanitize(text: str) -> str:
    def url(match: re.Match[str]) -> str:
        try:
            parsed = urllib.parse.urlsplit(match.group())
            host = parsed.hostname or "redacted"
            if parsed.port:
                host += f":{parsed.port}"
            return urllib.parse.urlunsplit((parsed.scheme, host, parsed.path, "", ""))
        except ValueError:
            return "[redacted-url]"
    text = re.sub(r"https?://[^\s\"'<>]+", url, text)
    text = re.sub(r"(?i)(authorization|x-api-key|licenseKey|token|password)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text)
    return re.sub(r"\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b", "[redacted-id]", text)


def media_base(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise argparse.ArgumentTypeError("Use an HTTP(S) media base URL without credentials, query or fragment")
    return value.rstrip("/") + "/"


def shell_command(parts: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in parts)


def instrumentation_result(output: str, expected_class: str | None = None,
                           expected_tests: int | None = None) -> dict:
    """Count identified JUnit status blocks, never arbitrary sendStatus diagnostics."""
    started: set[tuple[str, str]] = set()
    completed: set[tuple[str, str]] = set()
    counts = {"passedTests": 0, "failedTests": 0, "erroredTests": 0, "skippedTests": 0}
    diagnostics = 0
    problems: list[str] = []
    block: dict[str, str] = {}
    for line in output.splitlines():
        if match := re.fullmatch(r"INSTRUMENTATION_STATUS: ([^=]+)=(.*)", line):
            block[match.group(1)] = match.group(2)
        elif match := re.fullmatch(r"INSTRUMENTATION_STATUS_CODE: (-?\d+)", line):
            code = int(match.group(1))
            status, block = block, {}
            if not any(key in status for key in ("class", "test", "id")):
                diagnostics += 1
                continue
            if status.get("id") != "AndroidJUnitRunner" or not status.get("class") or not status.get("test"):
                problems.append("Incomplete JUnit test identity")
                continue
            identity = status["class"], status["test"]
            if expected_class is not None and identity[0] != expected_class:
                problems.append("Unexpected JUnit class")
            if expected_tests is not None and status.get("numtests") != str(expected_tests):
                problems.append("Unexpected declared test count")
            if code == 1:
                if identity in started:
                    problems.append("Duplicate test start")
                started.add(identity)
            elif code in (0, -1, -2, -3, -4):
                if identity not in started or identity in completed:
                    problems.append("Unstarted or duplicate test completion")
                completed.add(identity)
                field = {0: "passedTests", -1: "erroredTests", -2: "failedTests",
                         -3: "skippedTests", -4: "skippedTests"}[code]
                counts[field] += 1
            else:
                problems.append("Unknown JUnit status code")
    summaries = [int(value) for value in re.findall(r"\bOK \((\d+) tests?\)", output)]
    exits = [int(value) for value in re.findall(r"^INSTRUMENTATION_CODE: (-?\d+)$", output, re.MULTILINE)]
    expected = expected_tests if expected_tests is not None else (summaries[0] if len(summaries) == 1 else None)
    if block:
        problems.append("Unterminated status block")
    if expected is None or expected < 1 or len(summaries) != 1 or summaries[0] != expected:
        problems.append("Missing or inconsistent success summary")
    if len(started) != expected or len(completed) != expected or started != completed or counts["passedTests"] != expected:
        problems.append("Start and successful completion counts do not match")
    if counts["failedTests"] or counts["erroredTests"] or counts["skippedTests"]:
        problems.append("A test failed, errored, or was skipped")
    if exits != [-1]:
        problems.append("Runner did not exit normally exactly once")
    if any(marker in output for marker in ("FAILURES!!!", "INSTRUMENTATION_FAILED", "Process crashed")):
        problems.append("Instrumentation reported failure")
    return {"passed": not problems, "started": len(started), "completed": len(completed), **counts,
            "diagnosticBlocks": diagnostics, "runnerExitCode": exits[0] if len(exits) == 1 else None,
            "summaryTests": summaries[0] if len(summaries) == 1 else None, "problems": problems}


def successful_instrumentation(output: str, expected_class: str | None = None,
                               expected_tests: int | None = None) -> bool:
    return instrumentation_result(output, expected_class, expected_tests)["passed"]


def active_install_sessions(output: str, package: str) -> list[int]:
    section = re.search(r"(?ms)^\s*Active install sessions:[^\n]*\n(.*?)(?=^\s*(?:Finalized|Historical|Legacy) install sessions:|\Z)", output)
    if not section:
        raise RuntimeError("Package installer state is unavailable")
    active = section.group(1).strip()
    if not active:
        return []
    blocks = re.split(r"(?m)^\s*Session\s+(\d+):", active)
    if len(blocks) == 1 or blocks[0].strip():
        raise RuntimeError("Unrecognized active installer state")
    own = []
    for index in range(1, len(blocks), 2):
        identity = re.search(r"(?:^|\s)(?:appPackageName|mPackageName|packageName)\s*=\s*(\S+)", blocks[index + 1])
        if not identity or identity.group(1) == "null":
            raise RuntimeError("An active installer session cannot be identified safely")
        if identity.group(1).rstrip(",;") == package:
            own.append(int(blocks[index]))
    return own


def ensure_installed(device: Device, apk: Path, package: str, expected_sha: str) -> dict[str, str]:
    installed_sha = device.installed_apk_sha256(package)
    if installed_sha == expected_sha:
        return {"package": package, "method": "verified-existing", "installedSha256": installed_sha}
    result = device.command("install", "-r", "-t", str(apk.resolve()), timeout=120)
    if result.returncode or "Success" not in result.stdout:
        raise RuntimeError("Targeted APK installation failed")
    installed_sha = device.installed_apk_sha256(package)
    if installed_sha != expected_sha:
        raise RuntimeError("Installed APK bytes do not match the requested artifact")
    return {"package": package, "method": "installed", "installedSha256": installed_sha}


def find_aapt2(explicit: str | None) -> str:
    if explicit:
        return explicit
    if executable := shutil.which("aapt2"):
        return executable
    roots = [os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
             str(Path.home() / "Library/Android/sdk"), str(Path.home() / "Android/Sdk")]
    for root in filter(None, roots):
        candidates = sorted(Path(root).glob("build-tools/*/aapt2"), reverse=True)
        if candidates:
            return str(candidates[0])
    raise RuntimeError("Set ANDROID_HOME or pass --aapt2 from Android SDK build tools")


def check_apk(apk: Path, expected: str, aapt2: str) -> dict[str, str | int]:
    if not apk.is_file():
        raise RuntimeError(f"Build the missing APK first: {apk.name}")
    result = subprocess.run([aapt2, "dump", "badging", str(apk)], text=True, capture_output=True, timeout=30)
    match = re.search(r"^package: name='([^']+)'", result.stdout, re.MULTILINE)
    if result.returncode or not match or match.group(1) != expected:
        raise RuntimeError(f"APK does not declare the required package {expected}")
    with apk.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"package": expected, "sha256": digest, "bytes": apk.stat().st_size}


class Device:
    def __init__(self, adb: str, port: int, serial: str):
        self.prefix = [adb, "-P", str(port), "-s", serial]

    def command(self, *parts: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        return subprocess.run(self.prefix + list(parts), text=True, capture_output=True, timeout=timeout)

    def shell(self, *parts: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        return self.command("shell", shell_command(list(parts)), timeout=timeout)

    def installed_apk_sha256(self, package: str) -> str | None:
        if package not in {PACKAGE, PACKAGE + ".test"}:
            raise ValueError("Only this reference's app and test APK may be inspected")
        result = self.shell("pm", "path", package)
        paths = [line.removeprefix("package:").strip() for line in result.stdout.splitlines() if line.startswith("package:")]
        if not paths:
            return None
        if result.returncode or len(paths) != 1 or not paths[0].startswith("/") or not paths[0].endswith("/base.apk"):
            raise RuntimeError("Expected one installed base APK; split APKs are not supported by this driver")
        result = self.shell("sha256sum", paths[0])
        digest = re.match(r"([a-fA-F0-9]{64})\s", result.stdout)
        if result.returncode or not digest:
            raise RuntimeError("The installed APK digest could not be verified")
        return digest.group(1).lower()

    def pending_install_sessions(self, package: str) -> list[int]:
        if package not in {PACKAGE, PACKAGE + ".test"}:
            raise ValueError("Only this reference's installer state may be inspected")
        result = self.shell("dumpsys", "package", "installs", package)
        if result.returncode:
            raise RuntimeError("The owned package's installer state could not be inspected")
        return active_install_sessions(result.stdout, package)

    def read_app_file(self, path: str) -> bytes:
        if not re.fullmatch(r"files/(?:captures|endurance)/[A-Za-z0-9_.-]{1,100}\.(?:png|json)", path):
            raise ValueError("Only this app's capture and endurance artifacts can be retrieved")
        remote = shell_command(["run-as", PACKAGE, "cat", path])
        result = subprocess.run(self.prefix + ["exec-out", remote], capture_output=True, timeout=30)
        if result.returncode and b"unknown command exec-out" in (result.stdout + result.stderr).lower():
            # VDA supports raw non-terminal shell output, but not ADB's exec-out command.
            result = subprocess.run(self.prefix + ["shell", "-T", remote], capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError("The owned app artifact could not be retrieved")
        return result.stdout


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True, help="Exact device serial; no device is selected automatically")
    parser.add_argument("--media-base-url", required=True, type=media_base)
    parser.add_argument("--adb", default=shutil.which("adb") or "adb", help="Use the client matching the selected ADB server")
    parser.add_argument("--adb-port", type=int, default=5037)
    parser.add_argument("--aapt2")
    parser.add_argument("--app-apk", type=Path, default=ANDROID / "app/build/outputs/apk/debug/app-debug.apk")
    parser.add_argument("--test-apk", type=Path, default=ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk")
    parser.add_argument("--protocol", choices=("hls", "dash", "both"), default="both")
    parser.add_argument("--asset-id", default="SP-CLIP-A", help="VOD fixture for ownership checks")
    parser.add_argument("--cast-receiver", help="Exact, explicitly authorized Cast display name; otherwise Cast is not run")
    parser.add_argument("--captures", action="store_true", help="Capture actual English and Japanese app content")
    parser.add_argument("--orientation", choices=("portrait", "landscape", "both"), default="portrait")
    parser.add_argument("--font-scale", type=float, default=1.0)
    parser.add_argument("--capture-method", choices=("pixel-copy", "display"), default="pixel-copy",
                        help="Native window copy, or composited display pixels for separate SurfaceView video layers")
    parser.add_argument("--output", type=Path, default=ANDROID / "build/device-tests" / dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", args.serial):
        parser.error("Invalid device serial")
    if not 1 <= args.adb_port <= 65535 or not 0.85 <= args.font_scale <= 2.0:
        parser.error("Invalid ADB port or font scale")
    if args.cast_receiver and (not args.cast_receiver.strip() or len(args.cast_receiver) > 100 or any(ord(c) < 32 for c in args.cast_receiver)):
        parser.error("Invalid receiver display name")
    if args.cast_receiver and not args.media_base_url.startswith("https://"):
        parser.error("Use receiver-reachable HTTPS media for the Cast test")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    receipt: dict = {"schemaVersion": 1, "startedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                     "deviceIdSha256": hashlib.sha256(args.serial.encode()).hexdigest(), "adbPort": args.adb_port,
                     "driverSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "runs": []}
    device = Device(args.adb, args.adb_port, args.serial)
    result_code = 1
    try:
        aapt2 = find_aapt2(args.aapt2)
        receipt["appApk"] = check_apk(args.app_apk.resolve(), PACKAGE, aapt2)
        receipt["testApk"] = check_apk(args.test_apk.resolve(), PACKAGE + ".test", aapt2)
        state = device.command("get-state")
        if state.returncode or state.stdout.strip() != "device":
            raise RuntimeError("The explicitly selected device is not ready")
        receipt["model"] = device.shell("getprop", "ro.product.model").stdout.strip()
        receipt["androidApi"] = device.shell("getprop", "ro.build.version.sdk").stdout.strip()
        stopped = device.shell("am", "force-stop", PACKAGE)
        if stopped.returncode:
            raise RuntimeError("The owned app could not be stopped before checking installed bytes")
        receipt["pendingInstallSessions"] = {}
        for package in (PACKAGE, PACKAGE + ".test"):
            pending = device.pending_install_sessions(package)
            receipt["pendingInstallSessions"][package] = pending
            if pending:
                raise RuntimeError("An owned APK install is still pending; no test was started")
        receipt["installations"] = []
        for apk, package, key in ((args.app_apk, PACKAGE, "appApk"), (args.test_apk, PACKAGE + ".test", "testApk")):
            receipt["installations"].append(ensure_installed(device, apk, package, receipt[key]["sha256"]))
        for package in (PACKAGE, PACKAGE + ".test"):
            if device.pending_install_sessions(package):
                raise RuntimeError("An owned installer session is still active after installation")
        with urllib.request.urlopen(urllib.parse.urljoin(args.media_base_url, "catalog.json"), timeout=10) as response:
            payload = response.read(512 * 1024 + 1)
            if len(payload) > 512 * 1024:
                raise RuntimeError("Catalog exceeds 512 KiB")
            catalog = json.loads(payload)
        asset = next((asset for asset in catalog["assets"] if asset["id"] == args.asset_id), None)
        if asset is None or asset.get("kind") == "live":
            raise RuntimeError("Select an existing VOD asset for ownership tests")
        protocols = ("hls", "dash") if args.protocol == "both" else (args.protocol,)
        for protocol in protocols:
            source = urllib.parse.urljoin(args.media_base_url, asset["streams"][protocol])
            caption = next((track for track in asset.get("subtitleTracks", []) if track.get("language") == "en"), None)
            if caption is None:
                raise RuntimeError("English subtitle fixture is required for the complete ownership check")
            subtitle = urllib.parse.urljoin(args.media_base_url, caption["url"])
            classes = [("PlayerOwnershipTest", {"sourceUrl": source, "subtitleUrl": subtitle}), ("SportsWorkflowTest", {})]
            if args.cast_receiver:
                classes.append(("CastPlaybackTest", {"receiverName": args.cast_receiver}))
            else:
                receipt["cast"] = {"status": "not-run", "reason": "No explicitly authorized receiver was supplied"}
            if args.captures:
                orientations = ("portrait", "landscape") if args.orientation == "both" else (args.orientation,)
                for language in ("en", "ja"):
                    for orientation in orientations:
                        for mode in ("standard", "sports"):
                            name = f"{protocol}-{language}-{orientation}-{mode}"
                            classes.append(("SportsScreenCaptureTest", {"locale": language, "orientation": orientation,
                                "uiMode": mode, "captureName": name, "assetId": args.asset_id, "fontScale": str(args.font_scale),
                                "captureMethod": args.capture_method}))
            for test_class, options in classes:
                name = options.get("captureName", f"{protocol}-{test_class}")
                print(f"Running {name} on the explicitly selected device", flush=True)
                parts = ["am", "instrument", "-w", "-r", "-e", "class", PACKAGE + "." + test_class,
                         "-e", "mediaBaseUrl", args.media_base_url, "-e", "protocol", protocol.upper()]
                for key, value in options.items():
                    parts.extend(("-e", key, value))
                stopped = device.shell("am", "force-stop", PACKAGE)
                if stopped.returncode:
                    raise RuntimeError("The owned app could not be reset before instrumentation")
                run = device.shell(*parts, RUNNER, timeout=900)
                transcript = sanitize(run.stdout + run.stderr)
                (output / f"{name}.log").write_text(transcript)
                expected_count = 3 if test_class == "PlayerOwnershipTest" else 1
                result = instrumentation_result(run.stdout, PACKAGE + "." + test_class, expected_count)
                passed = run.returncode == 0 and result["passed"]
                receipt["runs"].append({"name": name, "class": test_class, "protocol": protocol,
                                        "status": "passed" if passed else "failed", "exitCode": run.returncode,
                                        "instrumentation": result})
                if not passed:
                    raise RuntimeError(f"Instrumentation failed: {name}; inspect the sanitized log")
                if test_class == "SportsScreenCaptureTest":
                    for suffix in ("png", "json"):
                        contents = device.read_app_file(f"files/captures/{name}.{suffix}")
                        if suffix == "png" and (not contents.startswith(b"\x89PNG\r\n\x1a\n") or
                                                not contents.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82")):
                            raise RuntimeError("Capture transfer did not preserve a complete PNG")
                        if suffix == "json":
                            metadata = json.loads(contents)
                            if (metadata.get("protocol") != protocol.upper() or metadata.get("assetId") != args.asset_id or
                                metadata.get("locale") != options["locale"] or metadata.get("orientation") != options["orientation"]):
                                raise RuntimeError("Capture metadata does not match the requested viewport")
                        (output / f"{name}.{suffix}").write_bytes(contents)
        result_code = 0
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        receipt["error"] = sanitize(str(error))
        print(receipt["error"], file=sys.stderr)
    finally:
        receipt["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
        receipt["status"] = "passed" if result_code == 0 else "failed"
        (output / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        print(f"Receipt: {output / 'receipt.json'}", flush=True)
    return result_code


if __name__ == "__main__":
    raise SystemExit(main())
