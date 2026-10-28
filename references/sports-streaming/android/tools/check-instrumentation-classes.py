#!/usr/bin/env python3
"""Verify compiled JUnit methods without contacting an Android device."""
from pathlib import Path
import re
import subprocess
import sys

android = Path(__file__).resolve().parents[1]
classes = android / "app/build/intermediates/built_in_kotlinc/debugAndroidTest/compileDebugAndroidTestKotlin/classes"
checked = 0
for source in sorted((android / "app/src/androidTest/java").rglob("*Test.kt")):
    methods = re.findall(r"@Test(?:\([^)]*\))?\s+fun\s+(\w+)\s*\(", source.read_text())
    if not methods:
        raise SystemExit(f"No supported @Test declarations found in {source.name}")
    matching = list(classes.rglob(source.stem + ".class"))
    if len(matching) != 1:
        raise SystemExit(f"Assemble the Android test APK before checking {source.stem}")
    result = subprocess.run(["javap", "-p", str(matching[0])], text=True, capture_output=True, check=True)
    for method in methods:
        if not re.search(r"public (?:final )?void " + re.escape(method) + r"\(\);", result.stdout):
            raise SystemExit(f"JUnit method must compile to public void: {source.stem}.{method}")
        checked += 1
print(f"Verified {checked} compiled public void JUnit methods")
if checked == 0:
    sys.exit(1)
