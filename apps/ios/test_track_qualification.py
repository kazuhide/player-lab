"""License-free ownership checks for the public Apple runtime runner."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import os
import plistlib
import re
import shlex
import subprocess
import sys
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
                else:
                    testing += ["-resultBundlePath", "$RUNNER_TEMP/ios-configuration.xcresult"]
                self.assertEqual(phases, [
                    ["${xcodebuild_args[@]}", "-destination", "generic/platform=" + platform + " Simulator", "build-for-testing"],
                    testing + ["test-without-building"],
                ])
                self.assertIn('simctl bootstatus "$simulator_id" -b', shell)
                self.assertIn("trap 'exit 130' INT", shell)
                self.assertIn("trap 'exit 143' TERM", shell)

    def test_configuration_results_are_retained_before_profiles(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        name = "      - name: Save iOS configuration test results\n"
        step = workflow.split(name, 1)[1].split("\n      - ", 1)[0]
        self.assertLess(workflow.index("      - name: " + self.stages[0][0] + "\n"), workflow.index(name))
        self.assertLess(workflow.index(name), workflow.index("      - name: " + self.stages[1][0] + "\n"))

        def assert_retention(candidate):
            for line in (
                "        if: always()",
                "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4",
                "          name: apple-ios-configuration-results",
                "          path: ${{ runner.temp }}/ios-configuration.xcresult",
                "          if-no-files-found: warn",
                "          retention-days: 7",
            ):
                self.assertIn(line, candidate.splitlines())

        assert_retention(step)
        for original, replacement in (
            ("if: always()", "if: success()"),
            ("path: ${{ runner.temp }}/ios-configuration.xcresult", "path: ${{ runner.temp }}/different.xcresult"),
        ):
            with self.subTest(mutation=replacement), self.assertRaises(AssertionError):
                assert_retention(step.replace(original, replacement, 1))

    def test_selected_device_cleanup_preserves_the_original_failure(self):
        for name, *_ in self.stages[1:]:
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

    def run_stage(self, directory, stage, *, initial_state=None, build_status=0,
                  test_status=0, shutdown_status=0, signal_name="", selected=True):
        directory = Path(directory)
        (directory / "apps/ios").mkdir(parents=True, exist_ok=True)
        binary = directory / "bin"
        binary.mkdir(exist_ok=True)
        state = directory / "state.json"
        if initial_state is not None or not state.exists():
            state.write_text(json.dumps({"fixture-selected": initial_state or "Shutdown",
                                         "unrelated-device": "Booted"}))
        common = """\
import json, os, signal, sys, time
from pathlib import Path
args = sys.argv[1:]
state_path = Path(os.environ['FAKE_STATE'])
state = json.loads(state_path.read_text())
with Path(os.environ['FAKE_EVENTS']).open('a') as stream:
    stream.write(json.dumps({'tool': Path(sys.argv[0]).name, 'args': args,
                             'selectedStateBefore': state['fixture-selected']}) + '\\n')
"""
        programs = {
            "xcrun": common + """\
if args[:3] == ['simctl', 'list', 'devices']:
    print(json.dumps({'devices': {'com.apple.CoreSimulator.SimRuntime.iOS-fixture': [
        {'udid': identifier, 'name': 'iPhone fixture', 'state': value, 'isAvailable': True}
        for identifier, value in state.items()]}}))
elif args[:2] in (['simctl', 'bootstatus'], ['simctl', 'shutdown']):
    assert args[2] == 'fixture-selected', 'An unrelated device was targeted'
    if args[1] == 'shutdown':
        status = int(os.environ['FAKE_SHUTDOWN_STATUS'])
        if status: sys.exit(status)
        if state[args[2]] == 'Shutdown': sys.exit(149)
        state[args[2]] = 'Shutdown'
    else:
        state[args[2]] = 'Booted'
    state_path.write_text(json.dumps(state))
else:
    raise AssertionError('Unexpected native command: ' + repr(args))
""",
            "xcodebuild": common + """\
phase = next(value for value in ['build-for-testing', 'test-without-building'] if value in args)
if os.environ['FAKE_SIGNAL'] and phase == 'build-for-testing':
    assert os.getppid() == int(os.environ['FAKE_SHELL_PID'])
    os.kill(os.getppid(), getattr(signal, os.environ['FAKE_SIGNAL']))
    time.sleep(0.05)
