#!/usr/bin/env python3
"""Select application checks only from a verified, narrowly scoped Git diff."""
import os
from pathlib import Path
import re
import subprocess


COMMIT = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")
WEB_FILES = frozenset(path.encode() for path in (
    "scripts/guide_html.py", "scripts/guide_routes.py", "scripts/test-user-guide.py",
    "scripts/user_guide.py", "site/guide.js", "site/guide.css",
    "scripts/release_contract.py", "scripts/test-release-pipeline.py",
    "scripts/ci_scope.py", "scripts/test-ci-scope.py",
))
WEB_PATH = re.compile(rb"(?:docs/guide/(?:en|ja)/[a-z0-9-]+\.json|"
                      rb"tests/e2e/(?:specs/[a-z0-9-]+\.spec\.ts|"
                      rb"src/[a-z0-9-]+\.ts|[A-Za-z0-9_-]+\.test\.ts))")
WORKFLOW = b".github/workflows/ci.yml"


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, timeout=30).stdout


def changed_paths(event, base, head, *, root):
    if event not in ("pull_request", "push"):
        return None
    if any(not isinstance(value, str) or not COMMIT.fullmatch(value)
           or not value.strip("0") for value in (base, head)):
        return None
    try:
        if git(root, "rev-parse", "--verify", "HEAD^{commit}").strip().lower() != head.lower().encode():
            return None
        git(root, "cat-file", "-e", base + "^{commit}")
        # Disabling renames retains both paths when a file crosses the boundary.
        changed = git(root, "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z",
                      base, head, "--")
    except (OSError, subprocess.SubprocessError):
        return None
    if not changed.endswith(b"\0"):
        return None
    paths = changed[:-1].split(b"\0")
    if any(any(part in (b"", b".", b"..") for part in path.split(b"/")) for path in paths):
        return None
    return paths


def references_only(event, base, head, *, root=Path(".")):
    paths = changed_paths(event, base, head, root=root)
    return paths is not None and all(path.startswith(b"references/") for path in paths)


def normalize_workflow(data):
    """Ignore only the exact native routing additions; retain all other bytes."""
    reference = b"      references_only: ${{ steps.scope.outputs.references_only }}\n"
    native = b"      native_required: ${{ steps.scope.outputs.native_required }}\n"
    if data.count(reference) != 1 or data.count(native) > 1:
        return None
    if native in data:
        if reference + native not in data:
            return None
        data = data.replace(reference + native, reference)
    for job in (b"ios", b"android"):
        old = b"  " + job + b":\n    needs: build\n"
        new = (b"  " + job + b":\n    needs: [publication, build]\n"
               b"    if: needs.publication.outputs.native_required != 'false'\n")
        if data.count(old) + data.count(new) != 1:
            return None
        data = data.replace(new, old)
    return data


def native_required(event, base, head, *, root=Path(".")):
    paths = changed_paths(event, base, head, root=root)
    if paths is None or any(path != WORKFLOW and path not in WEB_FILES
                            and not WEB_PATH.fullmatch(path) for path in paths):
        return True
    if WORKFLOW in paths:
        try:
            before = normalize_workflow(git(root, "show", base + ":" + WORKFLOW.decode()))
            after = normalize_workflow(git(root, "show", head + ":" + WORKFLOW.decode()))
        except (OSError, subprocess.SubprocessError):
            return True
        if before is None or after is None or before != after:
            return True
    return False


def main():
    args = tuple(os.environ.get(name, "") for name in ("CI_EVENT", "CI_BASE", "CI_HEAD"))
    scoped = references_only(*args)
    native = native_required(*args)
    # Never write filenames or other event-controlled text to GitHub outputs.
    print("references_only=" + ("true" if scoped else "false"))
    print("native_required=" + ("true" if native else "false"))


if __name__ == "__main__":
    main()
