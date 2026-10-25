#!/usr/bin/env python3
"""Compile the guide examples with the native apps' adopted SDK dependencies."""
import argparse
import json
from pathlib import Path
import shlex
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def run(command, cwd):
    print(shlex.join(str(part) for part in command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def apple(work):
    project = work / "apple"
    project.mkdir(parents=True, exist_ok=True)
    resolved = ROOT / "apps/ios/Package.resolved"
    pin = next(pin for pin in json.loads(resolved.read_text())["pins"]
               if pin["identity"] == "player-ios")
    targets = {}
    for platform, minimum in (("iOS", "16.0"), ("tvOS", "15.0")):
        targets[f"GuideExample-{platform}"] = {
            "type": "application", "platform": platform, "deploymentTarget": minimum,
            "sources": [str(ROOT / "apps/ios/examples/MinimalPlayer.swift")],
            "dependencies": [{"package": "BitmovinPlayer", "product": "BitmovinPlayer"}],
            "settings": {"base": {
                "PRODUCT_BUNDLE_IDENTIFIER": f"com.example.playerguide.{platform.lower()}",
            }},
        }
    spec = {
        "name": "GuideExample",
        "settings": {"base": {"SWIFT_VERSION": "5.0", "GENERATE_INFOPLIST_FILE": True,
                                "CODE_SIGNING_ALLOWED": False}},
        "packages": {"BitmovinPlayer": {
            "url": pin["location"], "exactVersion": pin["state"]["version"],
        }},
        "targets": targets,
        "schemes": {name: {"build": {"targets": {name: "all"}}} for name in targets},
    }
    (project / "project.json").write_text(json.dumps(spec, indent=2) + "\n")
    run(["xcodegen", "generate", "--spec", "project.json"], project)
    xcode_project = project / "GuideExample.xcodeproj"
    lock = xcode_project / "project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
    lock.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(resolved, lock)
    for platform in ("iOS", "tvOS"):
        run([
            "xcodebuild", "-project", str(xcode_project), "-scheme", f"GuideExample-{platform}",
            "-destination", f"generic/platform={platform} Simulator",
            "-derivedDataPath", str(work / "apple-build"),
            "-clonedSourcePackagesDirPath", str(work / "apple-packages"),
            "-onlyUsePackageVersionsFromResolvedFile", "-jobs", "2",
            "CODE_SIGNING_ALLOWED=NO", "build",
        ], project)


def android(work):
    mirror = work / "android"
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "apps/android"], cwd=ROOT,
    ).decode().split("\0")
    for name in filter(None, tracked):
        source = ROOT / name
        relative = source.relative_to(ROOT / "apps/android")
        if source.name.startswith(".env") or source.name == "local.properties":
            continue
        target = mirror / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    example = mirror / "app/src/main/kotlin/com/example/playerguide/MinimalPlayerActivity.kt"
    example.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "apps/android/examples/MinimalPlayerActivity.kt", example)
    run([
        "./gradlew", "--no-daemon", "--max-workers=2",
        "-Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8",
        ":app:compileDebugKotlin", "-PbitmovinLicenseKey=dummy",
    ], mirror)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=("apple", "android"))
    parser.add_argument("--work-dir", type=Path, required=True,
                        help="Build directory outside the repository; may be reused for build caches.")
    args = parser.parse_args()
    work = args.work_dir.resolve()
    if work == ROOT or ROOT in work.parents:
        parser.error("--work-dir must be outside the repository")
    work.mkdir(parents=True, exist_ok=True)
    {"apple": apple, "android": android}[args.platform](work)


if __name__ == "__main__":
    main()
