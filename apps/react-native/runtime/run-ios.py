#!/usr/bin/env python3
"""Run public XCTest gestures against an already-built Expo runtime-check entry."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

from report import configuration_stages, playback_samples, validate_report


def command(args, cwd=None, log=None, timeout=300):
    with open(log, "ab") if log else open(os.devnull, "wb") as output:
        result = subprocess.run(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Native tool failed; inspect the private local log")


def capture(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    if result.returncode or len(result.stdout) > 4 * 1024 * 1024:
        raise RuntimeError("Native tool did not return a bounded result")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="An already-booted, dedicated iOS simulator UDID")
    parser.add_argument("--media-url", required=True, help="The public/local 60-second HLS fixture, without credentials or a query")
    parser.add_argument("--output", required=True, type=Path, help="A new private directory outside the checkout")
    parser.add_argument("--subtitle-url", help="Run the external-WebVTT GUI/menu scenario instead of the configuration scenario")
    args = parser.parse_args()
    url = urlsplit(args.media_url)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or len(args.media_url) > 512:
        parser.error("Use a credential-free HTTP(S) fixture URL without query/fragment")
    if args.subtitle_url:
        subtitle = urlsplit(args.subtitle_url)
        if subtitle.scheme not in {"http", "https"} or not subtitle.hostname or subtitle.username or subtitle.password or subtitle.query or subtitle.fragment or len(args.subtitle_url) > 512:
            parser.error("Use a credential-free HTTP(S) WebVTT URL without query/fragment")
    root = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    if output.exists() or output == root or root in output.parents:
        parser.error("Output must be a new directory outside the checkout")
    os.umask(0o077)
    output.mkdir(parents=True)
    status = {"schemaVersion": 1, "platform": "ios", "passed": False}
    try:
        driver = output / "driver"
        shutil.copytree(Path(__file__).with_name("ios"), driver)
        command(["xcodegen", "generate"], cwd=driver, log=output / "build.private.log")
        derived = output / "derived-data"
        command(["xcodebuild", "-project", str(driver / "PlayerLabRuntime.xcodeproj"), "-scheme", "RuntimeChecks",
                 "-destination", "platform=iOS Simulator,id=" + args.device, "-derivedDataPath", str(derived),
                 "-parallel-testing-enabled", "NO", "CODE_SIGNING_ALLOWED=NO", "build-for-testing"], log=output / "build.private.log")
        runs = list((derived / "Build/Products").glob("*.xctestrun"))
        if len(runs) != 1:
            raise RuntimeError("Expected one generated XCTest configuration")
        data = plistlib.loads(runs[0].read_bytes())
        for name, target in data.items():
            if name != "__xctestrun_metadata__":
                target.setdefault("EnvironmentVariables", {})["PLAYER_LAB_MEDIA_URL"] = args.media_url
                if args.subtitle_url:
                    target["EnvironmentVariables"]["PLAYER_LAB_SUBTITLE_URL"] = args.subtitle_url
        runs[0].write_bytes(plistlib.dumps(data))
        result_path = output / "Runtime.xcresult"
        case = "testExternalSubtitleConfigurationAndMenu" if args.subtitle_url else "testNormalConfigurationPlaybackAndCleanup"
        command(["xcodebuild", "test-without-building", "-xctestrun", str(runs[0]), "-destination", "platform=iOS Simulator,id=" + args.device,
                 "-resultBundlePath", str(result_path), "-parallel-testing-enabled", "NO", "-collect-test-diagnostics", "never",
                 "-only-testing:RuntimeChecks/RuntimeChecks/" + case],
                log=output / "test.private.log", timeout=600)
        summary = json.loads(capture(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result_path), "--format", "json"]))
        if summary.get("result") != "Passed" or summary.get("passedTests") != 1 or summary.get("failedTests") != 0:
            raise RuntimeError("Finalized XCTest result did not pass exactly one test")
        container = Path(capture(["xcrun", "simctl", "get_app_container", args.device, "com.playerlab.runtimechecks.xctrunner", "data"]).decode().strip())
        receipt = json.loads((container / "Documents/runtime-report.json").read_text())
        if receipt.get("passed") is not True or receipt.get("assertionFailures") != 0:
            raise RuntimeError("Normal GUI runtime receipt did not pass")
        for stage in receipt["stages"]:
            playback_samples(stage["samples"])
        if not args.subtitle_url:
            configuration_stages(receipt["stages"])
        validate_report(receipt["final"])
        (output / "runtime-report.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        status.update(passed=True, finalizedTestsPassed=1, finalizedTestsFailed=0, stages=len(receipt["stages"]),
                      wrapperDestroyFlagsConfirmed=receipt["wrapperDestroyFlagsConfirmed"], nativeReleaseAcknowledgementAvailable=False)
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError, OSError):
        status["failure"] = "Runtime qualification failed; private local evidence is retained"
    finally:
        cleanup_requested = True
        for bundle in ["com.playerlab.reactnative", "com.playerlab.runtimechecks.xctrunner", "com.playerlab.runtime-driver"]:
            try:
                # A nonzero status also covers an application already stopped by XCTest teardown.
                subprocess.run(["xcrun", "simctl", "terminate", args.device, bundle], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
            except (subprocess.TimeoutExpired, OSError):
                cleanup_requested = False
        status["targetApplicationsStopRequested"] = cleanup_requested
        if not cleanup_requested:
            status.update(passed=False, failure="Dedicated target cleanup could not be requested")
        (output / "status.json").write_text(json.dumps(status, indent=2, sort_keys=True) + "\n")
    print(json.dumps(status, sort_keys=True))
    return 0 if status["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
