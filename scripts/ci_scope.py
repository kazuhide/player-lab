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
    "CHANGELOG.md", "apps/web/comparison.html", "apps/web/comparison-runner.html",
    "apps/web/demo-runner.html", "apps/web/startup-benchmark.html", "apps/web/vite.config.ts",
    "apps/web/public/comparison-network-worker.js", "tests/e2e/playwright.pages.config.ts",
    "scripts/package-pages.py", "scripts/test-pages-package.py",
    "scripts/scan-pages-secrets.py", "scripts/test-pages-secrets.py",
    "apps/ios/test_track_qualification.py",
))
WEB_PATH = re.compile(rb"(?:docs/guide/(?:en|ja)/[a-z0-9-]+\.json|"
                      rb"apps/web/src/startup/(?:adapters/)?[a-z0-9-]+\.(?:ts|css)|"
                      rb"apps/web/test/[A-Za-z0-9-]+\.test\.ts|"
                      rb"site/assets/guide/web-[a-z0-9-]+\.(?:png|jpg)|"
                      rb"tests/e2e/(?:specs/[a-z0-9-]+\.spec\.ts|"
                      rb"src/[a-z0-9-]+\.ts|[A-Za-z0-9_-]+\.test\.ts))")
WORKFLOW = b".github/workflows/ci.yml"
NATIVE_GUARD = b"needs.publication.outputs.native_required != 'false'"
NATIVE_STEPS = {
    b"ios": {
        **{b"      - name: " + name: b"" for name in (
            b"Test PlaybackCore", b"Install XcodeGen 2.46.0",
            b"Prepare an empty local configuration for compilation", b"Generate Xcode project",
            b"Restore resolved SDK versions", b"Test iOS configuration without an app license",
            b"Test iOS Profiles controls in English and Japanese", b"Build iOS app (simulator)",
            b"Check packaged iOS shared UI", b"Build tvOS app (simulator)",
            b"Build the iOS and tvOS integration guide example",
        )},
        **{b"      - name: " + name: b"always()" for name in (
            b"Save iOS configuration test results", b"Save iOS Profiles UI results and captures",
            b"Stop the selected iPhone before tvOS", b"Save tvOS Profiles UI results and captures",
        )},
        b"      - name: Test tvOS Profiles controls in English and Japanese":
            b"${{ !cancelled() && (success() || steps.ios_profiles.outcome == 'failure') }}",
    },
    b"android": {
        b"      - uses: actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 # v4": b"",
        **{b"      - name: " + name: b"" for name in (
            b"Install Android SDK 37", b"Test playback and configuration, build the app, compile the instrumented test",
            b"Check packaged Android shared UI", b"Compile the Android integration guide example",
        )},
    },
}


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


def normalize_light_job(block, job):
    label, target = ((b"iOS", b"apps/ios/WebUI") if job == b"ios" else
                     (b"Android", b"apps/android/app/src/main/assets"))
    light = (b"      - name: Check synchronized " + label + b" shared UI assets\n"
             b"        if: needs.publication.outputs.native_required == 'false'\n"
             b"        run: |\n"
             b"          for asset in bitmovinplayer-ui.js bitmovinplayer-ui.css; do\n"
             b"            test -s \"packages/ui-shared/dist/$asset\"\n"
             b"            cmp \"packages/ui-shared/dist/$asset\" \"" + target + b"/$asset\"\n"
             b"          done\n")
    sync = b"      - name: Sync existing shared UI resources\n        run: bash scripts/sync-webui-bundle.sh\n"
    if block.count(light) != 1 or sync + light not in block:
        return None
    prefix, _, heavy = block.partition(light)
    steps = re.split(rb"(?=^      - )", heavy, flags=re.MULTILINE)
    normalized = []
    for step in filter(None, steps):
        header = step.split(b"\n", 1)[0]
        old = NATIVE_STEPS[job].get(header)
        if old is None:
            return None
        if not old:
            new = NATIVE_GUARD
        elif old == b"always()":
            new = old + b" && " + NATIVE_GUARD
        else:
            new = b"${{ " + NATIVE_GUARD + b" && " + old[4:]
        guarded = header + b"\n        if: " + new + b"\n"
        if not step.startswith(guarded):
            return None
        restored = header + b"\n" + (b"        if: " + old + b"\n" if old else b"")
        normalized.append(restored + step[len(guarded):])
    return prefix + b"".join(normalized) if normalized else None


def normalize_workflow(data):
    """Ignore only the authorized routing and comparison selector additions."""
    reference = b"      references_only: ${{ steps.scope.outputs.references_only }}\n"
    native = b"      native_required: ${{ steps.scope.outputs.native_required }}\n"
    if data.count(reference) != 1 or data.count(native) > 1:
        return None
    if native in data:
        if reference + native not in data:
            return None
        data = data.replace(reference + native, reference)
    for job in (b"ios", b"android"):
        match = re.search(rb"^  " + job + rb":\n(?:(?!^  [a-z]+:).)*", data,
                          flags=re.MULTILINE | re.DOTALL)
        if match is None:
            return None
        block = match.group()
        old = b"  " + job + b":\n    needs: build\n"
        new = (b"  " + job + b":\n    needs: [publication, build]\n"
               b"    if: needs.publication.outputs.native_required != 'false'\n")
        light = (b"  " + job + b":\n    needs: [publication, build]\n"
                 b"    if: needs.publication.outputs.references_only != 'true'\n")
        if sum(block.count(value) for value in (old, new, light)) != 1:
            return None
        if block.startswith(light):
            block = normalize_light_job(block, job)
            if block is None:
                return None
            if job == b"ios":
                runner = (b"    runs-on: ${{ " + NATIVE_GUARD +
                          b" && 'macos-26-intel' || 'ubuntu-latest' }}\n")
                if block.count(runner) != 1:
                    return None
                block = block.replace(runner, b"    runs-on: macos-26-intel\n")
            block = block.replace(light, old, 1)
        else:
            block = block.replace(new, old, 1)
        data = data[:match.start()] + block + data[match.end():]
    selector = (b"        env:\n          PLAYWRIGHT_BROWSER_CHANNEL: chromium\n"
                b"          E2E_PAGES_DIR: ${{ runner.temp }}/pages-release/site\n"
                b"        run: pnpm --filter @showcase/e2e e2e:pages startup-comparison.spec.ts")
    before = b"      - name: Check startup comparison with the production SDKs\n" + selector + b"\n"
    after = (b"      - name: Check player comparison and startup benchmark with the production SDKs\n" +
             selector + b" player-comparison.spec.ts\n")
    if data.count(before) + data.count(after) > 1:
        return None
    data = data.replace(after, before)
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
