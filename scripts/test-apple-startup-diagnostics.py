"""Ownership and output contracts; these tests never start an Apple simulator."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import ctypes
import json
import os
import plistlib
import signal
import sys
import unittest
from unittest.mock import Mock, patch

spec = spec_from_file_location("startup_diagnostics", Path(__file__).with_name("apple-startup-diagnostics.py"))
runner = module_from_spec(spec)
spec.loader.exec_module(runner)
UDID = "A6574FEC-AE06-46C2-92CC-F2BBAB2A5601"
IMAGE_UUID = "11111111-2222-3333-4444-555555555555"
OTHER_UUID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"


def target(**changes):
    value = {"pid": 123, "uid": os.getuid(), "startSeconds": 100,
             "startMicroseconds": 42, "executable": "/owned/Profiles.app/Profiles",
             "appContainer": "/owned/Profiles.app", "ownedUDID": UDID}
    value.update(changes)
    return value


class Events:
    def __init__(self):
        self.rows = []

    def event(self, name, **fields):
        self.rows.append({"event": name, **fields})


class ObserverTests(unittest.TestCase):
    def create(self, targets=None):
        backend = Mock()
        backend.query.return_value = {"state": "observed", "targets": targets or [target()]}
        backend.capture.return_value = {"outcome": "validated_sample"}
        events = Events()
        return runner.Observer(backend, events), backend, events

    def test_only_one_sample_after_45_seconds_of_the_same_observed_lifetime(self):
        observer, backend, events = self.create()
        for now in (0, 44.99):
            observer.tick(now)
        backend.capture.assert_not_called()
        observer.tick(45)
        observer.tick(300)
        backend.capture.assert_called_once_with(target())
        start = next(row for row in events.rows if row["event"] == "owned_lifetime_sample_started")
        self.assertTrue(start["healthyOperationPossible"])
        self.assertTrue(start["perturbative"])
        self.assertFalse(start["startupOrHangProven"])

    def test_reused_pid_does_not_inherit_the_previous_observation_age(self):
        observer, backend, _ = self.create()
        observer.tick(0)
        observer.tick(44)
        replacement = target(startMicroseconds=43)
        backend.query.return_value["targets"] = [replacement]
        observer.tick(45)
        observer.tick(89.9)
        backend.capture.assert_not_called()
        observer.tick(90)
        backend.capture.assert_called_once_with(replacement)

    def test_native_query_duration_does_not_count_as_already_observed_age(self):
        observer, backend, _ = self.create()
        with patch.object(runner.time, "monotonic", return_value=2):
            observer.tick()
        observer.tick(46)
        backend.capture.assert_not_called()
        observer.tick(47)
        backend.capture.assert_called_once()

    def test_query_failure_or_missing_target_restarts_observed_age(self):
        for interruption in (RuntimeError("query"), {"state": "no_live_owned_host", "targets": []}):
            with self.subTest(interruption=type(interruption).__name__):
                observer, backend, _ = self.create()
                observer.tick(0)
                backend.query.side_effect = [interruption, {"state": "observed", "targets": [target()]}]
                observer.tick(44)
                observer.tick(45)
                backend.capture.assert_not_called()

    def test_ambiguous_targets_are_never_sampled(self):
        observer, backend, _ = self.create([target(), target(pid=124)])
        observer.tick(0)
        observer.tick(100)
        backend.capture.assert_not_called()

    def test_twelve_attempts_are_a_hard_stage_limit_even_when_sampling_fails(self):
        observer, backend, _ = self.create()
        backend.capture.return_value = {"outcome": "sample_command_error"}
        for index in range(20):
            backend.query.return_value["targets"] = [target(startSeconds=100 + index)]
            observer.tick(index * 100)
            observer.tick(index * 100 + 45)
        self.assertEqual(backend.capture.call_count, 12)
        self.assertEqual(observer.validated, 0)


class CaptureTests(unittest.TestCase):
    def scenario(self, root, *, after=None, header=None, size=None, status=0,
                 uuid_status=0, uuid_output=None):
        root = Path(root)
        args = SimpleNamespace(control_dir=str(root / "control"), platform="ios", udid=UDID,
                               device_root=str(root / UDID))
        recorder = runner.Recorder(root / "uploaded")
        backend = runner.NativeBackend(args, recorder)
        backend.generation = Mock(return_value={"device": 1, "inode": 2, "bytes": 3,
                                               "modifiedNanoseconds": 4, "changedNanoseconds": 5})
        backend.query = Mock(side_effect=[{"targets": [target()]},
                                          {"targets": [target() if after is None else after]}])

        def sample(command, timeout, *, file_limit=None, raw_output=None):
            if command[:3] == ["/usr/bin/xcrun", "dwarfdump", "--uuid"]:
                self.assertEqual(command[3], target()["executable"])
                self.assertEqual(timeout, 2)
                return uuid_status, (uuid_output if uuid_output is not None else
                                     f"UUID: {IMAGE_UUID} (arm64) /owned/Profiles.app/Profiles\n".encode())
            self.assertEqual(command[:4], ["/usr/bin/sample", "123", "1", "20"])
            self.assertEqual(timeout, 5)
            self.assertEqual(file_limit, 512 * 1024)
            self.assertFalse(Path(command[-1]).is_relative_to(recorder.output))
            self.assertEqual(Path(command[-1]), raw_output)
            data = header if header is not None else sample_report()
            Path(command[-1]).write_bytes(data if size is None else data + b"x" * size)
            return status, b""

        backend.run = Mock(side_effect=sample)
        return backend, recorder

    def test_only_identity_and_header_validated_stack_enters_uploaded_directory(self):
        with TemporaryDirectory() as root:
            backend, recorder = self.scenario(root)
            result = backend.capture(target())
            self.assertEqual(result["outcome"], "validated_sample")
            self.assertEqual(len(list(recorder.output.glob("sample-*.txt"))), 1)
            self.assertFalse(list(backend.raw.iterdir()))

    def test_changed_pid_birth_executable_uid_or_container_discards_unvalidated_raw(self):
        replacements = [target(startMicroseconds=99), target(executable="/foreign/app"),
                        target(uid=os.getuid() + 1), target(appContainer="/foreign/container")]
        for replacement in replacements:
            with self.subTest(replacement=replacement), TemporaryDirectory() as root:
                backend, recorder = self.scenario(root, after=replacement)
                result = backend.capture(target())
                self.assertEqual(result["outcome"], "identity_changed_or_target_gone_after_sample")
                self.assertFalse(list(recorder.output.glob("sample-*.txt")))
                self.assertFalse(list(backend.raw.iterdir()))

    def test_wrong_header_nonzero_exit_or_stack_cap_never_publishes_raw(self):
        for options in ({"header": b"Process: Foreign [456]\nPath: /foreign/app\n"},
                        {"size": runner.MAX_STACK_BYTES}, {"status": 2}):
            with self.subTest(options=options), TemporaryDirectory() as root:
                backend, recorder = self.scenario(root, **options)
                self.assertNotEqual(backend.capture(target())["outcome"], "validated_sample")
                self.assertFalse(list(recorder.output.glob("sample-*.txt")))
                self.assertFalse(list(backend.raw.iterdir()))

    def test_rejected_header_records_only_comparison_flags_and_hash(self):
        with TemporaryDirectory() as root:
            backend, _ = self.scenario(root, header=b"Process: Foreign [456]\nPath: /unrelated-private-path\n")
            result = backend.capture(target())
            self.assertEqual(result["outcome"], "sample_header_mismatch")
            self.assertFalse(result["headerChecks"]["pidMatches"])
            self.assertFalse(result["headerChecks"]["pathMatches"])
            self.assertNotIn("unrelated-private-path", json.dumps(result))
            self.assertFalse(list(backend.raw.iterdir()))

    def test_matching_header_without_complete_report_sections_is_rejected(self):
        with TemporaryDirectory() as root:
            backend, recorder = self.scenario(root, header=b"Process: Profiles [123]\nPath: /owned/Profiles.app/Profiles\n")
            result = backend.capture(target())
            self.assertEqual(result["outcome"], "sample_header_mismatch")
            self.assertTrue(result["headerChecks"]["pidMatches"])
            self.assertTrue(result["headerChecks"]["pathMatches"])
            self.assertFalse(result["headerChecks"]["callGraphPresent"])
            self.assertFalse(list(recorder.output.glob('sample-*.txt')))

    def test_stage_output_cap_and_preexisting_retirement_fail_closed(self):
        with TemporaryDirectory() as root:
            backend, recorder = self.scenario(root)
            (recorder.output / "prior.txt").write_bytes(b"x" * runner.MAX_STAGE_BYTES)
            self.assertEqual(backend.capture(target())["outcome"], "stage_output_limit")
            self.assertFalse(list(backend.raw.iterdir()))
        with TemporaryDirectory() as root:
            backend, recorder = self.scenario(root)
            backend.query = Mock(return_value={"targets": []})
            self.assertEqual(backend.capture(target())["outcome"], "target_gone_before_sample")
            backend.run.assert_not_called()

    def test_uuid_command_error_or_wrong_file_output_never_starts_sample(self):
        for options in ({"uuid_status": 2}, {"uuid_output": b"UUID unavailable"},
                        {"uuid_output": f"UUID: {IMAGE_UUID} (arm64) /foreign/Profiles\n".encode()}):
            with self.subTest(options=options), TemporaryDirectory() as root:
                backend, recorder = self.scenario(root, **options)
                self.assertIn(backend.capture(target())["outcome"],
                              {"image_uuid_command_error", "image_uuid_output_rejected"})
                self.assertFalse(any(call.args[0][0] == '/usr/bin/sample' for call in backend.run.call_args_list))
                self.assertFalse(list(recorder.output.glob('sample-*.txt')))

    def test_on_disk_executable_generation_change_before_or_after_sample_rejects_raw(self):
        for generations in ([1, 2], [1, 1, 2]):
            with self.subTest(generations=generations), TemporaryDirectory() as root:
                backend, recorder = self.scenario(root)
                backend.generation.side_effect = generations
                self.assertEqual(backend.capture(target())["outcome"], "executable_file_generation_changed")
                self.assertFalse(list(recorder.output.glob('sample-*.txt')))
                self.assertFalse(list(backend.raw.iterdir()))

    def test_metadata_has_a_reserved_summary_and_stop_budget(self):
        with TemporaryDirectory() as root:
            recorder = runner.Recorder(root)
            for _ in range(5000):
                recorder.event("bounded", payload="x" * 1000)
            self.assertLessEqual(recorder.bytes, runner.MAX_METADATA_BYTES - 32768)
            self.assertGreater(recorder.dropped, 0)


class NativeOwnershipTests(unittest.TestCase):
    def test_container_allowlist_rejects_wrong_bundle_symlinks_and_other_device(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / UDID
            app = root / "data/Containers/Bundle/Application/owned/Showcase-iOSProfilesHost.app"
            app.mkdir(parents=True)
            info = {"CFBundleIdentifier": runner.HOSTS["ios"][0],
                    "CFBundleExecutable": runner.HOSTS["ios"][1]}
            (app / "Info.plist").write_bytes(plistlib.dumps(info))
            binary = app / info["CFBundleExecutable"]
            binary.write_bytes(b"not executed")
            self.assertEqual(runner.installed_hosts(root, "ios"), {str(binary.resolve()): str(app.resolve())})
            info["CFBundleIdentifier"] = "foreign.bundle"
            (app / "Info.plist").write_bytes(plistlib.dumps(info))
            self.assertEqual(runner.installed_hosts(root, "ios"), {})
            with self.assertRaises(ValueError):
                runner.inspect_owned(root, "ios", "OTHER-DEVICE")

    def test_numeric_discovery_exposes_only_the_exact_owned_path_and_uid(self):
        library = Mock()

        def list_pids(_kind, _info, values, _size):
            values[0], values[1], values[2] = 123, 456, 789
            return 3 * ctypes.sizeof(ctypes.c_int)

        library.proc_listpids.side_effect = list_pids
        with TemporaryDirectory() as directory:
            root = Path(directory) / UDID
            with patch.object(runner, "installed_hosts", return_value={target()["executable"]: target()["appContainer"]}), \
                    patch.object(runner, "libproc", return_value=library), \
                    patch.object(runner, "raw_executable_path", side_effect=lambda _lib, pid: target()["executable"] if pid != 789 else "/secret/unrelated"), \
                    patch.object(runner, "process_identity", side_effect=lambda pid, _lib: target(pid=pid, uid=os.getuid() if pid == 123 else os.getuid() + 1)):
                result = runner.inspect_owned(root, "ios", UDID)
        self.assertEqual([value["pid"] for value in result["targets"]], [123])
        self.assertNotIn("secret", json.dumps(result))


class ProcessInspectionCostTests(unittest.TestCase):
    def library(self, paths, identities=None):
        """Synthetic libproc calls only; no native library or process census."""
        library = Mock()
        paths = {pid: list(value) if isinstance(value, list) else [value]
                 for pid, value in paths.items()}
        identities = identities or {}

        def list_pids(_kind, _info, values, _size):
            for index, pid in enumerate(paths):
                values[index] = pid
            return len(paths) * ctypes.sizeof(ctypes.c_int)

        def pidpath(pid, buffer, _size):
            choices = paths[pid]
            value = choices.pop(0) if len(choices) > 1 else choices[0]
            if value is None:
                return 0
            buffer.value = os.fsencode(value)
            return len(buffer.value)

        def pidinfo(pid, flavor, argument, pointer, size):
            self.assertEqual((flavor, argument, size), (3, 0, ctypes.sizeof(runner.BsdInfo)))
            info = pointer._obj
            values = {"pid": pid, "uid": os.getuid(), "status": 2,
                      "startSeconds": 100, "startMicroseconds": pid,
                      **identities.get(pid, {})}
            for name, value in values.items():
                setattr(info, name, value)
            return ctypes.sizeof(info)

        library.proc_listpids.side_effect = list_pids
        library.proc_pidpath.side_effect = pidpath
        library.proc_pidinfo.side_effect = pidinfo
        return library

    def inspect(self, root, library, hosts):
        with patch.object(runner, "installed_hosts", return_value=hosts), \
                patch.object(runner, "libproc", return_value=library):
            return runner.inspect_owned(root, "ios", UDID)

    def test_inventory_requests_only_the_requested_uid_and_keeps_birth_identity(self):
        executable = "/owned/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        library = self.library({123: executable}, {123: {"startMicroseconds": 987654}})
        with TemporaryDirectory() as directory:
            result = self.inspect(Path(directory) / UDID, library,
                                  {executable: str(Path(executable).parent)})
        self.assertEqual(library.proc_listpids.call_args.args[:2], (4, os.getuid()))
        self.assertEqual([value["pid"] for value in result["targets"]], [123])
        self.assertEqual(result["targets"][0]["startMicroseconds"], 987654)
        self.assertEqual(result["targets"][0]["ownedUDID"], UDID)

    def test_large_unrelated_inventory_never_canonicalizes_or_reads_bsd_identity(self):
        executable = "/owned/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        library = self.library({pid: f"/unrelated/worker-{pid}" for pid in range(1, 8193)})
        original = Path.resolve

        def resolve(path, *args, **kwargs):
            if str(path).startswith("/unrelated/"):
                self.fail("An unrelated process path must not reach filesystem canonicalization.")
            return original(path, *args, **kwargs)

        with TemporaryDirectory() as directory, patch.object(runner.Path, "resolve", new=resolve):
            result = self.inspect(Path(directory) / UDID, library,
                                  {executable: str(Path(executable).parent)})
        self.assertEqual(result, {"state": "no_live_owned_host", "targets": []})
        library.proc_pidinfo.assert_not_called()
        self.assertEqual(library.proc_pidpath.call_count, 8192)

    def test_same_basename_alias_still_requires_the_exact_canonical_owned_host(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / UDID
            app = root / "data/Containers/Bundle/Application/owned/Showcase-iOSProfilesHost.app"
            app.mkdir(parents=True)
            binary = app / "Showcase-iOSProfilesHost"
            binary.write_bytes(b"not executed")
            alias = Path(directory) / "namespace-alias"
            alias.symlink_to(app.parent, target_is_directory=True)
            raw = str(alias / app.name / binary.name)
            library = self.library({123: raw})
            result = self.inspect(root, library, {str(binary.resolve()): str(app.resolve())})
            self.assertEqual(result["targets"][0]["executable"], str(binary.resolve()))
            self.assertEqual(result["targets"][0]["appContainer"], str(app.resolve()))

    def test_foreign_same_basename_is_only_a_candidate_and_is_rejected(self):
        executable = "/owned/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        foreign = "/foreign/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        library = self.library({123: foreign})
        with TemporaryDirectory() as directory:
            result = self.inspect(Path(directory) / UDID, library,
                                  {executable: str(Path(executable).parent)})
        self.assertEqual(result["targets"], [])
        library.proc_pidinfo.assert_not_called()
        self.assertNotIn("foreign", json.dumps(result))

    def test_uid_path_disappearance_pid_mismatch_and_zombie_races_fail_closed(self):
        executable = "/owned/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        foreign = "/foreign/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        scenarios = [([executable, foreign], {}), ([executable, None], {}),
                     (executable, {"uid": os.getuid() + 1}),
                     (executable, {"pid": 124}), (executable, {"status": 5})]
        for paths, identity in scenarios:
            with self.subTest(paths=paths, identity=identity), TemporaryDirectory() as directory:
                library = self.library({123: paths}, {123: identity})
                result = self.inspect(Path(directory) / UDID, library,
                                      {executable: str(Path(executable).parent)})
                self.assertEqual(result["targets"], [])

    def test_multiple_owned_lifetimes_are_not_reduced_to_an_arbitrary_sample_target(self):
        executable = "/owned/Showcase-iOSProfilesHost.app/Showcase-iOSProfilesHost"
        library = self.library({123: executable, 124: executable})
        with TemporaryDirectory() as directory:
            result = self.inspect(Path(directory) / UDID, library,
                                  {executable: str(Path(executable).parent)})
        self.assertEqual(len(result["targets"]), 2)
        backend = Mock()
        backend.query.return_value = result
        observer = runner.Observer(backend, Events())
        observer.tick(0)
        observer.tick(100)
        backend.capture.assert_not_called()


class StopTests(unittest.TestCase):
    def scenario(self, root):
        control = Path(root) / "control"
        output = Path(root) / "output"
        control.mkdir()
        output.mkdir()
        owner = target(processGroup=123)
        runner.write_json(control / "instance.json", {"identity": owner, "outputDirectory": str(output)})
        return SimpleNamespace(control_dir=str(control), observer_pid=123), owner

    def test_reused_observer_pid_cannot_be_signaled(self):
        with TemporaryDirectory() as root:
            args, owner = self.scenario(root)
            with patch.object(runner, "process_identity", return_value=target(startMicroseconds=99)), \
                    patch.object(runner.os, "killpg") as kill:
                self.assertEqual(runner.stop_observer(args), 1)
                kill.assert_not_called()

    def test_graceful_exit_does_not_signal_any_process(self):
        with TemporaryDirectory() as root:
            args, owner = self.scenario(root)
            with patch.object(runner, "process_identity", return_value=None), patch.object(runner.os, "killpg") as kill:
                self.assertEqual(runner.stop_observer(args), 0)
                kill.assert_not_called()

    def test_forced_cleanup_signals_only_authenticated_separate_observer_group(self):
        with TemporaryDirectory() as root:
            args, owner = self.scenario(root)
            clock = iter(range(100))
            living = [True]

            def kill(pid, number):
                self.assertEqual(pid, 123)
                if number == signal.SIGKILL:
                    living[0] = False

            with patch.object(runner, "process_identity", side_effect=lambda _pid: owner if living[0] else None), \
                    patch.object(runner.os, "getsid", return_value=123), \
                    patch.object(runner.os, "killpg", side_effect=kill) as signals, \
                    patch.object(runner.time, "monotonic", side_effect=lambda: next(clock)), \
                    patch.object(runner.time, "sleep"):
                self.assertEqual(runner.stop_observer(args), 0)
            self.assertEqual([call.args for call in signals.call_args_list], [(123, signal.SIGTERM), (123, signal.SIGKILL)])
            report = json.loads((Path(root) / "output/stop.json").read_text())
            self.assertTrue(report["forcedGroupKill"])
            self.assertFalse(report["gracefulReapingProven"])


class CommandDeadlineTests(unittest.TestCase):
    def test_timeout_records_status_eof_and_byte_counts_without_output_arguments_or_env(self):
        for exit_code in (None, 0, 7):
            with self.subTest(exit_code=exit_code), TemporaryDirectory() as root:
                recorder = runner.Recorder(Path(root) / 'uploaded')
                backend = runner.NativeBackend(SimpleNamespace(control_dir=str(Path(root) / 'control')), recorder)
                raw = backend.raw / 'owned.sample.txt'
                raw.write_bytes(b'not adopted')
                child = Mock()
                child.poll.return_value = exit_code
                selector = Mock()
                selector.get_map.return_value = {'stdout': 1, 'stderr': 2}
                selector.select.return_value = []
                clock = iter(range(100))
                command = ['/usr/bin/sample', '123', '1', '20', 'DUMMY_ARGV_BODY']
                with patch.object(runner.subprocess, 'Popen', return_value=child), \
                        patch.object(runner.selectors, 'DefaultSelector', return_value=selector), \
                        patch.object(runner.time, 'monotonic', side_effect=lambda: next(clock)), \
                        patch.object(backend, 'cleanup_child') as cleanup, \
                        patch.dict(runner.os.environ, {'DUMMY_ENV_BODY': 'DUMMY_ENV_VALUE'}):
                    with self.assertRaises(runner.subprocess.TimeoutExpired):
                        backend.run(command, 5, raw_output=raw)
                    cleanup.assert_called_once()
                result = backend.last_command_result
                self.assertEqual(result['outcome'], 'wall_limit')
                self.assertEqual(result['childExitCodeAtObservation'], exit_code)
                self.assertEqual(result['openPipeCount'], 2)
                self.assertFalse(result['stdoutEOF'])
                self.assertEqual(result['rawBytes'], 11)
                report = json.dumps(result)
                self.assertNotIn('DUMMY_ARGV_BODY', report)
                self.assertNotIn('DUMMY_ENV', report)
                self.assertNotIn('not adopted', report)

    def test_spawn_error_is_recorded_before_child_cleanup_without_raw_exception_body(self):
        with TemporaryDirectory() as root:
            recorder = runner.Recorder(Path(root) / 'uploaded')
            backend = runner.NativeBackend(SimpleNamespace(control_dir=str(Path(root) / 'control')), recorder)
            with patch.object(runner.subprocess, 'Popen', side_effect=FileNotFoundError('DUMMY_ERROR_BODY')):
                with self.assertRaises(FileNotFoundError):
                    backend.run(['/usr/bin/sample'], 5)
            self.assertEqual(backend.last_command_result['errorType'], 'FileNotFoundError')
            self.assertNotIn('DUMMY_ERROR_BODY', json.dumps(backend.last_command_result))


class CompletionTests(unittest.TestCase):
    def write_receipts(self, root, **changes):
        for platform in runner.HOSTS:
            output = Path(root) / platform
            output.mkdir(exist_ok=True)
            summary = {"outcome": "stopped", "observedLifetimes": 1,
                       "attemptedSamples": 1, "validatedSamples": 1}
            summary.update(changes)
            runner.write_json(output / "summary.json", summary)
            runner.write_json(output / "stop.json", {"outcome": "observer_exited", "forcedGroupKill": False})

    def test_missing_fatal_never_observed_and_all_failed_samples_block_diagnostics(self):
        with TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                runner.validate_directory(root)
        for changes in ({"outcome": "fatal_error"}, {"observedLifetimes": 0}, {"validatedSamples": 0}):
            with self.subTest(changes=changes), TemporaryDirectory() as root:
                self.write_receipts(root, **changes)
                with self.assertRaises(ValueError):
                    runner.validate_directory(root)

    def test_zero_eligible_is_distinguished_from_an_exercised_sampler(self):
        with TemporaryDirectory() as root:
            self.write_receipts(root, attemptedSamples=0, validatedSamples=0)
            result = runner.validate_directory(root)
            self.assertTrue(all(not row["captureExercised"] for row in result))
            self.assertTrue(all(not row["pastIncidentCauseEstablished"] for row in result))


def sample_report(path="/owned/Profiles.app/Profiles", image_uuid=IMAGE_UUID,
                  load="0x1000", rows=None):
    if rows is None:
        rows = [f"0x1000 - 0x1fff +Profiles (0) <{image_uuid}> {path}"]
    return (f"Process: Profiles [123]\nPath: {path}\nLoad Address: {load}\n"
            "Call graph:\nThread_0: main\nBinary Images:\n" + "\n".join(rows) + "\n").encode()


class ImageBindingTests(unittest.TestCase):
    def check(self, report, **changes):
        candidate = target(imageUuidByArchitecture={"arm64": IMAGE_UUID})
        candidate.update(changes)
        return runner.sample_header_checks(report, candidate)

    def test_exact_path_still_requires_the_main_image_uuid(self):
        self.assertTrue(self.check(sample_report())["accepted"])
        self.assertFalse(self.check(sample_report(image_uuid=OTHER_UUID))["accepted"])

    def test_known_literal_redaction_is_not_recorded_as_exact_path_match(self):
        expected = "/Users/owned/Library/Devices/Profiles.app/Profiles"
        result = self.check(sample_report(path="/Users/USER/*/Profiles"), executable=expected)
        self.assertTrue(result["accepted"])
        self.assertFalse(result["pathMatches"])
        self.assertEqual(result['pathClassification'], 'redacted_user_placeholder')

    def test_observed_header_and_main_image_literals_are_classified_separately(self):
        expected = "/Users/owned/Library/Devices/Profiles.app/Profiles"
        rows = [f"0x1000 - 0x1fff +Profiles (0) <{IMAGE_UUID}> /Users/*/Profiles"]
        result = self.check(sample_report(path='/Users/USER/*/Profiles', rows=rows), executable=expected)
        self.assertTrue(result['accepted'])
        self.assertFalse(result['pathMatches'])
        self.assertEqual(result['pathClassification'], 'redacted_user_placeholder')
        self.assertEqual(result['mainImagePathClassification'], 'redacted_users_path')
        self.assertFalse(self.check(sample_report(path='/Users/USER/*/Profiles', image_uuid=OTHER_UUID), executable=expected)['accepted'])

    def test_literal_forms_never_expand_unknown_paths_or_wrong_basenames(self):
        expected = "/Users/owned/Library/Devices/Profiles.app/Profiles"
        for path in ('/Users/USER/**/Profiles', '/Users/**/Profiles', '/Users/OTHER/*/Profiles',
                     '/Users/*/NotProfiles', '/Users/USER/*/../Profiles', '/foreign/Profiles'):
            with self.subTest(path=path):
                self.assertFalse(self.check(sample_report(path=path), executable=expected)['accepted'])

    def test_documented_privacy_form_can_preserve_only_the_verified_app_suffix(self):
        expected = '/Users/owned/Library/Devices/Profiles.app/Profiles'
        for path, classification in (
                ('/Users/USER/*/Profiles.app/Profiles', 'redacted_user_placeholder_app'),
                ('/Users/*/Profiles.app/Profiles', 'redacted_users_path_app')):
            result = self.check(sample_report(path=path), executable=expected)
            self.assertTrue(result['accepted'])
            self.assertFalse(result['pathMatches'])
            self.assertEqual(result['pathClassification'], classification)
        for path in ('/Users/USER/*/Foreign.app/Profiles', '/Users/*/Profiles.app/Foreign',
                     '/Users/USER/**/Profiles.app/Profiles', '/Users/USER/*/Profiles.app/../Profiles'):
            with self.subTest(path=path):
                self.assertFalse(self.check(sample_report(path=path), executable=expected)['accepted'])

    def test_observed_simulator_username_masks_preserve_the_entire_owned_tail(self):
        tail = (f'Library/Developer/CoreSimulator/Devices/{UDID}/data/Containers/Bundle/Application/'
                '11111111-2222-3333-4444-555555555555/Profiles.app/Profiles')
        expected = '/Users/owned/' + tail
        header_path, image_path = '/Users/USER/' + tail, '/Users/*/' + tail
        rows = [f'0x1000 - 0x1fff +Profiles (0) <{IMAGE_UUID}> {image_path}']
        result = self.check(sample_report(path=header_path, rows=rows), executable=expected)
        self.assertTrue(result['accepted'])
        self.assertFalse(result['pathMatches'])
        self.assertEqual(result['pathClassification'], 'redacted_username_placeholder')
        self.assertEqual(result['mainImagePathClassification'], 'redacted_username_star')
        changes = [(UDID, 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'),
                   ('11111111-2222-3333-4444-555555555555', 'AAAAAAAA-1111-2222-3333-444444444444'),
                   ('Profiles.app', 'Foreign.app'), ('Profiles.app/Profiles', 'Profiles.app/Foreign')]
        for old, new in changes:
            with self.subTest(component=old):
                bad_header = header_path.replace(old, new)
                self.assertFalse(self.check(sample_report(path=bad_header, rows=rows), executable=expected)['accepted'])
                bad_rows = [f'0x1000 - 0x1fff +Profiles (0) <{IMAGE_UUID}> {image_path.replace(old, new)}']
                self.assertFalse(self.check(sample_report(path=header_path, rows=bad_rows), executable=expected)['accepted'])

    def test_actual_username_user_keeps_canonical_path_exact(self):
        expected = '/Users/USER/Library/Developer/Devices/Profiles.app/Profiles'
        result = self.check(sample_report(path=expected), executable=expected)
        self.assertTrue(result['accepted'])
        self.assertTrue(result['pathMatches'])
        self.assertEqual(result['pathClassification'], 'exact')

    def test_correct_uuid_elsewhere_cannot_replace_the_wrong_main_image(self):
        rows = [f"0x1000 - 0x1fff +Profiles (0) <{OTHER_UUID}> /owned/Profiles.app/Profiles",
                f"0x2000 - 0x2fff +dylib (0) <{IMAGE_UUID}> /other/dylib"]
        self.assertFalse(self.check(sample_report(rows=rows))["accepted"])

    def test_duplicate_load_address_is_rejected_before_uuid_filtering(self):
        rows = [f"0x1000 - 0x1fff +Profiles (0) <{IMAGE_UUID}> /owned/Profiles.app/Profiles",
                f"0x1000 - 0x2fff +other (0) <{OTHER_UUID}> /other/app"]
        self.assertFalse(self.check(sample_report(rows=rows))["accepted"])

    def test_missing_main_image_or_load_address_is_not_accepted(self):
        self.assertFalse(self.check(sample_report(load="0x9999"))["accepted"])
        self.assertFalse(self.check(sample_report().replace(b"Load Address: 0x1000\n", b""))["accepted"])

    def test_unknown_or_conflicting_paths_stay_rejected_with_the_right_uuid(self):
        for path in ("/other/Profiles", "/Users/*/Profiles", "/Users/USER/*/NotProfiles"):
            with self.subTest(path=path):
                self.assertFalse(self.check(sample_report(path=path))["accepted"])

    def test_missing_uuid_and_wrong_pid_or_conflicting_main_path_are_rejected(self):
        self.assertFalse(self.check(sample_report(), imageUuidByArchitecture={})["accepted"])
        self.assertFalse(self.check(sample_report().replace(b'[123]', b'[456]'))["accepted"])
        rows = [f"0x1000 - 0x1fff +Profiles (0) <{IMAGE_UUID}> /foreign/Profiles"]
        self.assertFalse(self.check(sample_report(rows=rows))["accepted"])

    def test_architecture_mapping_is_preserved_without_claiming_target_architecture(self):
        data = f"UUID: {IMAGE_UUID} (arm64) /owned/Profiles.app/Profiles\nUUID: {OTHER_UUID} (x86_64) /owned/Profiles.app/Profiles\n".encode()
        mapping = runner.parse_image_uuids(data, target()['executable'])
        result = self.check(sample_report(), imageUuidByArchitecture=mapping)
        self.assertTrue(result['accepted'])
        self.assertEqual(result['matchedImageArchitectures'], ['arm64'])
        self.assertFalse(result['targetArchitectureVerified'])
        self.assertFalse(result['uuidIsCryptographicProof'])

    def test_dwarfdump_dotted_subtype_keeps_every_slice_and_rejects_conflicts(self):
        third = '55555555-6666-7777-8888-999999999999'
        data = (f'UUID: {IMAGE_UUID} (x86_64) /owned/Profiles.app/Profiles\n'
                f'UUID: {OTHER_UUID} (arm64e) /owned/Profiles.app/Profiles\n'
                f'UUID: {third} (arm64e.x1) /owned/Profiles.app/Profiles\n').encode()
        self.assertEqual(runner.parse_image_uuids(data, target()['executable']),
                         {'x86_64': IMAGE_UUID, 'arm64e': OTHER_UUID, 'arm64e.x1': third})
        for token in ('../arm64', 'arm64e x1', 'a' * 65):
            with self.subTest(token=token), self.assertRaises(ValueError):
                runner.parse_image_uuids(f'UUID: {IMAGE_UUID} ({token}) /owned/Profiles.app/Profiles\n'.encode(), target()['executable'])
        with self.assertRaises(ValueError):
            runner.parse_image_uuids(data + f'UUID: {IMAGE_UUID} (arm64e.x1) /owned/Profiles.app/Profiles\n'.encode(), target()['executable'])


if __name__ == "__main__":
    unittest.main()
