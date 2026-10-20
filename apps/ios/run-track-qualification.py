#!/usr/bin/env python3
"""Run the licensed Apple track/scaling checks using only public app/test sources."""

import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import threading
from urllib.parse import unquote, urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=["ios", "tvos"], required=True)
    parser.add_argument("--destination", required=True, help="The simulator UDID owned by this run")
    parser.add_argument("--media-dir", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True, help="A new private output directory")
    parser.add_argument("--derived-data", type=Path)
    parser.add_argument("--source-packages", type=Path)
    parser.add_argument("--expected-audio", default="de", help="Use en as the documented negative control")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--ui-only", action="store_true")
    selection.add_argument("--sdk-only", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    ios = root / "apps/ios"
    media = args.media_dir.resolve(strict=True)
    master = media / "vod-multiaudio/master.m3u8"
    if not master.is_file() or 'TYPE=SUBTITLES' not in master.read_text():
        parser.error("Generate the native-subtitle vod-multiaudio HLS fixture first")
    if not (ios / "Local.xcconfig").is_file():
        parser.error("Materialize the normal app license configuration before running")
    output = args.artifacts.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    derived = (args.derived_data or output / "DerivedData").resolve()
    os.umask(0o077)

    class MediaHandler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          ".m3u8": "application/vnd.apple.mpegurl", ".m4s": "video/iso.segment",
                          ".vtt": "text/vtt", ".mpd": "application/dash+xml"}

        def __init__(self, *values, **kwargs):
            super().__init__(*values, directory=str(media), **kwargs)

        def send_head(self):
            route = unquote(urlsplit(self.path).path)
            parts = Path(route.lstrip("/")).parts
            target = media.joinpath(*parts)
            if (any(part.startswith(".") for part in parts)
                    or not target.resolve().is_relative_to(media)
                    or any(media.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts) + 1))
                    or not target.is_file()):
                self.send_error(404)
                return None
            return super().send_head()

        def log_message(self, *_):
            pass

        def copyfile(self, source, destination):
            try:
                super().copyfile(source, destination)
            except (BrokenPipeError, ConnectionResetError):
                # The player can cancel a segment when switching or retiring a source.
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), MediaHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    platform = "iOS" if args.platform == "ios" else "tvOS"
    scheme = f"Showcase-{platform}-TrackQualification"
    common = ["xcodebuild", "-project", "Showcase.xcodeproj", "-scheme", scheme,
              "-configuration", "Debug", "-destination", f"id={args.destination}",
              "-derivedDataPath", str(derived), "-jobs", "2", "-parallel-testing-enabled", "NO",
              "CODE_SIGNING_ALLOWED=NO"]
    if args.source_packages:
        common += ["-clonedSourcePackagesDirPath", str(args.source_packages.resolve())]

    def run(command, name):
        with (output / f"{name}-private.log").open("w") as log:
            return subprocess.run(command, cwd=ios, stdout=log, stderr=subprocess.STDOUT).returncode

    def source_hashes():
        files = [ios / "project.yml", ios / "Showcase/Info.plist", Path(__file__).resolve()]
        for folder in ["Showcase", "ShowcaseTrackRuntimeTests", "ShowcaseConfigurationUITests"]:
            files.extend((ios / folder).glob("*.swift"))
        return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(files)}

    report = {"platform": args.platform, "expectedTests": 1 if args.ui_only or args.sdk_only else 2,
              "expectedAudio": args.expected_audio,
              "sourceRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
              "workingTreeDirty": bool(subprocess.check_output(
                  ["git", "status", "--porcelain", "--", "apps/ios"], cwd=root, text=True)),
              "sourceInputSha256": source_hashes(),
              "fixtureMasterSha256": hashlib.sha256(master.read_bytes()).hexdigest()}
    selected = None
    try:
        report["projectGenerationExit"] = run(["xcodegen", "generate", "--spec", "project.yml"], "project")
        if report["projectGenerationExit"] != 0:
            return 1
        report["buildExit"] = run(common + ["build-for-testing"], "build")
        if report["buildExit"] != 0:
            return 1
        products = derived / "Build/Products"
        candidates = list(products.glob(f"{scheme}_*.xctestrun"))
        if len(candidates) != 1:
            raise RuntimeError("Expected exactly one generated TrackQualification xctestrun")
        plan = plistlib.loads(candidates[0].read_bytes())
        # Xcode emits either the dictionary-based v1 plan or v2 TestConfigurations.
        targets = ([target for configuration in plan["TestConfigurations"]
                    for target in configuration["TestTargets"]]
                   if "TestConfigurations" in plan else
                   [target for name, target in plan.items()
                    if name != "__xctestrun_metadata__" and isinstance(target, dict)])
        url = f"http://127.0.0.1:{server.server_port}/vod-multiaudio/master.m3u8"
        for target in targets:
            target.setdefault("EnvironmentVariables", {}).update({
                "PLAYER_LAB_TEST_MEDIA_URL": url,
                "PLAYER_LAB_TEST_EXPECT_AUDIO": args.expected_audio,
            })
        selected = products / f"PlayerLab-{platform}-Selected.xctestrun"
        if selected.exists():
            raise RuntimeError("A selected test plan already exists; do not overlap runs in one DerivedData")
        selected.write_bytes(plistlib.dumps(plan))
        result = output / "qualification.xcresult"
        test = ["xcodebuild", "test-without-building", "-xctestrun", str(selected),
                "-destination", f"id={args.destination}", "-parallel-testing-enabled", "NO",
                "-collect-test-diagnostics", "never", "-resultBundlePath", str(result)]
        if not args.sdk_only:
            test += [f"-only-testing:Showcase-{platform}ConfigurationUITests/TrackPreferenceUITests"]
        if not args.ui_only:
            test += [f"-only-testing:Showcase-{platform}TrackRuntimeTests/TrackRuntimeTests"]
        report["xcodebuildExit"] = run(test, "runtime")
        summary = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result)],
                                 capture_output=True, text=True, timeout=40)
        if summary.returncode == 0:
            data = json.loads(summary.stdout)
            report["xcresult"] = {key: data.get(key) for key in
                                  ["result", "totalTestCount", "passedTests", "failedTests", "skippedTests"]}
        report["resourceSha256"] = {
            name: hashlib.sha256(path.read_bytes()).hexdigest()
            for name in ["bitmovinplayer-ui.js", "bitmovinplayer-ui.css"]
            if (path := products / f"Debug-iphonesimulator/Showcase-iOS.app/{name}").is_file()
        }
        counts = report.get("xcresult", {})
        report["sourceInputsUnchanged"] = source_hashes() == report["sourceInputSha256"]
        return 0 if (report["xcodebuildExit"] == 0 and counts.get("passedTests") == report["expectedTests"]
                     and counts.get("failedTests") == 0 and counts.get("skippedTests") == 0
                     and report["sourceInputsUnchanged"]) else 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        if selected is not None:
            selected.unlink(missing_ok=True)
        (output / "safe-summary.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({key: report[key] for key in ["platform", "sourceRevision", "workingTreeDirty",
                         "expectedTests", "expectedAudio", "projectGenerationExit", "buildExit",
                         "xcodebuildExit", "xcresult", "resourceSha256", "sourceInputsUnchanged"] if key in report}))


if __name__ == "__main__":
    sys.exit(main())
