"""License-free ownership checks for the public Apple runtime runner."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import plistlib
import re
import shlex
import subprocess
from tempfile import TemporaryDirectory
import textwrap
import unittest
from unittest.mock import patch

spec = spec_from_file_location("track_qualification", Path(__file__).with_name("run-track-qualification.py"))
runner = module_from_spec(spec)
spec.loader.exec_module(runner)
ROOT = Path(__file__).resolve().parents[2]


class AppleCIWorkflowTests(unittest.TestCase):
    stages = (
        ("Test iOS configuration without an app license", "Showcase-iOS-Configuration", "iOS", "ios-configuration-tests", None),
        ("Test iOS Profiles controls in English and Japanese", "Showcase-iOS-ProfilesUI", "iOS", "ios-profiles-ui", "Showcase-iOSProfilesUITests/NativeProfilesUITests"),
        ("Test tvOS Profiles controls in English and Japanese", "Showcase-tvOS-ProfilesUI", "tvOS", "tvos-profiles-ui", "Showcase-tvOSProfilesUITests/NativeProfilesUITests"),
    )

    def shell(self, name):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        step = workflow.split("      - name: " + name + "\n", 1)[1].split("\n      - ", 1)[0]
        return textwrap.dedent(step.split("        run: |\n", 1)[1])

    def test_compilation_finishes_before_boot_and_reuses_test_settings(self):
        for name, scheme, platform, derived, selected_tests in self.stages:
            with self.subTest(stage=name):
                shell = self.shell(name)
                self.assertIn("build-for-testing", shell)
                self.assertIn("test-without-building", shell)
                self.assertLess(shell.index("build-for-testing"), shell.index("simctl bootstatus"))
                self.assertLess(shell.index("simctl bootstatus"), shell.index("test-without-building"))
                common = re.search(r"xcodebuild_args=\(\n(.*?)\n\)", shell, re.DOTALL)
                self.assertIsNotNone(common)
                arguments = shlex.split(common.group(1))
                for option, value in (("-project", "Showcase.xcodeproj"), ("-scheme", scheme),
                                      ("-derivedDataPath", "$RUNNER_TEMP/" + derived),
                                      ("-parallel-testing-enabled", "NO"), ("-jobs", "2")):
                    self.assertEqual(arguments[arguments.index(option) + 1], value)
                self.assertIn("-onlyUsePackageVersionsFromResolvedFile", arguments)
                self.assertIn("CODE_SIGNING_ALLOWED=NO", arguments)
                if selected_tests:
                    self.assertIn("-only-testing:" + selected_tests, arguments)
                else:
                    self.assertFalse(any(arg.startswith("-only-testing:") for arg in arguments))
                commands = re.findall(r"^xcodebuild ((?:[^\n]*\\\n)*[^\n]*)", shell, re.MULTILINE)
                phases = [shlex.split(command.replace("\\\n", " ")) for command in commands]
                testing = ["${xcodebuild_args[@]}", "-destination", "platform=" + platform + " Simulator,id=$simulator_id"]
                if selected_tests:
                    testing += ["-resultBundlePath", "$RUNNER_TEMP/apple-profiles-" + platform.lower() + ".xcresult"]
                self.assertEqual(phases, [
                    ["${xcodebuild_args[@]}", "-destination", "generic/platform=" + platform + " Simulator", "build-for-testing"],
                    testing + ["test-without-building"],
                ])
                self.assertIn('simctl bootstatus "$simulator_id" -b', shell)
                self.assertIn("trap 'exit 130' INT", shell)
                self.assertIn("trap 'exit 143' TERM", shell)

    def test_selected_device_cleanup_preserves_the_original_failure(self):
        for name, *_ in self.stages:
            shell = self.shell(name)
            cleanup = re.search(r"shutdown_selected_simulator\(\) \{\n.*?^\}", shell, re.MULTILINE | re.DOTALL).group()
            for status, shutdown_status, expected in ((0, 0, 0), (0, 41, 1), (23, 0, 23), (23, 41, 23)):
                with self.subTest(stage=name, status=status, shutdown=shutdown_status):
                    program = ("simulator_id=fixture-selected\n"
                               "xcrun() { printf '%s\\n' \"$*\"; return " + str(shutdown_status) + "; }\n"
                               + cleanup + "\ntrap shutdown_selected_simulator EXIT\nexit " + str(status))
                    result = subprocess.run(["bash", "-e", "-u", "-o", "pipefail", "-c", program],
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, expected, result.stderr)
                    self.assertEqual([line for line in result.stdout.splitlines() if line.startswith("simctl ")],
                                     ["simctl shutdown fixture-selected"])

    def test_native_ci_shell_blocks_have_valid_bash_syntax(self):
        for name, *_ in self.stages:
            with self.subTest(stage=name):
                result = subprocess.run(["bash", "-n"], input=self.shell(name), capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)


class SelectedPlanOwnershipTests(unittest.TestCase):
    def test_successful_invocation_removes_only_its_own_plan(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            with runner.selected_test_plan(path, {"fixture": True}) as selected:
                self.assertEqual(selected, path)
                self.assertEqual(plistlib.loads(path.read_bytes()), {"fixture": True})
            self.assertFalse(path.exists())

    def test_existing_plan_is_rejected_and_preserved(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            original = b"another invocation owns this file"
            path.write_bytes(original)
            rejected = None
            try:
                with runner.selected_test_plan(path, {"replacement": True}):
                    self.fail("Existing plan must reject a second owner")
            except Exception as error:
                rejected = error
            self.assertTrue(path.exists(), "A rejected invocation removed another owner's plan")
            self.assertEqual(path.read_bytes(), original)
            self.assertIsInstance(rejected, FileExistsError)

    def test_serialization_failure_removes_the_new_owned_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            with self.assertRaises(TypeError):
                with runner.selected_test_plan(path, {"unsupported": object()}):
                    self.fail("Serialization should fail before yielding")
            self.assertFalse(path.exists())

    def test_partial_write_failure_removes_the_new_owned_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            original_open = Path.open

            class PartialWrite:
                def __init__(self, stream):
                    self.stream = stream

                def __enter__(self):
                    self.stream.__enter__()
                    return self

                def __exit__(self, *values):
                    return self.stream.__exit__(*values)

                def write(self, data):
                    self.stream.write(data[:8])
                    self.stream.flush()
                    raise OSError("Synthetic partial write")

            def opened(file, mode="r", *values, **options):
                stream = original_open(file, mode, *values, **options)
                return PartialWrite(stream) if file == path and mode in ["wb", "xb"] else stream

            with patch.object(Path, "open", new=opened), self.assertRaises(OSError):
                with runner.selected_test_plan(path, {"fixture": True}):
                    self.fail("Partial write should fail before yielding")
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
