#!/usr/bin/env python3
"""Verify the generated JS/CSS are included unchanged in a built app or APK."""
import argparse
from pathlib import Path
import sys
import zipfile


def check(bundle, source):
    names = ("bitmovinplayer-ui.js", "bitmovinplayer-ui.css")
    if bundle.is_dir():
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
