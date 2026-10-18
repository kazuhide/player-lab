#!/usr/bin/env python3
"""Check tracked content and commit history without printing matched values."""
import argparse
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def forbidden(path):
    p = PurePosixPath(path)
    return (
        (p.name == ".env" or p.name.startswith(".env.")) and p.name != ".env.example"
        or p.name == "local.properties"
        or p.suffix in {".xcconfig", ".p12", ".pfx", ".key"}
        or path.startswith(("apps/ios/WebUI/", "apps/react-native/assets/webui/"))
        or path in {"apps/android/app/src/main/assets/bitmovinplayer-ui.js",
                    "apps/android/app/src/main/assets/bitmovinplayer-ui.css"}
    )


def scan(root, staged, revision, base, private_rules):
    version = subprocess.run(["gitleaks", "version"], check=True, capture_output=True, text=True)
    if version.stdout.strip() != "8.30.1":
        raise ValueError("Install Gitleaks 8.30.1 before checking publication.")
    revision = git("rev-parse", "--verify", revision + "^{commit}").decode().strip()
    history = revision
    if base:
        base = git("rev-parse", "--verify", base + "^{commit}").decode().strip()
        history = base + ".." + revision
    entries = git("ls-files", "--stage", "-z") if staged else git("ls-tree", "-r", "-z", revision)
    items = []
    for raw in entries.split(b"\0"):
        if not raw:
            continue
        meta, path = raw.split(b"\t", 1)
        fields = meta.split()
        oid = fields[1] if staged else fields[2]
        if fields[0] not in {b"100644", b"100755", b"120000"}:
            raise ValueError("Unsupported or unresolved tracked entry.")
        items.append((path.decode(), oid.decode()))
    literals = []
    if private_rules:
        rules = Path(private_rules).expanduser().resolve()
        if any((root / path).resolve() == rules for path, _ in items):
            raise ValueError("Private rules must not be tracked.")
        literals = [line.lower().encode() for line in rules.read_text().splitlines() if line]
    failures = set()
    with tempfile.TemporaryDirectory(prefix="publication-") as work:
        snapshot = Path(work) / "tracked"
        snapshot.mkdir()
        for path, oid in items:
            if forbidden(path):
                failures.add("forbidden-tracked-file")
            data = git("cat-file", "blob", oid)
            if any(value in data.lower() or value in path.lower().encode() for value in literals):
                failures.add("private-local-rule")
            target = snapshot / path
            target.parent.mkdir(parents=True, exist_ok=True)
            # Store symlink text, never follow links into untracked local files.
            target.write_bytes(data)
        if literals and not staged:
            for commit in git("rev-list", history).decode().splitlines():
                data = git("show", "--format=fuller", "--no-ext-diff", commit).lower()
                if any(value in data for value in literals):
                    failures.add("private-local-history-rule")
        commands = [["dir", str(snapshot)]]
        if not staged:
            commands.append(["git", str(root), "--log-opts=" + history])
            changed = git("log", "--format=", "--name-only", "-z", history)
            if any(forbidden(p.decode()) for p in changed.split(b"\0") if p.strip()):
                failures.add("forbidden-file-in-history")
        for command in commands:
            result = subprocess.run(
                ["gitleaks", *command, "--no-banner", "--redact=100"],
                capture_output=True,
            )
            if result.returncode == 1:
                failures.add("secret-pattern")
            elif result.returncode:
                raise ValueError("Secret scanner failed; publication was not checked.")
    for rule in sorted(failures):
        print("Publication check failed: " + rule, file=sys.stderr)
    if not failures:
        print("Publication checks passed (tracked content" + (" only)." if staged else " and history)."))
    return bool(failures)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="Check the index before committing.")
    parser.add_argument("--revision", default="HEAD", help="Commit to check before pushing.")
    parser.add_argument("--base", help="Exclude ancestors of this commit from the history check.")
    parser.add_argument("--private-rules", default=os.environ.get("PUBLICATION_PRIVATE_RULES"),
                        help="Local-only file with one literal per line; never printed.")
    args = parser.parse_args()
    try:
        root = Path(git("rev-parse", "--show-toplevel").decode().strip())
        os.chdir(root)
        rules = args.private_rules
        if not rules:
            config = subprocess.run(["git", "config", "--get", "publication.privateRules"], capture_output=True, text=True)
            rules = config.stdout.strip() if config.returncode == 0 else None
        return scan(root, args.staged, args.revision, args.base, rules)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("Publication check could not complete. Check Git, Gitleaks and local rules.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
