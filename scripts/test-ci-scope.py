#!/usr/bin/env python3
"""Verify conservative CI routing against real Git histories."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import ci_scope

ROOT = Path(__file__).resolve().parents[1]


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "CI scope test")
        self.git("config", "user.email", "test@example.invalid")
        self.write("README.md", "Shared documentation\n")
        self.write("references/elearning/README.md", "Learning example\n")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True,
                              capture_output=True).stdout

    def write(self, name, text="Example\n"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "Update fixture")
        return self.git("rev-parse", "HEAD").decode().strip()

    def selected(self, event="push", base=None, head=None):
        return ci_scope.references_only(event, self.base if base is None else base,
                                        self.git("rev-parse", "HEAD").decode().strip()
                                        if head is None else head, root=self.root)

    def reference_commit(self):
        self.write("references/sports-streaming/README.md")
        return self.commit()

    def native_selected(self, event="push", base=None, head=None):
        return ci_scope.native_required(event, self.base if base is None else base,
                                        self.git("rev-parse", "HEAD").decode().strip() if head is None else head,
                                        root=self.root)

    def sdk_files(self, version):
        files = {}
        for name, section in (("apps/web/package.json", "dependencies"),
                              ("packages/ui-shared/package.json", "devDependencies"),
                              ("tests/e2e/package.json", "devDependencies")):
            data = {"name": name, section: {"bitmovin-player": version}}
            if name.startswith("packages/"):
                data["dependencies"] = {"bitmovin-player-ui": "4.23.0"}
            files[name] = json.dumps(data, indent=2) + "\n"
        peer = "4.23.0(patch_hash=" + "a" * 64 + ")(bitmovin-player@" + version + ")"
        lock = "lockfileVersion: '9.0'\n\nimporters:\n"
        for owner, section in (("apps/web", "dependencies"), ("packages/ui-shared", "devDependencies"), ("tests/e2e", "devDependencies")):
            lock += "  " + owner + ":\n"
            if owner == "packages/ui-shared":
                lock += "    dependencies:\n      bitmovin-player-ui:\n        specifier: 4.23.0\n        version: " + peer + "\n"
            lock += "    " + section + ":\n      bitmovin-player:\n        specifier: " + version + "\n        version: " + version + "\n\n"
        integrity = chr(65 + int(version.split('.')[1]) % 26) * 86 + "=="
        lock += ("  apps/vega:\n    dependencies:\n      bitmovin-player:\n        specifier: 8.138.0-beta.28\n        version: 8.138.0-beta.28\n\n"
                 "packages:\n\n  bitmovin-player@" + version + ":\n    resolution: {integrity: sha512-" + integrity + "}\n\n"
                 "  shaka-player@5.3.3:\n    resolution: {integrity: unchanged}\n    engines: {node: '>=18'}\n\n"
                 "snapshots:\n\n  bitmovin-player-ui@" + peer + ":\n    dependencies:\n      bitmovin-player: " + version + "\n\n"
                 "  bitmovin-player@" + version + ": {}\n")
        files["pnpm-lock.yaml"] = lock
        return files

    def write_sdk(self, version):
        for name, text in self.sdk_files(version).items():
            self.write(name, text)

    def workflow(self, scoped=False, light=False, comparison=False):
        text = """name: Fixture
jobs:
  publication:
    outputs:
      references_only: ${{ steps.scope.outputs.references_only }}
    steps:
      - run: python3 scripts/ci_scope.py
  build:
    needs: publication
    if: needs.publication.outputs.references_only != 'true'
    steps:
      - run: shared-build
  web:
    needs: publication
    if: needs.publication.outputs.references_only != 'true'
    steps:
      - run: web-tests
  webkit:
    needs: web
    steps:
      - run: webkit-tests
  ios:
    needs: build
    runs-on: macos-26-intel
    env:
      NATIVE_FIXTURE: unchanged
    steps:
      - uses: actions/checkout@1111111111111111111111111111111111111111
      - name: Sync existing shared UI resources
        run: bash scripts/sync-webui-bundle.sh
      - name: Test PlaybackCore
        run: xcodebuild unchanged-test
      - name: Save iOS configuration test results
        if: always()
        run: retain-results
      - name: Test tvOS Profiles controls in English and Japanese
        if: ${{ !cancelled() && (success() || steps.ios_profiles.outcome == 'failure') }}
        run: tvos-unchanged-test
  android:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Sync existing shared UI resources
        run: bash scripts/sync-webui-bundle.sh
      - name: Install Android SDK 37
        run: gradle unchanged-test
