#!/usr/bin/env python3
"""Verify packaged shared UI assets and the iOS app's credential-key wiring."""
import argparse
from pathlib import Path
import plistlib
import sys
import zipfile


def check(bundle, source):
    names = ("bitmovinplayer-ui.js", "bitmovinplayer-ui.css")
    if bundle.is_dir():
        check_ios_config(bundle)
        contents = {name: [p.read_bytes() for p in (bundle / name,)
                           if p.is_file()] for name in names}
    else:
        with zipfile.ZipFile(bundle) as archive:
            contents = {name: [archive.read(p) for p in archive.namelist()
                               if p == "assets/" + name] for name in names}
    for name in names:
        expected = (source / name).read_bytes()
        if not expected or contents[name] != [expected]:
            raise ValueError("Missing, duplicated or different shared UI asset: " + name)


def check_ios_config(bundle):
    with (bundle / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    if not isinstance(info, dict):
        raise ValueError("Invalid iOS app Info.plist")
    for name in ("BitmovinLicenseKey", "BitmovinAnalyticsLicenseKey"):
        value = info.get(name)
        # Empty keys are valid for compile-only CI. Missing keys are different:
        # they make a locally configured license disappear before app startup.
        if not isinstance(value, str) or "$(" in value:
            raise ValueError("Missing or unresolved iOS app setting: " + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--source", type=Path, default=Path("packages/ui-shared/dist"))
    args = parser.parse_args()
    try:
        check(args.bundle, args.source)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        return 1
    print("Packaged shared UI assets match the build.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
