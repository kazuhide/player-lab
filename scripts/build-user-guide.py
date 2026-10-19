#!/usr/bin/env python3
"""Build both static user-guide editions without credentials or network access."""
import argparse
from pathlib import Path

from user_guide import build, load_content


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--content-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'docs/guide')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output_dir.exists() or args.output_dir.is_symlink() or args.output_dir.resolve().is_relative_to(args.content_dir.resolve()):
            raise ValueError('The guide output must be a new path outside its source.')
        pages = build(load_content(args.content_dir))
        args.output_dir.mkdir(parents=True)
        for name, data in sorted(pages.items()):
            target = args.output_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    except (OSError, ValueError, KeyError, TypeError):
        parser.exit(1, 'The user guide could not be built. No public package was approved.\n')
    print(f'Built {len(pages)} public guide files in two languages.')


if __name__ == '__main__':
    main()
