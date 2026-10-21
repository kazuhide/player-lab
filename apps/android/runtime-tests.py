#!/usr/bin/env python3
"""Run the public Android instrumented tests and retain raw output privately."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


APPLICATION_ID = "com.playerlab.android"
TEST_APPLICATION_ID = APPLICATION_ID + ".test"
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*(?:#[A-Za-z_][A-Za-z0-9_]*)?")


class RuntimeCheckFailure(Exception):
    pass


def instrumentation_result(text):
    """Require successful individual results and a completed runner, not adb exit 0."""
    current = {}
    results = []
    for line in text.splitlines():
        for key in ("class", "test"):
            prefix = f"INSTRUMENTATION_STATUS: {key}="
            if line.startswith(prefix):
                value = line[len(prefix):]
                current[key] = value if IDENTIFIER.fullmatch(value) else "invalid-identifier"
        if line.startswith("INSTRUMENTATION_STATUS_CODE:"):
            code = int(line.split(":", 1)[1].strip())
            if code != 1:
                results.append({**current, "statusCode": code})
            current = {}
    completed = "INSTRUMENTATION_CODE: -1" in text.splitlines()
    reported = re.search(r"^OK \((\d+) tests?\)$", text, re.MULTILINE)
    count_matches = reported is not None and int(reported.group(1)) == len(results)
    passed = bool(results) and completed and count_matches and all(
        result["statusCode"] == 0 for result in results
    )
    return {
        "result": "PASS" if passed else "FAIL",
        "runnerCompleted": completed,
        "reportedCountMatches": count_matches,
        "passed": sum(result["statusCode"] == 0 for result in results),
        "total": len(results),
        "tests": results,
    }


def private_run(command, path, *, cwd=None, timeout=900):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(path, 0o600)
    with os.fdopen(descriptor, "w") as output:
        return subprocess.run(command, cwd=cwd, stdout=output,
                              stderr=subprocess.STDOUT, timeout=timeout).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True, help="Explicitly owned adb device serial")
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="Private artifact directory outside the repository")
    parser.add_argument("--classes", help="Comma-separated public test classes or class#method")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--dummy-license", action="store_true",
                        help="Configuration-only checks; cannot qualify playback")
    args = parser.parse_args()
    if args.classes and not all(IDENTIFIER.fullmatch(value) for value in args.classes.split(",")):
        parser.error("Invalid test class selection")
    if args.dummy_license and args.skip_build:
        parser.error("--dummy-license must build the APK so its credential mode is known")
    android = Path(__file__).resolve().parent
    repository = android.parent.parent
    output = args.output_dir.resolve()
    if output.is_relative_to(repository):
        parser.error("Raw runtime artifacts must stay outside the repository")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    adb = str(Path(sdk) / "platform-tools/adb") if sdk else "adb"
    device = [adb, "-s", args.serial]
    summary = {"result": "FAIL", "applicationId": APPLICATION_ID,
               "testApplicationId": TEST_APPLICATION_ID,
               "credentialMode": "dummy" if args.dummy_license else "existing build configuration"}
    instrumenting = False
    try:
        if (private_run(device + ["get-state"], output / "device.log", timeout=15) != 0 or
                (output / "device.log").read_text().strip() != "device"):
            raise RuntimeCheckFailure("device-not-ready")
        if not args.skip_build:
            build = ["./gradlew", ":app:assembleDebug", ":app:assembleDebugAndroidTest",
                     "--no-daemon", "--max-workers=2", "-PbitmovinAnalyticsLicenseKey="]
            if args.dummy_license:
                build.append("-PbitmovinLicenseKey=dummy")
            if private_run(build, output / "build.log", cwd=android) != 0:
                raise RuntimeCheckFailure("build-failure")
        for name, apk in (
            ("app", android / "app/build/outputs/apk/debug/app-debug.apk"),
            ("test", android / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"),
        ):
            if private_run(device + ["install", "-r", "-t", str(apk)], output / (name + "-install.log")) != 0:
                raise RuntimeCheckFailure("install-failure")
        command = device + ["shell", "am", "instrument", "-w", "-r"]
        if args.classes:
            command += ["-e", "class", args.classes]
        command.append(TEST_APPLICATION_ID + "/androidx.test.runner.AndroidJUnitRunner")
        instrumenting = True
        code = private_run(command, output / "instrumentation.log")
        summary.update(instrumentation_result((output / "instrumentation.log").read_text()))
        summary["adbExitCode"] = code
        if code != 0:
            summary.update(result="FAIL", reason="adb-failure")
    except RuntimeCheckFailure as failure:
        summary["reason"] = str(failure)
    except subprocess.TimeoutExpired:
        summary["reason"] = "timeout"
    except (OSError, ValueError):
        # Detailed exceptions can include local paths; the private logs retain command output.
        summary["reason"] = "runtime-command-failure"
    finally:
        if instrumenting:
            for package in (TEST_APPLICATION_ID, APPLICATION_ID):
                try:
                    subprocess.run(device + ["shell", "am", "force-stop", package],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
                except (OSError, subprocess.TimeoutExpired):
                    summary.update(result="FAIL", reason="cleanup-failure")
        descriptor = os.open(output / "summary.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.chmod(output / "summary.json", 0o600)
        with os.fdopen(descriptor, "w") as receipt:
            json.dump(summary, receipt, indent=2)
            receipt.write("\n")
        print(json.dumps(summary, indent=2))
    return 0 if summary["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