"""
        if scoped:
            text = text.replace("      references_only: ${{ steps.scope.outputs.references_only }}\n",
                                "      references_only: ${{ steps.scope.outputs.references_only }}\n      native_required: ${{ steps.scope.outputs.native_required }}\n")
            for job in ("ios", "android"):
                text = text.replace("  " + job + ":\n    needs: build\n",
                                    "  " + job + ":\n    needs: [publication, build]\n    if: needs.publication.outputs.native_required != 'false'\n")
        if light:
            text = text.replace("    if: needs.publication.outputs.native_required != 'false'\n",
                                "    if: needs.publication.outputs.references_only != 'true'\n")
            text = text.replace("    runs-on: macos-26-intel\n",
                                "    runs-on: ${{ needs.publication.outputs.native_required != 'false' && 'macos-26-intel' || 'ubuntu-latest' }}\n")
            for label, target, following in (("iOS", "apps/ios/WebUI", "Test PlaybackCore"),
                                             ("Android", "apps/android/app/src/main/assets", "Install Android SDK 37")):
                step = ("      - name: Check synchronized " + label + " shared UI assets\n"
                        "        if: needs.publication.outputs.native_required == 'false'\n"
                        "        run: |\n"
                        "          for asset in bitmovinplayer-ui.js bitmovinplayer-ui.css; do\n"
                        "            test -s \"packages/ui-shared/dist/$asset\"\n"
                        "            cmp \"packages/ui-shared/dist/$asset\" \"" + target + "/$asset\"\n"
                        "          done\n")
                text = text.replace("      - name: " + following + "\n", step + "      - name: " + following + "\n        if: needs.publication.outputs.native_required != 'false'\n")
            text = text.replace("        if: always()\n", "        if: always() && needs.publication.outputs.native_required != 'false'\n")
            text = text.replace("        if: ${{ !cancelled()", "        if: ${{ needs.publication.outputs.native_required != 'false' && !cancelled()")
        if comparison:
            step = """      - name: Check player comparison and startup benchmark with the production SDKs
        env:
          PLAYWRIGHT_BROWSER_CHANNEL: chromium
          E2E_PAGES_DIR: ${{ runner.temp }}/pages-release/site
        run: pnpm --filter @showcase/e2e e2e:pages startup-comparison.spec.ts player-comparison.spec.ts
