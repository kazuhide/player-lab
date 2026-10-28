import contextlib
import importlib.util
import io
from pathlib import Path
import shlex
import subprocess
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("device_driver", Path(__file__).with_name("run-device-tests.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class DeviceDriverTest(unittest.TestCase):
    test_class = "com.playerlab.sportsstreaming.CastPlaybackTest"

    def status(self, test, code, **extra):
        values = {"class": self.test_class, "id": "AndroidJUnitRunner", "test": test,
                  "numtests": "1", "current": "1", **extra}
        return "\n".join(f"INSTRUMENTATION_STATUS: {key}={value}" for key, value in values.items()) + f"\nINSTRUMENTATION_STATUS_CODE: {code}\n"

    def passing_output(self):
        return self.status("receiverPlayback", 1) + self.status("receiverPlayback", 0) + "OK (1 test)\nINSTRUMENTATION_CODE: -1\n"

    def test_explicit_device_is_preserved_on_every_command_prefix(self):
        device = driver.Device("adb", 5045, "authorized-device")
        self.assertEqual(["adb", "-P", "5045", "-s", "authorized-device"], device.prefix)

    def test_shell_parameters_remain_literal_even_with_metacharacters(self):
        values = ["am", "instrument", "-e", "receiverName", "Display; touch /tmp/unwanted", "-e", "sourceUrl", "https://media.test/path?a=1&b=2"]
        self.assertEqual(values, shlex.split(driver.shell_command(values)))

    def test_vda_binary_fallback_preserves_the_explicit_device_and_bytes(self):
        device = driver.Device("vda", 5045, "authorized-device")
        image = b"\x89PNG\r\n\x1a\nactual-bytes"
        with mock.patch.object(driver.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], 1, b"", b"vda: unknown command exec-out"),
            subprocess.CompletedProcess([], 0, image, b""),
        ]) as run:
            self.assertEqual(image, device.read_app_file("files/captures/example.png"))
        self.assertEqual(device.prefix + ["exec-out", "run-as com.playerlab.sportsstreaming cat files/captures/example.png"], run.call_args_list[0].args[0])
        self.assertEqual(device.prefix + ["shell", "-T", "run-as com.playerlab.sportsstreaming cat files/captures/example.png"], run.call_args_list[1].args[0])

    def test_artifact_reader_rejects_other_paths_and_does_not_retry_permission_errors(self):
        device = driver.Device("adb", 5037, "authorized-device")
        with mock.patch.object(driver.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                device.read_app_file("files/../private.env")
            run.assert_not_called()
        with mock.patch.object(driver.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"Permission denied")) as run:
            with self.assertRaises(RuntimeError):
                device.read_app_file("files/captures/example.png")
            self.assertEqual(1, run.call_count)

    def test_installed_apk_digest_is_scoped_and_rejects_unhandled_splits(self):
        device = driver.Device("vda", 5045, "authorized-device")
        digest = "a" * 64
        with mock.patch.object(device, "shell", side_effect=[
            subprocess.CompletedProcess([], 0, "package:/data/app/owned/base.apk\n", ""),
            subprocess.CompletedProcess([], 0, digest + "  /data/app/owned/base.apk\n", ""),
        ]) as shell:
            self.assertEqual(digest, device.installed_apk_sha256(driver.PACKAGE))
            self.assertEqual(mock.call("pm", "path", driver.PACKAGE), shell.call_args_list[0])
        with mock.patch.object(device, "shell", return_value=subprocess.CompletedProcess([], 0, "package:/data/app/base.apk\npackage:/data/app/split.apk\n", "")):
            with self.assertRaises(RuntimeError):
                device.installed_apk_sha256(driver.PACKAGE)
        with self.assertRaises(ValueError):
            device.installed_apk_sha256("unrelated.package")

    def test_same_installed_bytes_are_verified_without_reinstalling(self):
        device = mock.Mock(spec=driver.Device)
        device.installed_apk_sha256.return_value = "a" * 64
        proof = driver.ensure_installed(device, Path("app.apk"), driver.PACKAGE, "a" * 64)
        self.assertEqual("verified-existing", proof["method"])
        self.assertEqual("a" * 64, proof["installedSha256"])
        device.command.assert_not_called()

    def test_changed_install_requires_post_install_digest(self):
        device = mock.Mock(spec=driver.Device)
        device.installed_apk_sha256.side_effect = ["b" * 64, "a" * 64]
        device.command.return_value = subprocess.CompletedProcess([], 0, "Success", "")
        self.assertEqual("installed", driver.ensure_installed(device, Path("app.apk"), driver.PACKAGE, "a" * 64)["method"])
        self.assertEqual(2, device.installed_apk_sha256.call_count)
        device.installed_apk_sha256.side_effect = ["b" * 64, "b" * 64]
        with self.assertRaises(RuntimeError):
            driver.ensure_installed(device, Path("app.apk"), driver.PACKAGE, "a" * 64)

    def test_active_installer_parser_keeps_only_the_owned_package_and_rejects_unknown_format(self):
        report = "Active install sessions:\n  Session 42:\n    appPackageName=com.playerlab.sportsstreaming\n  Session 43:\n    appPackageName=other.package\nFinalized install sessions:\n  Session 44:\n    appPackageName=com.playerlab.sportsstreaming\n"
        self.assertEqual([42], driver.active_install_sessions(report, driver.PACKAGE))
        self.assertEqual([], driver.active_install_sessions("Active install sessions:\nFinalized install sessions:\n", driver.PACKAGE))
        with self.assertRaises(RuntimeError):
            driver.active_install_sessions("Unknown installer format", driver.PACKAGE)
        with self.assertRaises(RuntimeError):
            driver.active_install_sessions("Active install sessions:\n  Session 42:\n    unknownFields=true\nFinalized install sessions:\n", driver.PACKAGE)

    def test_failure_with_normal_instrumentation_exit_is_not_success(self):
        self.assertFalse(driver.successful_instrumentation(self.status("receiverPlayback", 1) + self.status("receiverPlayback", -2) + "FAILURES!!!\nTests run:1 Failures:1\nINSTRUMENTATION_CODE: -1"))
        self.assertTrue(driver.successful_instrumentation(self.passing_output(), self.test_class, 1))

    def test_interleaved_diagnostics_do_not_become_passed_tests(self):
        diagnostic = "INSTRUMENTATION_STATUS: castDiagnostics={bounded-state}\nINSTRUMENTATION_STATUS_CODE: 0\n"
        output = self.status("receiverPlayback", 1) + diagnostic * 4 + self.status("receiverPlayback", 0) + diagnostic + "OK (1 test)\nINSTRUMENTATION_CODE: -1\n"
        result = driver.instrumentation_result(output, self.test_class, 1)
        self.assertTrue(result["passed"])
        self.assertEqual(1, result["started"])
        self.assertEqual(1, result["completed"])
        self.assertEqual(1, result["passedTests"])
        self.assertEqual(0, result["failedTests"])
        self.assertEqual(5, result["diagnosticBlocks"])
        self.assertEqual(-1, result["runnerExitCode"])

    def test_summary_without_actual_completed_tests_is_rejected(self):
        self.assertFalse(driver.successful_instrumentation("OK (1 test)\nINSTRUMENTATION_CODE: -1", self.test_class, 1))

    def test_unstarted_or_duplicate_completion_is_rejected(self):
        self.assertFalse(driver.successful_instrumentation(self.status("receiverPlayback", 0) + "OK (1 test)\nINSTRUMENTATION_CODE: -1", self.test_class, 1))
        self.assertFalse(driver.successful_instrumentation(self.passing_output().replace("OK (1 test)", self.status("receiverPlayback", 0) + "OK (1 test)"), self.test_class, 1))

    def test_wrong_count_class_or_runner_exit_is_rejected(self):
        output = self.passing_output()
        self.assertFalse(driver.successful_instrumentation(output, self.test_class, 2))
        self.assertFalse(driver.successful_instrumentation(output, self.test_class + "Other", 1))
        self.assertFalse(driver.successful_instrumentation(output.replace("CODE: -1", "CODE: 0"), self.test_class, 1))
        self.assertFalse(driver.successful_instrumentation(output.replace("OK (1 test)", "OK (2 tests)"), self.test_class, 1))

    def test_partial_test_identity_does_not_inherit_previous_status_fields(self):
        partial = "INSTRUMENTATION_STATUS: test=receiverPlayback\nINSTRUMENTATION_STATUS_CODE: 0\n"
        self.assertFalse(driver.successful_instrumentation(self.status("receiverPlayback", 1) + partial + "OK (1 test)\nINSTRUMENTATION_CODE: -1", self.test_class, 1))

    def test_skipped_or_errored_test_cannot_pass(self):
        for code in (-1, -3, -4):
            output = self.status("receiverPlayback", 1) + self.status("receiverPlayback", code) + "OK (1 test)\nINSTRUMENTATION_CODE: -1"
            self.assertFalse(driver.successful_instrumentation(output, self.test_class, 1))

    def test_signed_queries_and_authentication_are_removed_from_logs(self):
        redacted = driver.sanitize("https://user:pass@media.test/a.m3u8?token=private#secret Authorization:private")
        self.assertNotIn("private", redacted)
        self.assertNotIn("pass@", redacted)
        self.assertNotIn("#secret", redacted)

    def test_no_device_or_media_host_is_selected_implicitly(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            driver.parse_args([])

    def test_cast_requires_explicit_https_receiver_host(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            driver.parse_args(["--serial", "device", "--media-base-url", "http://localhost:8622", "--cast-receiver", "Authorized Display"])


if __name__ == "__main__":
    unittest.main()
