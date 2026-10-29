#!/usr/bin/env python3
"""Skip root application checks only for a verified references-only diff."""
import os
from pathlib import Path
import re
import subprocess


COMMIT = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, timeout=30).stdout


def references_only(event, base, head, *, root=Path(".")):
    if event not in ("pull_request", "push"):
        return False
    if any(not COMMIT.fullmatch(value) or not value.strip("0") for value in (base, head)):
        return False
    try:
        if git(root, "rev-parse", "--verify", "HEAD^{commit}").strip().lower() != head.lower().encode():
            return False
        git(root, "cat-file", "-e", base + "^{commit}")
        # Disabling renames retains both paths when a file crosses the boundary.
        changed = git(root, "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z",
                      base, head, "--")
    except (OSError, subprocess.SubprocessError):
        return False
    if not changed.endswith(b"\0"):
        return False
    paths = changed[:-1].split(b"\0")
    return all(path.startswith(b"references/")
               and not any(part in (b"", b".", b"..") for part in path.split(b"/"))
               for path in paths)


def main():
    scoped = references_only(os.environ.get("CI_EVENT", ""), os.environ.get("CI_BASE", ""),
                             os.environ.get("CI_HEAD", ""))
    # Never write filenames or other event-controlled text to GitHub outputs.
    print("references_only=" + ("true" if scoped else "false"))


if __name__ == "__main__":
    main()
