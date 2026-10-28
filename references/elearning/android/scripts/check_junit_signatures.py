#!/usr/bin/env python3
"""Reject Kotlin @Test methods that JUnit 4 cannot execute before installing an APK."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess

EXPECTED_TEST_COUNTS = {
    "CoreLearningTest": 6,
    "GuideScreenshotTest": 1,
    "MandatoryBehaviorTest": 6,
    "ProcessDeathCheckpointTest": 1,
    "ReviewRegressionTest": 7,
    "SharedCaptionTest": 2,
    "UiOwnershipTest": 3,
}


def inspect(output: str) -> tuple[int, list[str]]:
    count, invalid = 0, []
    chunks = re.split(r"(?m)(?=^  (?:public|private|protected) .*\([^\n]*\);$)", output)
    for chunk in chunks:
        if not re.search(r"RuntimeVisibleAnnotations:[\s\S]*?^\s+org\.junit\.Test\s*$", chunk, re.MULTILINE):
            continue
        count += 1
        declaration = chunk.splitlines()[0].strip()
        descriptor = re.search(r"^\s+descriptor: (.+)$", chunk, re.MULTILINE)
        if not declaration.startswith("public ") or " static " in declaration or descriptor is None or descriptor[1] != "()V":
            invalid.append(declaration)
    return count, invalid


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classes-dir", type=Path, default=root / "app/build/intermediates/built_in_kotlinc/debugAndroidTest/compileDebugAndroidTestKotlin/classes")
    parser.add_argument("--javap", default=str(Path(os.environ["JAVA_HOME"]) / "bin/javap") if os.environ.get("JAVA_HOME") else shutil.which("javap"))
    args = parser.parse_args()
    classes = sorted(args.classes_dir.rglob("*Test.class"))
    if not classes or not args.javap:
        parser.error("Compile debug Android tests first and provide a JDK with javap")
    count, invalid, actual_counts = 0, [], {}
    for path in classes:
        # Do not print javap's constant pool: app-specific license values can be inlined in test bytecode.
        result = subprocess.run([args.javap, "-p", "-s", "-v", str(path)], text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(f"javap failed for {path.name} (exit {result.returncode})")
        found, errors = inspect(result.stdout)
        actual_counts[path.stem] = found
        count += found
        invalid.extend(f"{path.stem}: {error}" for error in errors)
    if actual_counts != EXPECTED_TEST_COUNTS:
        invalid.append(f"Expected test counts {EXPECTED_TEST_COUNTS}; found {actual_counts}")
    if count == 0 or invalid:
        print("Invalid JUnit 4 test signatures:")
        for error in invalid:
            print(error)
        return 1
    print(f"JUnit signatures: {count} @Test methods are public void with no parameters")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
