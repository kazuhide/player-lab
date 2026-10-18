#!/usr/bin/env python3
"""Offline regression tests for Encoding resource resolution; never call an account."""

import importlib.util
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from bitmovin_api_sdk import S3Output
ROOT = Path(__file__).resolve().parent.parent
FIRST_ID = "11111111-1111-4111-8111-111111111111"
SECOND_ID = "22222222-2222-4222-8222-222222222222"
NAME = "test output"


def item(number, name="other"):
    return {"id": "%08x-0000-4000-8000-000000000000" % number, "name": name}


def load_multicodec():
    spec = importlib.util.spec_from_file_location(
        "multicodec", ROOT / "encoding/vod-multicodec-pertitle/multicodec_pertitle.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ShellResolutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.calls = self.directory / "calls.jsonl"
        cli = self.directory / "bitmovin"
        cli.write_text("#!" + sys.executable + "\n" + r'''
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["TEST_CALLS"], "a") as f:
    f.write(json.dumps(args) + "\n")
if "list" in args:
    offset = args[args.index("--offset") + 1]
    page = json.loads(Path(os.environ["TEST_PAGES"]).read_text()).get(offset, [])
    if isinstance(page, dict) and "failure" in page:
        print(page["failure"])
        sys.exit(1)
    print(json.dumps(page))
elif "config" in args:
    print(json.dumps({"tenantOrgId": "test-org"}))
elif "create" in args:
    if os.environ.get("TEST_HTTP_OUTCOME") == "error":
        print(os.environ["BITMOVIN_OUTPUT_SECRET_KEY"])
        sys.exit(1)
    print("created: 33333333-3333-4333-8333-333333333333")
elif "validate" in args:
    print("valid")
else:
    sys.exit(2)
''')
        cli.chmod(0o700)
        self.env = {"PATH": str(self.directory) + os.pathsep + os.environ["PATH"],
                    "TEST_CALLS": str(self.calls),
                    "BITMOVIN_OUTPUT_NAME": NAME}

    def resolve(self, pages, no_create="--no-create"):
        fixture = self.directory / "pages.json"
        fixture.write_text(json.dumps(pages))
        self.env["TEST_PAGES"] = str(fixture)
        return subprocess.run(
            ["bash", "-c", 'set -euo pipefail; . "$1/encoding/lib.sh"; '
             'encoding_resolve_output_id "$2"', "test", str(ROOT), no_create],
            env=self.env, text=True, capture_output=True)

    def offsets(self):
        return [args[args.index("--offset") + 1] for args in
                map(json.loads, self.calls.read_text().splitlines()) if "list" in args]

    def test_no_exact_match_uses_dry_run_placeholder(self):
        result = self.resolve({"0": [{"name": NAME + " suffix", "id": FIRST_ID}]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "00000000-0000-0000-0000-000000000000")
        self.assertEqual(self.offsets(), ["0"])
        self.assertNotIn("create", self.calls.read_text())

    def test_output_name_is_a_literal_value(self):
        self.env["BITMOVIN_OUTPUT_NAME"] = 'output "with quotes"'
        result = self.resolve({"0": [{"id": FIRST_ID,
                                     "name": self.env["BITMOVIN_OUTPUT_NAME"]}]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), FIRST_ID)

    def test_one_exact_match_requires_the_end_of_listing(self):
        first = [item(n) for n in range(100)]
        first[0] = {"id": FIRST_ID, "name": NAME}
        result = self.resolve({"0": first, "100": []})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), FIRST_ID)
        self.assertEqual(self.offsets(), ["0", "100"])

    def test_duplicate_on_a_later_page_never_creates(self):
        first = [item(n) for n in range(100)]
        first[0] = {"id": FIRST_ID, "name": NAME}
        result = self.resolve({"0": first, "100": [{"id": SECOND_ID, "name": NAME}]}, "")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("OUTPUT_ID", result.stderr)
        self.assertEqual(self.offsets(), ["0", "100"])
        self.assertNotIn("create", self.calls.read_text())

    def test_later_page_failure_is_not_a_unique_result(self):
        first = [item(n) for n in range(100)]
        first[0] = {"id": FIRST_ID, "name": NAME}
        result = self.resolve({"0": first, "100": {"failure": "unavailable"}})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("create", self.calls.read_text())

    def test_invalid_listing_does_not_echo_its_response_body(self):
        for page in ({"failure": "dummy-secret"}, {"message": "dummy-secret"}):
            with self.subTest(page=page):
                result = self.resolve({"0": page}, "")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("dummy-secret", result.stdout + result.stderr)
        self.assertNotIn("create", self.calls.read_text())

    def prepare_bootstrap(self, outcome):
        self.env.update(BITMOVIN_API_KEY="dummy-api", BITMOVIN_OUTPUT_BUCKET="example-bucket",
                        BITMOVIN_OUTPUT_REGION="ap-northeast-1",
                        BITMOVIN_OUTPUT_ACCESS_KEY="dummy-access",
                        BITMOVIN_OUTPUT_SECRET_KEY="dummy-secret",
                        BITMOVIN_TENANT_ORG_ID="different-org", TEST_HTTP_OUTCOME=outcome,
                        TEST_HTTP_CALLS=str(self.directory / "http.jsonl"),
                        PYTHONPATH=str(self.directory))
        wrapper = self.directory / "python3"
        wrapper.write_text("#!" + sys.executable + "\n" +
                           "import json, os, sys\n" +
                           "with open(os.environ['TEST_CALLS'], 'a') as f: " +
                           "f.write(json.dumps(sys.argv) + '\\n')\n" +
                           "os.execv(" + repr(sys.executable) +
                           ", [" + repr(sys.executable) + "] + sys.argv[1:])\n")
        wrapper.chmod(0o700)
        (self.directory / "sitecustomize.py").write_text(r'''
import json, os, requests
class Response:
    text = json.dumps({"status": "SUCCESS", "data": {"result": {
        "id": "33333333-3333-4333-8333-333333333333"}}})
    def raise_for_status(self): pass
    def json(self): return json.loads(self.text)
def request(method, url, **kwargs):
    with open(os.environ["TEST_HTTP_CALLS"], "a") as f:
        f.write(json.dumps({"method": method, "url": url, **kwargs}) + "\n")
    if os.environ["TEST_HTTP_OUTCOME"] == "error":
        raise RuntimeError(os.environ["BITMOVIN_OUTPUT_SECRET_KEY"])
    return Response()
requests.request = request
''')

    def test_bootstrap_keeps_credentials_out_of_subprocess_arguments_and_logs(self):
        self.prepare_bootstrap("success")
        result = self.resolve({"0": []}, "")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "33333333-3333-4333-8333-333333333333")
        observed = result.stdout + result.stderr + self.calls.read_text()
        for credential in ("dummy-access", "dummy-secret", "dummy-api"):
            self.assertNotIn(credential, observed)
        http = json.loads((self.directory / "http.jsonl").read_text())
        payload = json.loads(http["data"])
        self.assertEqual(payload["accessKey"], "dummy-access")
        self.assertEqual(payload["secretKey"], "dummy-secret")
        self.assertEqual(payload["cloudRegion"], "AP_NORTHEAST_1")
        self.assertEqual(http["headers"]["X-Tenant-Org-Id"], "test-org")
        self.assertTrue(http["url"].endswith("/encoding/outputs/s3"))
        self.assertEqual(http["method"], "POST")

    def test_bootstrap_error_does_not_print_the_sdk_payload_or_credentials(self):
        self.prepare_bootstrap("error")
        result = self.resolve({"0": []}, "")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        observed = result.stderr + self.calls.read_text()
        for credential in ("dummy-access", "dummy-secret", "dummy-api"):
            self.assertNotIn(credential, observed)
        self.assertIn("creation failed", result.stderr)

    def test_entrypoints_stop_before_starting_when_output_is_ambiguous(self):
        pages = [{"id": FIRST_ID, "name": NAME}, {"id": SECOND_ID, "name": NAME}]
        fixture = self.directory / "pages.json"
        fixture.write_text(json.dumps({"0": pages}))
        self.env.update(TEST_PAGES=str(fixture), BITMOVIN_API_KEY="dummy-api")
        for script in ("encoding/test-streams/provision.sh", "encoding/live-dvr/start.sh"):
            with self.subTest(script=script):
                result = subprocess.run(["bash", str(ROOT / script), "vod-baseline"],
                                        env=self.env, text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("OUTPUT_ID", result.stderr)
        calls = self.calls.read_text()
        self.assertNotIn("create", calls)
        self.assertNotIn("validate", calls)
        self.assertNotIn("start", calls)

    def test_explicit_ids_bypass_listing_and_creation(self):
        self.env.update(OUTPUT_ID=SECOND_ID, INPUT_ID=FIRST_ID,
                        BITMOVIN_API_KEY="dummy-api", DRY_RUN="1")
        for script in ("encoding/test-streams/provision.sh", "encoding/live-dvr/start.sh"):
            with self.subTest(script=script):
                result = subprocess.run(["bash", str(ROOT / script), "vod-baseline"],
                                        env=self.env, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
        calls = list(map(json.loads, self.calls.read_text().splitlines()))
        self.assertEqual(len(calls), 2)
        self.assertTrue(all("validate" in args for args in calls))


class PythonResolutionTests(unittest.TestCase):
    def setUp(self):
        self.module = load_multicodec()
        self.outputs = Mock()
        self.module.api = SimpleNamespace(encoding=SimpleNamespace(
            outputs=SimpleNamespace(s3=self.outputs)))
        self.environment = patch.dict(os.environ, {
            "BITMOVIN_API_KEY": "dummy-api",
            "BITMOVIN_OUTPUT_NAME": NAME,
            "BITMOVIN_OUTPUT_BUCKET": "example-bucket",
            "BITMOVIN_OUTPUT_ACCESS_KEY": "dummy-access",
            "BITMOVIN_OUTPUT_SECRET_KEY": "dummy-secret",
        }, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_no_exact_match_creates_once(self):
        self.outputs.list.return_value = SimpleNamespace(items=[SimpleNamespace(
            id=FIRST_ID, name=NAME + " suffix")])
        expected = SimpleNamespace(id=SECOND_ID)
        self.outputs.create.return_value = expected
        self.assertIs(self.module._resolve_output(), expected)
        self.outputs.create.assert_called_once()

    def test_creation_error_omits_the_payload_and_credentials(self):
        self.outputs.list.return_value = SimpleNamespace(items=[])
        self.outputs.create.side_effect = RuntimeError("dummy-access dummy-secret")
        with self.assertRaises(SystemExit) as error:
            self.module._resolve_output()
        self.assertIn("creation failed", str(error.exception))
        self.assertNotIn("dummy-access", str(error.exception))
        self.assertNotIn("dummy-secret", str(error.exception))

    def test_sdk_request_logging_is_disabled_for_credentials(self):
        os.environ["BITMOVIN_API_KEY"] = "dummy-api"
        response = Mock(text='{"status":"SUCCESS","data":{"result":{}}}')
        response.json.return_value = json.loads(response.text)
        output = io.StringIO()
        with patch("requests.request", return_value=response), redirect_stdout(output), redirect_stderr(output):
            client = self.module._api()
            client.encoding.outputs.s3.create(s3_output=S3Output(
                bucket_name="example-bucket", access_key="dummy-access", secret_key="dummy-secret"))
        for credential in ("dummy-access", "dummy-secret", "dummy-api"):
            self.assertNotIn(credential, output.getvalue())

    def test_one_exact_match_requires_the_end_of_listing(self):
        output = SimpleNamespace(id=FIRST_ID, name=NAME)
        self.outputs.list.side_effect = [SimpleNamespace(items=[output] + [
            SimpleNamespace(**item(n)) for n in range(99)]), SimpleNamespace(items=[])]
        self.assertIs(self.module._resolve_output(), output)
        self.assertEqual(self.outputs.list.call_count, 2)
        self.outputs.create.assert_not_called()

    def test_duplicate_on_a_later_page_never_creates(self):
        first = [SimpleNamespace(id=FIRST_ID, name=NAME)] + [
            SimpleNamespace(**item(n)) for n in range(99)]
        self.outputs.list.side_effect = [SimpleNamespace(items=first), SimpleNamespace(
            items=[SimpleNamespace(id=SECOND_ID, name=NAME)])]
        with self.assertRaisesRegex(SystemExit, "OUTPUT_ID"):
            self.module._resolve_output()
        self.outputs.create.assert_not_called()

    def test_explicit_id_bypasses_name_resolution_and_creation(self):
        os.environ["OUTPUT_ID"] = SECOND_ID
        expected = SimpleNamespace(id=SECOND_ID)
        self.outputs.get.return_value = expected
        self.assertIs(self.module._resolve_output(), expected)
        self.outputs.get.assert_called_once_with(output_id=SECOND_ID)
        self.outputs.list.assert_not_called()
        self.outputs.create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