"""
            text = text.replace("      - run: web-tests\n", "      - run: web-tests\n" + step)
        return text

    def test_verified_web_paths_skip_only_native_checks(self):
        paths = ("scripts/guide_html.py", "scripts/guide_routes.py", "scripts/test-user-guide.py", "scripts/user_guide.py",
                 "site/guide.js", "site/guide.css", "docs/guide/en/getting-started.json", "docs/guide/ja/test-results.json",
                 "tests/e2e/specs/user-guide.spec.ts", "tests/e2e/src/browser-diagnostics.ts", "tests/e2e/browserDiagnostics.test.ts",
                 "scripts/release_contract.py", "scripts/test-release-pipeline.py", "scripts/ci_scope.py", "scripts/test-ci-scope.py")
        for name in paths:
            self.write(name)
        self.commit()
        self.assertFalse(self.native_selected("push"))
        self.assertFalse(self.native_selected("pull_request"))
        self.assertFalse(self.selected())
        self.assertEqual(self.cli().stdout, "references_only=false\nnative_required=false\n")

    def test_comparison_demo_and_public_pages_paths_keep_native_checks_light(self):
        paths = ("CHANGELOG.md", "apps/web/comparison.html", "apps/web/comparison-runner.html",
                 "apps/web/demo-runner.html", "apps/web/startup-benchmark.html", "apps/web/vite.config.ts",
                 "apps/web/public/comparison-network-worker.js", "apps/web/src/startup/demo-session.ts",
                 "apps/web/src/startup/comparison.css", "apps/web/src/startup/adapters/webx-dash.ts",
                 "apps/web/test/demo-session.test.ts", "apps/web/test/pagesBuild.test.ts",
                 "tests/e2e/playwright.pages.config.ts", "tests/e2e/specs/player-comparison.spec.ts",
                 "tests/e2e/src/compatible-dash.ts", "site/assets/guide/web-comparison-single-en.png",
                 "site/assets/guide/web-comparison-parallel-ja.png", "scripts/package-pages.py",
                 "scripts/scan-pages-secrets.py", "scripts/test-pages-package.py", "scripts/test-pages-secrets.py",
                 "apps/ios/test_track_qualification.py")
        for name in paths:
            self.write(name)
        self.commit()
        self.assertFalse(self.native_selected("push"))
        self.assertFalse(self.native_selected("pull_request"))
        self.assertFalse(self.selected())

    def test_generated_web_api_and_local_media_paths_are_exactly_scoped(self):
        for name in ("apps/web/src/api/schema.json", "docs/api-coverage/coverage.json",
                     "docs/api-coverage/inventory.json", "docs/api-coverage/summary.json", "docs/api-coverage/gaps.json",
                     "encoding/test-streams/local.py", "scripts/test-local-media.py",
                     "scripts/api-coverage/apple/normalize_apple.py"):
            self.write(name)
        self.commit()
        self.assertFalse(self.native_selected())
        base = self.git("rev-parse", "HEAD").decode().strip()
        for name in ("docs/api-coverage/native.json", "apps/web/src/api/other.json", "encoding/test-streams/other.py",
                     "scripts/api-coverage/apple/other.py"):
            with self.subTest(path=name):
                self.git("reset", "--hard", base); self.write(name); self.commit()
                self.assertTrue(self.native_selected(base=base))

    def test_dated_web_result_datasets_keep_native_checks_light(self):
        for name in ("docs/web-startup-results-2026-11-01.json", "docs/web-comparison-results-2026-11-03.json"):
            self.write(name)
        self.commit()
        self.assertFalse(self.native_selected())
        base = self.git("rev-parse", "HEAD").decode().strip()
        for name in ("docs/native-results-2026-11-03.json", "docs/web-comparison-results-latest.json",
                     "docs/web-comparison-results-2026-11-03.py"):
            with self.subTest(path=name):
                self.git("reset", "--hard", base); self.write(name); self.commit()
                self.assertTrue(self.native_selected(base=base))

    def test_exact_coordinated_web_sdk_pins_and_lock_keep_native_checks_light(self):
        for old, new in (("8.281.0", "8.283.0"), ("8.283.0", "8.284.0")):
            with self.subTest(old=old, new=new):
                self.git("reset", "--hard", self.base)
                self.write_sdk(old); base = self.commit()
                self.write_sdk(new); self.write("apps/web/src/startup/demo-session.ts"); self.commit()
                self.assertFalse(self.native_selected(base=base))
                self.assertFalse(self.native_selected("pull_request", base=base))

    def test_sdk_pin_exception_rejects_partial_inconsistent_or_nonstable_manifest_changes(self):
        self.write_sdk("8.281.0"); base = self.commit()
        invalid = ("8.282.0", "^8.283.0", "latest", "9.0.0", "8.280.0", "8.283.0-beta.1")
        for version in invalid:
            with self.subTest(version=version):
                self.git("reset", "--hard", base); self.write_sdk("8.283.0")
                data = json.loads((self.root / "apps/web/package.json").read_text())
                data["dependencies"]["bitmovin-player"] = version
                self.write("apps/web/package.json", json.dumps(data)); self.commit()
                self.assertTrue(self.native_selected(base=base))
        for version in ("^8.283.0", "9.0.0", "8.280.0", "8.283.0-beta.1"):
            with self.subTest(coordinated_invalid_version=version):
                self.git("reset", "--hard", base); self.write_sdk(version); self.commit()
                self.assertTrue(self.native_selected(base=base))
        for omitted in self.sdk_files("8.283.0"):
            with self.subTest(omitted=omitted):
                self.git("reset", "--hard", base)
                for name, text in self.sdk_files("8.283.0").items():
                    if name != omitted:
                        self.write(name, text)
                self.commit(); self.assertTrue(self.native_selected(base=base))
        for addition in ('"extraDependency":"1.0.0",', '"bitmovin-player":"8.283.0",'):
            with self.subTest(addition=addition):
                self.git("reset", "--hard", base); self.write_sdk("8.283.0")
                name = "apps/web/package.json"
                self.write(name, (self.root / name).read_text().replace('"dependencies": {', '"dependencies": {' + addition))
                self.commit(); self.assertTrue(self.native_selected(base=base))
        self.git("reset", "--hard", base); self.write_sdk("8.283.0")
        self.write("apps/web/package.json", '{"dependencies": {"bitmovin-player": "8.283.0", "invalid": NaN}}')
        self.commit(); self.assertTrue(self.native_selected(base=base))

    def test_sdk_pin_exception_rejects_all_unrelated_or_malformed_lock_changes(self):
        self.write_sdk("8.281.0"); base = self.commit()
        lock = self.sdk_files("8.283.0")["pnpm-lock.yaml"]
        mutations = (("    engines: {node: '>=18'}\n", ""),
                     ("8.138.0-beta.28", "8.138.0-beta.29"),
                     ("patch_hash=" + "a" * 64, "patch_hash=" + "b" * 64),
                     ("bitmovin-player-ui@4.23.0", "bitmovin-player-ui@4.24.0"),
                     ("resolution: {integrity: unchanged}", "resolution: {integrity: changed}"),
                     ("specifier: 8.283.0\n        version: 8.283.0", "specifier: 8.283.0\n        version: 8.282.0"),
                     ("bitmovin-player@8.283.0: {}", "bitmovin-player@8.283.0: {dependencies: {other: 1.0.0}}"),
                     ("sha512-", "sha256-"),
                     ("snapshots:\n", "snapshots:\n  apps/web:\n    dependencies: {}\n"))
        for old, new in mutations:
            with self.subTest(mutation=new):
                self.git("reset", "--hard", base); self.write_sdk("8.283.0")
                changed = lock.replace(old, new); self.assertNotEqual(changed, lock)
                self.write("pnpm-lock.yaml", changed); self.commit()
                self.assertTrue(self.native_selected(base=base))

    def test_sdk_pin_exception_never_hides_shared_native_or_other_dependency_changes(self):
        self.write_sdk("8.281.0"); base = self.commit()
        for name in ("packages/ui-shared/src/global.ts", "packages/ui-shared/tsup.config.ts", "pnpm-workspace.yaml",
                     "apps/ios/Native.swift", "apps/ios/Package.resolved", "apps/android/app/build.gradle.kts",
                     "apps/react-native/package.json", "apps/web/src/main.ts", "apps/web/other-lock.yaml"):
            with self.subTest(path=name):
                self.git("reset", "--hard", base); self.write_sdk("8.283.0"); self.write(name); self.commit()
                self.assertTrue(self.native_selected(base=base))

    def test_native_shared_dependency_unknown_and_mixed_paths_fail_closed(self):
        for name in ("apps/ios/Native.swift", "apps/android/Main.kt", "apps/web/package.json", "pnpm-lock.yaml",
                     "package-lock.json", "packages/ui-shared/src/app.ts", "shared/schema.json", "site/guide/images/native.png",
                     "scripts/release_other.py", "README.md", "references/elearning/README.md", "docs/guide/en/line\nnative_required=false.json",
                     "apps/web/src/startup/package.json", "apps/web/pnpm-lock.yaml", "apps/web/tsconfig.json",
                     "tests/e2e/package.json", "tests/e2e/pnpm-lock.yaml", "apps/web/public/unknown.js",
                     "apps/web/src/startup/private/code.py", "site/assets/guide/native-new.png",
                     "apps/ios/test_other.py"):
            with self.subTest(name=name):
                self.git("reset", "--hard", self.base)
                self.write("site/guide.js"); self.write(name, "Changed\n"); self.commit()
                self.assertTrue(self.native_selected())

    def test_web_boundary_rename_and_unsupported_or_invalid_inputs_require_native(self):
        self.write("site/guide.js"); self.commit()
        web_base = self.git("rev-parse", "HEAD").decode().strip()
        (self.root / "tests/e2e/specs").mkdir(parents=True)
        self.git("mv", "README.md", "tests/e2e/specs/moved.spec.ts"); self.commit()
        self.assertTrue(self.native_selected(base=web_base))
        self.git("reset", "--hard", web_base)
        self.git("mv", "site/guide.js", "native-shared.js"); self.commit()
        self.assertTrue(self.native_selected(base=web_base))
        self.git("reset", "--hard", web_base)
        for event in ("workflow_dispatch", "pull_request_target", "", "unknown"):
            self.assertTrue(self.native_selected(event))
        for values in ({"base": "0" * 40}, {"base": "f" * 40}, {"head": self.base}, {"head": "HEAD"}, {"base": web_base}):
            self.assertTrue(self.native_selected(**values))
        with patch("ci_scope.git", side_effect=OSError):
            self.assertTrue(self.native_selected())

    def test_exact_workflow_scoping_bootstrap_is_allowed(self):
        self.write(".github/workflows/ci.yml", self.workflow()); workflow_base = self.commit()
        self.write(".github/workflows/ci.yml", self.workflow(scoped=True))
        self.write("scripts/ci_scope.py"); self.write("scripts/test-ci-scope.py"); self.write("site/guide.js"); self.commit()
        self.assertFalse(self.native_selected(base=workflow_base))
        self.assertFalse(self.selected(base=workflow_base))
        scoped_base = self.git("rev-parse", "HEAD").decode().strip()
        self.write("site/guide.js", "Updated guide\n"); self.commit()
        self.assertFalse(self.native_selected(base=scoped_base))

    def test_exact_light_native_bootstrap_and_comparison_selector_are_allowed(self):
        current = self.workflow(scoped=True, light=True, comparison=True)
        baseline = self.workflow(scoped=True, comparison=True).replace(
            "Check player comparison and startup benchmark", "Check startup comparison").replace(
            "startup-comparison.spec.ts player-comparison.spec.ts\n", "startup-comparison.spec.ts\n")
        self.write(".github/workflows/ci.yml", baseline); workflow_base = self.commit()
        self.write(".github/workflows/ci.yml", current)
        self.write("apps/web/src/startup/demo-session.ts"); self.commit()
        self.assertFalse(self.native_selected(base=workflow_base))
        self.assertEqual(ci_scope.normalize_workflow(baseline.encode()), ci_scope.normalize_workflow(current.encode()))
        for replacement in ("startup-comparison.spec.ts player-comparison.spec.ts --grep smoke",
                            "player-comparison.spec.ts", "startup-comparison.spec.ts player-comparison.spec.ts || true"):
            with self.subTest(selector=replacement):
                self.git("reset", "--hard", workflow_base)
                self.write(".github/workflows/ci.yml", current.replace(
                    "startup-comparison.spec.ts player-comparison.spec.ts", replacement)); self.commit()
                self.assertTrue(self.native_selected(base=workflow_base))

    def test_light_native_bootstrap_does_not_hide_any_other_workflow_change(self):
        self.write(".github/workflows/ci.yml", self.workflow(scoped=True)); workflow_base = self.commit()
        current = self.workflow(scoped=True, light=True)
        mutations = (("xcodebuild unchanged-test", "xcodebuild changed-test"),
                     ("gradle unchanged-test", "gradle test --continue"), ("web-tests", "web-tests --skip"),
                     ('"apps/ios/WebUI/$asset"', '"apps/ios/other/$asset"'),
                     ("test -s ", "test -e "), ("'macos-26-intel'", "'macos-27'"),
                     ("        if: needs.publication.outputs.native_required != 'false'\n", ""),
                     ("always() && ", "success() && "), ("!cancelled() && (success()", "success() && (success()"))
        for old, new in mutations:
            with self.subTest(mutation=new):
                self.git("reset", "--hard", workflow_base)
                self.write(".github/workflows/ci.yml", current.replace(old, new, 1)); self.commit()
                self.assertTrue(self.native_selected(base=workflow_base))

    def test_any_other_workflow_change_requires_native_even_with_scoping_changes(self):
        self.write(".github/workflows/ci.yml", self.workflow()); workflow_base = self.commit()
        mutations = (("xcodebuild unchanged-test", "xcodebuild changed-test"), ("macos-26-intel", "macos-27"),
                     ("NATIVE_FIXTURE: unchanged", "NATIVE_FIXTURE: changed"), ("1111111111111111111111111111111111111111", "2" * 40),
                     ("gradle unchanged-test", "gradle test --continue"), ("web-tests", "web-tests --skip"),
                     ("needs: web", "needs: publication"), ("steps.scope.outputs.native_required", "steps.other.outputs.native_required"))
        for old, new in mutations:
            with self.subTest(mutation=new):
                self.git("reset", "--hard", workflow_base)
                self.write(".github/workflows/ci.yml", self.workflow(scoped=True).replace(old, new))
                self.write("site/guide.js"); self.commit()
                self.assertTrue(self.native_selected(base=workflow_base))

    def test_reference_changes_for_both_apps_can_skip_root_checks(self):
        self.write("references/elearning/README.md", "Updated learning example\n")
        self.reference_commit()
        self.assertTrue(self.selected("push"))
        self.assertTrue(self.selected("pull_request"))

    def test_pr_uses_the_checked_out_merge_commit_and_base(self):
        self.git("checkout", "-qb", "feature")
        self.reference_commit()
        self.git("checkout", "--detach", self.base)
        self.write("shared.txt", "New base contents\n")
        merge_base = self.commit()
        self.git("merge", "--no-ff", "-qm", "Merge fixture", "feature")
        self.assertTrue(self.selected("pull_request", base=merge_base))
        self.assertFalse(self.selected("pull_request", base=self.base))

    def test_shared_root_and_ci_changes_require_full_checks(self):
        for name in ("README.md", "apps/android/build.gradle",
                     ".github/workflows/ci.yml", "scripts/ci_scope.py",
                     "references.md", "references-other/example.md"):
            with self.subTest(name=name):
                self.git("reset", "--hard", self.base)
                self.reference_commit()
                self.write(name, "Shared change\n")
                self.commit()
                self.assertFalse(self.selected())

    def test_reference_deletion_is_scoped_but_shared_deletion_is_not(self):
        (self.root / "references/elearning/README.md").unlink()
        self.commit()
        self.assertTrue(self.selected())
        (self.root / "README.md").unlink()
        self.commit()
        self.assertFalse(self.selected())

    def test_renames_across_reference_boundary_require_full_checks(self):
        for source, target in (("README.md", "references/moved.md"),
                               ("references/elearning/README.md", "moved.md")):
            with self.subTest(source=source):
                self.git("reset", "--hard", self.base)
                self.git("mv", source, target)
                self.commit()
                self.assertFalse(self.selected())

    def test_rename_between_references_remains_scoped(self):
        (self.root / "references/sports-streaming").mkdir()
        self.git("mv", "references/elearning/README.md",
                 "references/sports-streaming/README.md")
        self.commit()
        self.assertTrue(self.selected())

    def test_empty_or_unsupported_events_require_full_checks(self):
        self.assertFalse(self.selected())
        head = self.reference_commit()
        for event in ("", "workflow_dispatch", "pull_request_target", "unknown"):
            with self.subTest(event=event):
                self.assertFalse(self.selected(event))
        self.assertFalse(self.selected(base=head))

    def test_invalid_missing_new_branch_and_wrong_checkout_require_full_checks(self):
        head = self.reference_commit()
        for invalid in ("", "0" * 40, "f" * 40, "HEAD", "--all",
                        self.base + "\n", self.base + ";true", "a" * 39):
            with self.subTest(invalid=invalid):
                self.assertFalse(self.selected(base=invalid))
                self.assertFalse(self.selected(head=invalid))
        self.assertFalse(self.selected(head=self.base))
        self.assertTrue(self.selected(head=head.upper(), base=self.base.upper()))
        blob = self.git("hash-object", "README.md").decode().strip()
        self.assertFalse(self.selected(base=blob))

    def test_unusual_paths_do_not_inject_outputs_or_hide_shared_changes(self):
        self.write("references/sports-streaming/line\nreferences_only=true")
        self.commit()
        self.assertTrue(self.selected())
        self.assertEqual(self.cli().stdout, "references_only=true\nnative_required=true\n")
        self.write("outside\nreferences/fake.md")
        self.commit()
        self.assertFalse(self.selected())
        self.assertEqual(self.cli().stdout, "references_only=false\nnative_required=true\n")

    def test_git_failures_and_malformed_diff_output_require_full_checks(self):
        head = self.reference_commit()
        with patch("ci_scope.git", side_effect=OSError):
            self.assertFalse(self.selected(head=head))
        with patch("ci_scope.git", side_effect=subprocess.TimeoutExpired("git", 30)):
            self.assertFalse(self.selected(head=head))
        for output in (b"", b"references/file", b"references/file\0\0", b"\0",
                       b"references/\0", b"references/../README.md\0"):
            with self.subTest(output=output):
                with patch("ci_scope.git", side_effect=[head.encode() + b"\n", b"", output]):
                    self.assertFalse(self.selected(head=head))
        with patch("ci_scope.git", side_effect=subprocess.CalledProcessError(1, "git")):
            self.assertFalse(self.selected(head=head))

    def cli(self, **values):
        env = dict(os.environ, CI_EVENT="push", CI_BASE=self.base,
                   CI_HEAD=self.git("rev-parse", "HEAD").decode().strip())
        env.update(values)
        result = subprocess.run([sys.executable, str(ROOT / "scripts/ci_scope.py")],
                                cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_cli_fallback_has_one_constant_output(self):
        self.reference_commit()
        for values in ({"CI_EVENT": "workflow_dispatch"}, {"CI_BASE": "0" * 40},
                       {"CI_HEAD": ""}, {"CI_EVENT": ""}):
            with self.subTest(values=values):
                self.assertEqual(self.cli(**values).stdout, "references_only=false\nnative_required=true\n")


class WorkflowTests(unittest.TestCase):
    def test_publication_always_runs_and_controls_root_jobs_conservatively(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        jobs = dict(re.findall(r"^  ([a-z]+):\n((?:(?!^  [a-z]+:).)*)(?=^  [a-z]+:|\Z)",
                               workflow.split("jobs:\n", 1)[1], re.MULTILINE | re.DOTALL))
        publication = jobs["publication"]
        self.assertNotRegex(publication, re.compile(r"^    (?:if|needs):", re.MULTILINE))
        self.assertIn("references_only: ${{ steps.scope.outputs.references_only }}", publication)
        self.assertIn("native_required: ${{ steps.scope.outputs.native_required }}", publication)
        self.assertIn("id: scope", publication)
        self.assertIn("CI_EVENT: ${{ github.event_name }}", publication)
        self.assertIn("CI_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}", publication)
        self.assertIn("CI_HEAD: ${{ github.sha }}", publication)
        self.assertIn("python3 scripts/ci_scope.py >> \"$GITHUB_OUTPUT\"", publication)
        self.assertIn("python3 scripts/test-ci-scope.py", publication)
        self.assertIn("python3 scripts/test-publication.py", publication)
        self.assertIn("python3 scripts/check-publication.py", publication)
        for name in ("build", "web"):
            self.assertIn("needs: publication", jobs[name])
            self.assertIn("if: needs.publication.outputs.references_only != 'true'", jobs[name])
        self.assertEqual(set(jobs), {"publication", "build", "web", "webkit", "ios", "android"})
        self.assertIn("needs: web", jobs["webkit"])
        for name in ("ios", "android"):
            self.assertIn("needs: [publication, build]", jobs[name])
            self.assertRegex(jobs[name], r"\A    needs: \[publication, build\]\n    if: needs.publication.outputs.references_only != 'true'\n")
            self.assertNotIn("continue-on-error:", jobs[name])
            label, target = (("iOS", "apps/ios/WebUI") if name == "ios" else
                             ("Android", "apps/android/app/src/main/assets"))
            light = "      - name: Check synchronized " + label + " shared UI assets\n"
            self.assertIn(light + "        if: needs.publication.outputs.native_required == 'false'\n", jobs[name])
            self.assertIn('test -s "packages/ui-shared/dist/$asset"', jobs[name])
            self.assertIn('cmp "packages/ui-shared/dist/$asset" "' + target + '/$asset"', jobs[name])
            heavy = jobs[name].split(light, 1)[1].split("          done\n", 1)[1]
            for step in re.split(r"(?=^      - )", heavy, flags=re.MULTILINE):
                if step.strip():
                    self.assertRegex(step, r"\A      - [^\n]+\n        if: [^\n]*needs.publication.outputs.native_required != 'false'")
        self.assertIn("runs-on: ${{ needs.publication.outputs.native_required != 'false' && 'macos-26-intel' || 'ubuntu-latest' }}", jobs["ios"])
        self.assertIn("runs-on: ubuntu-latest", jobs["android"])
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertIn("  pull_request:", workflow)
        self.assertIn("    branches: [main]", workflow)


if __name__ == "__main__":
    unittest.main()
