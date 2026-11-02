"""Offline behavioral checks for the bounded Apple result upload policy."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import io
import json
import os
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import time
import zipfile

spec = spec_from_file_location("apple_result_evidence", Path(__file__).with_name("apple-result-evidence.py"))
evidence = module_from_spec(spec)
spec.loader.exec_module(evidence)


class ResultEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bundle = self.root / "apple-profiles-ios.xcresult"
        (self.bundle / "Data").mkdir(parents=True)
        (self.bundle / "Info.plist").write_bytes(b"fixture plist")
        (self.bundle / "Data/results").write_bytes(b"completed native result")
        self.env = {
            "RUNNER_TEMP": str(self.root), "GITHUB_REPOSITORY": "owner/repository",
            "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "ios",
            "GITHUB_SHA": "a" * 40, "EVIDENCE_SOURCE_HEAD": "b" * 40,
            "GITHUB_EVENT_NAME": "pull_request", "GITHUB_API_URL": "https://api.github.com",
            "GITHUB_TOKEN": "fixture-secret-never-recorded",
        }
        self.run_metadata = {
            "id": 123, "run_attempt": 1, "head_sha": "b" * 40,
            "event": "pull_request", "repository": {"full_name": "owner/repository"},
        }
        self.requests = []

    def api(self, path):
        self.requests.append(path)
        return self.run_metadata if "/attempts/" in path else {"total_count": 0, "artifacts": []}

    def outcomes(self, first="success", second="skipped", guard="skipped"):
        return {**self.env, "FIRST_OUTCOME": first, "SECOND_OUTCOME": second,
                "GUARD_OUTCOME": guard, "FIRST_ARTIFACT_ID": "456" if first == "success" else "",
                "FIRST_ARTIFACT_DIGEST": "c" * 64 if first == "success" else "",
                "SECOND_ARTIFACT_ID": "789" if second == "success" else "",
                "SECOND_ARTIFACT_DIGEST": "d" * 64 if second == "success" else ""}

    def test_first_success_does_not_lookup_retry_or_delete(self):
        evidence.seal("ios", self.env)
        with patch.object(evidence, "request_metadata", side_effect=AssertionError("No REST on first success")):
            receipt = evidence.finish("ios", self.outcomes())
        self.assertEqual(receipt["attempts"], ["success", "skipped"])
        self.assertEqual(receipt["artifactId"], 456)
        self.assertEqual(receipt["sourceHead"], "b" * 40)
        self.assertNotIn(self.env["GITHUB_TOKEN"], json.dumps(receipt))

    def test_one_recovery_preserves_exact_bundle_and_original_failure(self):
        manifest = evidence.seal("ios", self.env)
        evidence.guard("ios", self.env, self.api)
        receipt = evidence.finish("ios", self.outcomes("failure", "success", "success"))
        self.assertEqual(receipt["attempts"], ["failure", "success"])
        self.assertEqual(receipt["artifactId"], 789)
        self.assertEqual(receipt["contentDigest"], manifest["contentDigest"])
        self.assertEqual(len(self.requests), 2)
        with self.assertRaises(evidence.EvidenceError):
            evidence.guard("ios", self.env, self.api)

    def test_failed_or_impossible_upload_sequences_fail_closed(self):
        cases = [("failure", "failure", "success"), ("failure", "skipped", "failure"),
                 ("success", "success", "success"), ("success", "skipped", "success"),
                 ("skipped", "skipped", "skipped"), ("cancelled", "success", "success")]
        for first, second, guard in cases:
            with self.subTest(first=first, second=second, guard=guard), TemporaryDirectory() as directory:
                env = {**self.env, "RUNNER_TEMP": directory}
                bundle = Path(directory) / self.bundle.name
                bundle.mkdir()
                (bundle / "result").write_bytes(b"once")
                evidence.seal("ios", env)
                with self.assertRaises(evidence.EvidenceError):
                    evidence.finish("ios", {**self.outcomes(first, second, guard), "RUNNER_TEMP": directory})

    def test_existing_or_uncertain_metadata_never_allows_recovery(self):
        evidence.seal("ios", self.env)
        candidates = [
            {"total_count": 1, "artifacts": [{"id": 98, "name": "apple-profiles-ios-ui-results"}]},
            {"total_count": 2, "artifacts": []},
            {"total_count": True, "artifacts": []},
            {"total_count": 0, "artifacts": "unknown"},
        ]
        for candidate in candidates:
            with self.subTest(metadata=candidate):
                def api(path):
                    return self.run_metadata if "/attempts/" in path else candidate
                with self.assertRaises(evidence.EvidenceError):
                    evidence.guard("ios", self.env, api)
        with self.assertRaises(evidence.EvidenceError):
            evidence.guard("ios", self.env, lambda path: (_ for _ in ()).throw(OSError("lookup failed")))

    def test_run_attempt_repository_and_head_identity_must_match(self):
        evidence.seal("ios", self.env)
        for field, value in (("id", 124), ("run_attempt", 2), ("run_attempt", True), ("head_sha", "e" * 40),
                             ("repository", {"full_name": "other/repository"}), ("event", "push")):
            with self.subTest(field=field):
                metadata = {**self.run_metadata, field: value}
                with self.assertRaises(evidence.EvidenceError):
                    evidence.guard("ios", self.env, lambda path: metadata)

    def test_missing_changed_unsafe_or_second_producer_input_is_rejected(self):
        evidence.seal("ios", self.env)
        with self.assertRaises(evidence.EvidenceError):
            evidence.seal("ios", self.env)
        (self.bundle / "Data/results").write_bytes(b"changed")
        with self.assertRaises(evidence.EvidenceError):
            evidence.guard("ios", self.env, self.api)
        self.assertEqual(self.requests, [])
        with self.assertRaises(evidence.EvidenceError):
            evidence.finish("ios", self.outcomes())
        with self.assertRaises(evidence.EvidenceError):
            evidence.snapshot(self.root / "missing")
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "link").symlink_to(self.bundle / "Info.plist")
            with self.assertRaises(evidence.EvidenceError):
                evidence.snapshot(root)
        with patch.object(evidence, "MAX_BYTES", 3):
            with self.assertRaises(evidence.EvidenceError):
                evidence.snapshot(self.bundle)
        for name in (".hidden", "control\nname", "unsafe:name"):
            with TemporaryDirectory() as directory:
                (Path(directory) / name).write_bytes(b"must not be omitted")
                with self.assertRaises(evidence.EvidenceError):
                    evidence.snapshot(Path(directory))
        with TemporaryDirectory() as directory, TemporaryDirectory() as foreign:
            root = Path(directory)
            (root / "apple-profiles-startup-diagnostics").symlink_to(foreign, target_is_directory=True)
            with self.assertRaises(evidence.EvidenceError):
                evidence.seal("ios", {**self.env, "RUNNER_TEMP": directory})
            self.assertEqual(list(Path(foreign).iterdir()), [])

    def test_missing_or_invalid_success_outputs_cannot_pass(self):
        evidence.seal("ios", self.env)
        for key, value in (("FIRST_ARTIFACT_ID", ""), ("FIRST_ARTIFACT_ID", "0"),
                           ("FIRST_ARTIFACT_ID", "12/foreign"), ("FIRST_ARTIFACT_DIGEST", ""),
                           ("FIRST_ARTIFACT_DIGEST", "not-a-sha256")):
            with self.subTest(key=key, value=value), self.assertRaises(evidence.EvidenceError):
                evidence.finish("ios", {**self.outcomes(), key: value})

    def test_archive_roundtrip_proves_members_and_rejects_tampering(self):
        manifest = evidence.seal("ios", self.env)
        archive = self.root / "original.zip"
        def create(tamper=False):
            with zipfile.ZipFile(archive, "w") as output:
                for path in sorted(self.bundle.rglob("*")):
                    if path.is_file():
                        data = path.read_bytes()
                        output.writestr(path.relative_to(self.bundle).as_posix(), data + b"!" if tamper else data)
            return hashlib.sha256(archive.read_bytes()).hexdigest()
        digest = create()
        self.assertEqual(evidence.verify_archive(manifest, archive, digest), manifest["contentDigest"])
        with self.assertRaises(evidence.EvidenceError):
            evidence.verify_archive(manifest, archive, "e" * 64)
        digest = create(tamper=True)
        with self.assertRaises(evidence.EvidenceError):
            evidence.verify_archive(manifest, archive, digest)
        for name in ("../escape", "/absolute", "unexpected"):
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr(name, b"unsafe")
            with self.assertRaises(evidence.EvidenceError):
                evidence.verify_archive(manifest, archive, hashlib.sha256(archive.read_bytes()).hexdigest())

    def test_terminal_gate_keeps_every_native_prerequisite_and_diagnostic_failure(self):
        success = {name: "success" for name in evidence.REQUIRED_STEPS}
        evidence.terminal_gate(success, False)
        for name in success:
            for outcome in ("failure", "skipped", "cancelled", ""):
                with self.subTest(name=name, outcome=outcome), self.assertRaises(evidence.EvidenceError):
                    evidence.terminal_gate({**success, name: outcome}, False)
        with self.assertRaises(evidence.EvidenceError):
            evidence.terminal_gate(success, True)

    def test_terminal_receipts_reject_valid_but_wrong_ids_digests_and_changed_bytes(self):
        env = dict(self.env)
        for platform in ("ios", "tvos"):
            if platform == "tvos":
                bundle = self.root / "apple-profiles-tvos.xcresult"
                bundle.mkdir()
                (bundle / "results").write_bytes(b"TV completed result")
            evidence.seal(platform, env)
            receipt = evidence.finish(platform, self.outcomes())
            env.update({platform.upper() + "_ARTIFACT_ID": str(receipt["artifactId"]),
                        platform.upper() + "_ARTIFACT_DIGEST": receipt["artifactDigest"],
                        platform.upper() + "_CONTENT_DIGEST": receipt["contentDigest"]})
        evidence.validate_upload_receipts(env)
        for key, value in (("IOS_ARTIFACT_ID", "999"), ("TVOS_ARTIFACT_DIGEST", "f" * 64),
                           ("IOS_CONTENT_DIGEST", "e" * 64), ("TVOS_ARTIFACT_ID", "")):
            with self.subTest(key=key), self.assertRaises(evidence.EvidenceError):
                evidence.validate_upload_receipts({**env, key: value})
        (self.bundle / "Info.plist").write_bytes(b"changed after successful upload")
        with self.assertRaises(evidence.EvidenceError):
            evidence.validate_upload_receipts(env)

    def test_http_lookup_is_bounded_current_run_only_and_never_follows_redirects(self):
        path = "/repos/owner/repository/actions/runs/123/attempts/1"
        class Response(io.BytesIO):
            status = 200
            headers = {}
            def geturl(self):
                return "https://api.github.com" + path
        response = Response(json.dumps(self.run_metadata).encode())
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return response
        opener = Opener()
        with patch.object(evidence.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(evidence.request_metadata(path, self.env, time.monotonic() + 10), self.run_metadata)
        self.assertEqual(opener.request.full_url, "https://api.github.com" + path)
        self.assertEqual(opener.request.get_method(), "GET")
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer " + self.env["GITHUB_TOKEN"])
        self.assertLessEqual(opener.timeout, 5)
        for body, headers, url in ((b"{}", {"Link": "next-page"}, "https://api.github.com" + path),
                                   (b'{"id":1,"id":2}', {}, "https://api.github.com" + path),
                                   (b"x" * 32, {}, "https://api.github.com" + path),
                                   (b"{}", {}, "https://other.invalid/signed-secret")):
            with self.subTest(headers=headers, url=url):
                response = Response(body)
                response.headers = headers
                response.geturl = lambda: url
                with patch.object(evidence.urllib.request, "build_opener", return_value=opener), \
                        patch.object(evidence, "MAX_RESPONSE", 16), self.assertRaises(evidence.EvidenceError) as caught:
                    evidence.request_metadata(path, self.env, time.monotonic() + 10)
                self.assertNotIn("signed-secret", str(caught.exception))
                self.assertNotIn(self.env["GITHUB_TOKEN"], str(caught.exception))
        for candidate, env, deadline in (("/repos/other/repository/actions/runs/123/artifacts", self.env, time.monotonic() + 10),
                                          (path, {**self.env, "GITHUB_API_URL": "https://other.invalid"}, time.monotonic() + 10),
                                          (path, self.env, time.monotonic() - 1)):
            with self.assertRaises(evidence.EvidenceError):
                evidence.request_metadata(candidate, env, deadline)
        with self.assertRaises(evidence.EvidenceError):
            evidence.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid")

    def simulate_composite(self, upload_results, *, existing=False, mutate=False, cancelled=False):
        """Execute the checked-in composite's predicates with a fake upload boundary."""
        action = Path(__file__).resolve().parents[1] / ".github/actions/upload-apple-results/action.yml"
        steps = action.read_text().split("  steps:\n", 1)[1].split("    - id: ")[1:]
        outcomes, outputs, calls, error = {}, {}, [], None
        for step in steps:
            identifier = step.splitlines()[0]
            condition = re.search(r"      if: (.*)", step)
            if condition:
                expression = condition.group(1).removeprefix("${{ ").removesuffix(" }}")
                expression = expression.replace("!cancelled()", repr(not cancelled)).replace("always()", "True")
                expression = re.sub(r"steps\.(\w+)\.outcome", lambda match: repr(outcomes.get(match[1], "skipped")), expression)
                expression = expression.replace("&&", " and ").replace("||", " or ")
                if not eval(expression, {"__builtins__": {}}, {}):
                    outcomes[identifier] = "skipped"
                    continue
            try:
                if identifier == "seal":
                    outputs[identifier] = evidence.seal("ios", self.env)
                elif "uses: actions/upload-artifact@" in step:
                    self.assertIn("overwrite: false", step)
                    self.assertIn("retention-days: 7", step)
                    self.assertIn("ea165f8d65b6e75b540449e92b4886f43607fa02", step)
                    self.assertIn("continue-on-error: true", step)
                    calls.append(evidence.snapshot(self.bundle)["members"])
                    result = upload_results[len(calls) - 1]
                    if mutate:
                        (self.bundle / "Data/results").write_bytes(b"writer changed bytes")
                    if result != "success":
                        raise OSError(result)
                    outputs[identifier] = {"artifact-id": "456", "artifact-digest": "c" * 64}
                elif identifier == "guard":
                    def lookup(path):
                        if "/attempts/" in path:
                            return self.run_metadata
                        return {"total_count": 1, "artifacts": [{"id": 8, "name": "apple-profiles-ios-ui-results"}]} if existing else {"total_count": 0, "artifacts": []}
                    evidence.guard("ios", self.env, lookup)
                elif identifier == "finish":
                    env = {**self.env, "FIRST_OUTCOME": outcomes.get("first", "skipped"),
                           "SECOND_OUTCOME": outcomes.get("second", "skipped"), "GUARD_OUTCOME": outcomes.get("guard", "skipped")}
                    for name in ("first", "second"):
                        for key in ("artifact-id", "artifact-digest"):
                            env[name.upper() + "_" + key.upper().replace("-", "_")] = outputs.get(name, {}).get(key, "")
                    outputs[identifier] = evidence.finish("ios", env)
                else:
                    self.fail("Unexpected composite step")
                outcomes[identifier] = "success"
            except (evidence.EvidenceError, OSError) as caught:
                outcomes[identifier] = "failure"
                error = caught
        return outcomes, outputs, calls, error

    def test_checked_in_composite_runs_at_most_two_uploads_and_never_deletes(self):
        cases = [("success", ["success"], False, False, 1, "success"),
                 ("recovered", ["ENOTFOUND", "success"], False, False, 2, "success"),
                 ("both failed", ["ENOTFOUND", "403 permanent"], False, False, 2, "failure"),
                 ("permanent first failure", ["403 permanent", "403 permanent"], False, False, 2, "failure"),
                 ("partial conflict", ["ENOTFOUND", "409 partial"], False, False, 2, "failure"),
                 ("existing original", ["ENOTFOUND"], True, False, 1, "failure"),
                 ("input changed", ["ENOTFOUND"], False, True, 1, "failure")]
        for label, results, existing, mutate, expected_calls, expected_finish in cases:
            with self.subTest(case=label), TemporaryDirectory() as directory:
                self.env["RUNNER_TEMP"] = directory
                self.bundle = Path(directory) / "apple-profiles-ios.xcresult"
                (self.bundle / "Data").mkdir(parents=True)
                (self.bundle / "Data/results").write_bytes(b"completed once")
                outcomes, outputs, calls, error = self.simulate_composite(results, existing=existing, mutate=mutate)
                self.assertEqual(len(calls), expected_calls)
                self.assertEqual(outcomes["finish"], expected_finish)
                if len(calls) == 2:
                    self.assertEqual(calls[0], calls[1])
                if expected_finish == "success":
                    self.assertEqual(outputs["finish"]["attempts"], [outcomes["first"], outcomes["second"]])
                self.assertLessEqual(len(calls), 2)

    def test_cancelled_composite_does_not_seal_or_upload(self):
        outcomes, outputs, calls, error = self.simulate_composite([], cancelled=True)
        self.assertEqual(calls, [])
        self.assertEqual(outcomes["seal"], "skipped")
        self.assertEqual(outcomes["finish"], "failure")

    def test_actual_workflow_gate_is_wired_to_raw_outcomes_and_required_outputs(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/ci.yml").read_text()
        block = workflow.split("      - name: Require every Apple test and evidence stage\n", 1)[1].split("\n      - ", 1)[0]
        pairs = re.findall(r'"(\w+)": "\$\{\{ steps\.(\w+)\.outcome \}\}"', block)
        self.assertEqual({name: identifier for name, identifier in pairs},
                         {name: name for name in evidence.REQUIRED_STEPS})
        self.assertIn("if: always()", block)
        self.assertLess(workflow.index("      - name: Require every Apple test and evidence stage\n"),
                        workflow.index("      - name: Build iOS app (simulator)\n"))
        env = {**os.environ, **self.env, "CANCELLED": "false"}
        for platform in ("ios", "tvos"):
            if platform == "tvos":
                bundle = self.root / "apple-profiles-tvos.xcresult"
                bundle.mkdir()
                (bundle / "results").write_bytes(b"completed TV")
            evidence.seal(platform, self.env)
            receipt = evidence.finish(platform, self.outcomes())
            for label, output, value in (("ARTIFACT_ID", "artifact-id", str(receipt["artifactId"])),
                                         ("ARTIFACT_DIGEST", "artifact-digest", receipt["artifactDigest"]),
                                         ("CONTENT_DIGEST", "content-digest", receipt["contentDigest"])):
                self.assertIn(platform.upper() + "_" + label + ": ${{ steps." + platform + "_results.outputs." + output + " }}", block)
                env[platform.upper() + "_" + label] = value
        command = re.search(r"        run: (.*)", block).group(1)
        success = {name: "success" for name in evidence.REQUIRED_STEPS}
        for changed, cancelled, expected in ((None, False, 0), ("ios_profiles", False, 1),
                                              ("diagnostic_validation", False, 1), ("shared_ui", False, 1),
                                              ("ios_results", False, 1), (None, True, 1)):
            outcomes = {**success, **({changed: "failure"} if changed else {})}
            result = subprocess.run(["bash", "-e", "-u", "-o", "pipefail", "-c", command], cwd=root,
                                    env={**env, "REQUIRED_OUTCOMES": json.dumps(outcomes), "CANCELLED": str(cancelled).lower()},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, expected, result.stderr)
            self.assertNotIn(self.env["GITHUB_TOKEN"], result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