sys.exit(int(os.environ['FAKE_BUILD_STATUS' if phase == 'build-for-testing' else 'FAKE_TEST_STATUS']))
""",
        }
        for name, program in programs.items():
            path = binary / name
            path.write_text("#!" + sys.executable + "\n" + program)
            path.chmod(0o700)
        environment = os.environ.copy()
        environment.update(PATH=str(binary) + os.pathsep + environment["PATH"],
                           RUNNER_TEMP=str(directory), GITHUB_ENV=str(directory / "github-env"),
                           FAKE_STATE=str(state), FAKE_EVENTS=str(directory / "events.jsonl"),
                           FAKE_BUILD_STATUS=str(build_status), FAKE_TEST_STATUS=str(test_status),
                           FAKE_SHUTDOWN_STATUS=str(shutdown_status), FAKE_SIGNAL=signal_name)
        if selected:
            environment["IOS_CONFIGURATION_SIMULATOR"] = "fixture-selected"
        else:
            environment.pop("IOS_CONFIGURATION_SIMULATOR", None)
        result = subprocess.run(["bash", "-e", "-u", "-o", "pipefail", "-c",
                                 "export FAKE_SHELL_PID=$$\n" + self.shell(stage)],
                                cwd=directory, env=environment, capture_output=True, text=True)
        events = directory / "events.jsonl"
        return result, json.loads(state.read_text()), [json.loads(line) for line in
            events.read_text().splitlines()] if events.exists() else []

    def test_successful_configuration_transfers_only_its_booted_device(self):
        with TemporaryDirectory() as directory:
            result, state, events = self.run_stage(directory, self.stages[0][0])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(state, {"fixture-selected": "Booted", "unrelated-device": "Booted"})
            self.assertNotIn(["simctl", "shutdown", "fixture-selected"], [event["args"] for event in events])
            self.assertIn("IOS_CONFIGURATION_SIMULATOR=fixture-selected", (Path(directory) / "github-env").read_text())
            result, state, events = self.run_stage(directory, self.stages[1][0])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(state, {"fixture-selected": "Shutdown", "unrelated-device": "Booted"})
            readiness = [event for event in events if event["args"][:2] == ["simctl", "bootstatus"]]
            self.assertEqual([event["selectedStateBefore"] for event in readiness], ["Shutdown", "Booted"])
            self.assertFalse(any(event["args"][:2] == ["simctl", "launch"] for event in events))

    def test_failed_or_cancelled_owned_stages_preserve_status_and_cleanup(self):
        cases = [
            (self.stages[0][0], 0, 23, 0, "", 23),
            (self.stages[0][0], 0, 23, 41, "", 23),
            (self.stages[1][0], 23, 0, 0, "", 23),
            (self.stages[1][0], 23, 0, 41, "", 23),
            (self.stages[1][0], 0, 23, 0, "", 23),
            (self.stages[1][0], 0, 0, 0, "SIGINT", 130),
            (self.stages[1][0], 0, 0, 0, "SIGTERM", 143),
        ]
        for stage, build, test, shutdown, signal_name, expected in cases:
            with self.subTest(stage=stage, build=build, test=test, shutdown=shutdown, signal=signal_name), TemporaryDirectory() as directory:
                result, state, events = self.run_stage(directory, stage, initial_state="Booted",
                    build_status=build, test_status=test, shutdown_status=shutdown, signal_name=signal_name)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual(state["unrelated-device"], "Booted")
                self.assertEqual(state["fixture-selected"], "Booted" if shutdown else "Shutdown")
                self.assertEqual([event["args"] for event in events if event["args"][:2] == ["simctl", "shutdown"]],
                                 [["simctl", "shutdown", "fixture-selected"]])

    def test_always_cleanup_stops_only_the_owned_phone_before_tvos(self):
        name = "Stop the selected iPhone before tvOS"
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        step = workflow.split("      - name: " + name + "\n", 1)[1].split("\n      - ", 1)[0]
        self.assertIn("        if: always()", step.splitlines())
        self.assertLess(workflow.index("      - name: Save iOS Profiles UI results and captures\n"), workflow.index("      - name: " + name + "\n"))
        self.assertLess(workflow.index("      - name: " + name + "\n"), workflow.index("      - name: " + self.stages[2][0] + "\n"))
        for initial, shutdown, selected, expected in (("Booted", 0, True, 0), ("Shutdown", 0, True, 0),
                                                     ("Booted", 41, True, 41), ("Booted", 0, False, 0)):
            with self.subTest(initial=initial, shutdown=shutdown, selected=selected), TemporaryDirectory() as directory:
                result, state, events = self.run_stage(directory, name, initial_state=initial,
                                                     shutdown_status=shutdown, selected=selected)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual(state["unrelated-device"], "Booted")
                stopped = selected and initial == "Booted" and shutdown == 0
                self.assertEqual(state["fixture-selected"], "Shutdown" if stopped else initial)
                calls = [event["args"] for event in events if event["args"][:2] == ["simctl", "shutdown"]]
                self.assertEqual(calls, [["simctl", "shutdown", "fixture-selected"]] if selected and initial == "Booted" else [])

    def test_profile_input_keeps_one_native_literal_and_exact_lifecycle_oracles(self):
        source = (ROOT / "apps/ios/ShowcaseProfilesUITests/NativeProfilesUITests.swift").read_text()
        body = source.split("    private func saveSource(", 1)[1].split("    private func selectSource(", 1)[0]
        self.assertEqual(body.count("name.typeText("), 1)
        self.assertIn('name.typeText("Source")', body)
        self.assertNotIn("for character", body)
        self.assertIn('NSPredicate(format: "value == %@", "Source")', body)
        self.assertIn('XCTWaiter.wait(for: [committedName], timeout: 5)', body)
        self.assertIn('XCTAssertEqual(name.value as? String, "Source")', body)
        self.assertLess(body.index('XCTAssertEqual(name.value as? String, "Source")'), body.index('configuration.profiles.save'))

    def test_profile_input_is_acknowledged_before_keyboard_dismissal(self):
        source = (ROOT / "apps/ios/ShowcaseProfilesUITests/NativeProfilesUITests.swift").read_text()
        body = source.split("    private func saveSource(", 1)[1].split("    private func selectSource(", 1)[0]
        acknowledgment = 'XCTWaiter.wait(for: [committedName], timeout: 5)'
        dismissal = 'WorkspaceUITestNavigation.dismissKeyboard(in: app)'
        final_value = 'XCTAssertEqual(name.value as? String, "Source")'
        self.assertEqual(body.count(acknowledgment), 1, "The existing acknowledgment budget must not be duplicated")
        self.assertLess(body.index('name.typeText("Source")'), body.index(acknowledgment))
        self.assertLess(body.index(acknowledgment), body.index(dismissal), "Closing a native keyboard must not race pending text delivery")
        self.assertLess(body.index(dismissal), body.index(final_value))
        self.assertLess(body.index(final_value), body.index('configuration.profiles.save'))

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
