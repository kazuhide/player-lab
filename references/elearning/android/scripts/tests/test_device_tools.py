import importlib.util
import contextlib
import io
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


driver = load("elearning_device_driver", "run-device-tests.py")
signatures = load("elearning_junit_signatures", "check_junit_signatures.py")


def instrumentation(count, failed=False):
    text = ""
    for index in range(count):
        text += f"INSTRUMENTATION_STATUS: numtests={count}\nINSTRUMENTATION_STATUS_CODE: 1\n"
        text += f"INSTRUMENTATION_STATUS_CODE: {-2 if failed and index == 0 else 0}\n"
    return text + "INSTRUMENTATION_CODE: -1\n"


class DeviceToolsTest(unittest.TestCase):
    def test_instrumentation_requires_exit_status_and_exact_completed_tests(self):
        self.assertTrue(driver.test_result("core", 0, instrumentation(6), 6).success)
        self.assertFalse(driver.test_result("core", 1, instrumentation(6), 6).success)
        self.assertFalse(driver.test_result("core", 0, "OK (6 tests)\nINSTRUMENTATION_CODE: -1\n", 6).success)
        self.assertFalse(driver.test_result("core", 0, instrumentation(5), 6).success)
        self.assertFalse(driver.test_result("core", 0, instrumentation(6, failed=True), 6).success)
        self.assertFalse(driver.test_result("core", 0, instrumentation(6).replace("CODE: -1", "CODE: 0"), 6).success)

    def test_ignored_or_assumed_cases_are_not_reported_as_passes(self):
        for code in (-3, -4):
            output = instrumentation(1).replace("STATUS_CODE: 0", f"STATUS_CODE: {code}")
            result = driver.test_result("core", 0, output, 1)
            self.assertFalse(result.success)
            self.assertEqual(1, result.skipped)

    def test_junit_preflight_catches_kotlin_expression_return_type(self):
        good = """  public final void works();
    descriptor: ()V
    RuntimeVisibleAnnotations:
      0: #2()
        org.junit.Test
"""
        bad = good.replace("void works()", "androidx.test.core.app.ActivityScenario wrong()").replace("()V", "()Landroidx/test/core/app/ActivityScenario;")
        self.assertEqual((1, []), signatures.inspect(good))
        self.assertEqual(1, len(signatures.inspect(bad)[1]))

    def test_exact_serial_and_no_credential_urls_are_required(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                driver.parse_args(["--media-base-url", "https://media.example.test/"])
            with self.assertRaises(SystemExit):
                driver.parse_args(["--serial", "phone;echo", "--media-base-url", "https://media.example.test/"])
            with self.assertRaises(SystemExit):
                driver.parse_args(["--serial", "phone", "--media-base-url", "https://user:private@media.example.test/"])

    def test_process_restart_order_and_success_cleanup_only_target_owned_app(self):
        calls, code, summary = self.run_fake(fail_core=False)
        self.assertEqual(0, code)
        self.assertTrue(summary["success"])
        self.assertEqual(34, sum(result["passed"] for result in summary["results"]))
        self.assertEqual({"mandatory-hls", "mandatory-dash"}, {result["name"] for result in summary["results"] if result["name"].startswith("mandatory-")})
        remote = [shlex.split(command[-1]) for command in calls if "shell" in command]
        for index, command in enumerate(remote):
            if "prepare" in command:
                self.assertEqual(["am", "force-stop", driver.APP_ID], remote[index + 1])
                self.assertIn("verify", remote[index + 2])
        self.assertEqual(["am", "force-stop", driver.APP_ID], remote[-1])
        self.assert_targeted(calls)

    def test_failed_tests_cannot_be_converted_to_success_and_still_cleanup(self):
        calls, code, summary = self.run_fake(fail_core=True)
        self.assertEqual(1, code)
        self.assertFalse(summary["success"])
        self.assertEqual(["am", "force-stop", driver.APP_ID], shlex.split(calls[-1][-1]))
        self.assertFalse(any("checkpoint-verify" in result["name"] for result in summary["results"]))
        self.assert_targeted(calls)

    def test_adb_daemon_startup_output_does_not_hide_a_ready_explicit_device(self):
        _, code, summary = self.run_fake(False, state_output="* daemon not running; starting now\n* daemon started successfully\ndevice\n")
        self.assertEqual(0, code)
        self.assertTrue(summary["success"])

    def test_bounded_command_failure_still_stops_only_the_owned_app(self):
        calls, code, summary = self.run_fake(False, timeout_core=True)
        self.assertEqual(1, code)
        self.assertIn("timeout", summary["error"])
        self.assertEqual(["am", "force-stop", driver.APP_ID], shlex.split(calls[-1][-1]))
        self.assert_targeted(calls)

    def assert_targeted(self, calls):
        for command in calls:
            if command[0] == "test-adb":
                self.assertEqual(["test-adb", "-P", "5038", "-s", "explicit-device"], command[:5])
            self.assertNotIn("kill-server", command)
            self.assertNotIn("devices", command)

    def run_fake(self, fail_core, state_output="device\n", timeout_core=False):
        calls = []
        class FakeCommands:
            def __init__(self, directory): self.directory = directory
            def run(self, name, command, timeout):
                calls.append(command)
                if name == "device-state": output = state_output
                elif name.startswith("core-"):
                    if timeout_core: raise RuntimeError("bounded timeout")
                    output = instrumentation(6, failed=fail_core)
                elif name.startswith("ownership-"): output = instrumentation(3)
                elif name.startswith("mandatory-"): output = instrumentation(6)
                elif name.startswith("checkpoint-") and "force-stop" not in name: output = instrumentation(1)
                else: output = ""
                return subprocess.CompletedProcess(command, 0, output)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for path in (root / "app/build/outputs/apk/debug/app-debug.apk", root / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"test-only-owned-apk")
            with patch.object(driver, "ROOT", root), patch.object(driver, "Commands", FakeCommands), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = driver.main(["--serial", "explicit-device", "--media-base-url", "http://127.0.0.1:8621/",
                                    "--adb", "test-adb", "--server-port", "5038", "--skip-build"])
            import json
            summary = json.loads(next(root.glob("build/device-tests/*/summary.json")).read_text())
        return calls, code, summary


if __name__ == "__main__":
    unittest.main()
