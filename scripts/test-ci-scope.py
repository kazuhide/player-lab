#!/usr/bin/env python3
"""Verify conservative CI routing against real Git histories."""
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

    def workflow(self, scoped=False):
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
      - run: xcodebuild unchanged-test
  android:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: gradle unchanged-test
"""
        if scoped:
            text = text.replace("      references_only: ${{ steps.scope.outputs.references_only }}\n",
                                "      references_only: ${{ steps.scope.outputs.references_only }}\n      native_required: ${{ steps.scope.outputs.native_required }}\n")
            for job in ("ios", "android"):
                text = text.replace("  " + job + ":\n    needs: build\n",
                                    "  " + job + ":\n    needs: [publication, build]\n    if: needs.publication.outputs.native_required != 'false'\n")
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

    def test_native_shared_dependency_unknown_and_mixed_paths_fail_closed(self):
        for name in ("apps/ios/Native.swift", "apps/android/Main.kt", "apps/web/package.json", "pnpm-lock.yaml",
                     "package-lock.json", "packages/ui-shared/src/app.ts", "shared/schema.json", "site/guide/images/native.png",
                     "scripts/release_other.py", "README.md", "references/elearning/README.md", "docs/guide/en/line\nnative_required=false.json"):
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
            self.assertIn("if: needs.publication.outputs.native_required != 'false'", jobs[name])
            self.assertNotIn("continue-on-error:", jobs[name])
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertIn("  pull_request:", workflow)
        self.assertIn("    branches: [main]", workflow)


if __name__ == "__main__":
    unittest.main()
