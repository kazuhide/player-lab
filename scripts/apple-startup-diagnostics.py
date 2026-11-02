"""Bounded, perturbative process samples for the owned Profiles test host only."""

import argparse
import ctypes
import datetime
import hashlib
import itertools
import json
import os
from pathlib import Path
import plistlib
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time
import uuid


HOSTS = {
    "ios": ("com.playerlab.ios.tests.profileshost", "Showcase-iOSProfilesHost"),
    "tvos": ("com.playerlab.tvos.tests.profileshost", "Showcase-tvOSProfilesHost"),
}
OBSERVED_SECONDS = 45
POLL_SECONDS = 2
QUERY_SECONDS = 2
SAMPLE_SECONDS = 1
SAMPLE_INTERVAL_MS = 20
SAMPLE_WALL_SECONDS = 5
MAX_SAMPLES = 12
MAX_STACK_BYTES = 512 * 1024
MAX_STAGE_BYTES = 8 * 1024 * 1024
MAX_METADATA_BYTES = 256 * 1024
MAX_OBSERVER_SECONDS = 1800
IDENTITY_KEYS = ("pid", "uid", "startSeconds", "startMicroseconds", "executable")
PROC_UID_ONLY = 4
UUID_PATTERN = r"[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}"


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def lifetime(identity):
    return tuple(identity[key] for key in IDENTITY_KEYS)


def path_classification(reported, expected):
    if not reported or not Path(reported).is_absolute():
        return "unknown"
    if "*" not in reported and str(Path(reported).resolve()) == expected:
        return "exact"
    if expected.startswith("/Users/"):
        # Literal report representations, never globs or ownership selectors.
        if reported == "/Users/USER/*/" + Path(expected).name:
            return "redacted_user_placeholder"
        if reported == "/Users/*/" + Path(expected).name:
            return "redacted_users_path"
        if Path(expected).parent.suffix == ".app":
            suffix = Path(expected).parent.name + "/" + Path(expected).name
            if reported == "/Users/USER/*/" + suffix:
                return "redacted_user_placeholder_app"
            if reported == "/Users/*/" + suffix:
                return "redacted_users_path_app"
        # The Simulator report may retain every component after the username.
        # Compare that whole verified tail literally, including device/container IDs.
        tail = "/".join(Path(expected).parts[3:])
        if reported == "/Users/USER/" + tail:
            return "redacted_username_placeholder"
        if reported == "/Users/*/" + tail:
            return "redacted_username_star"
    if "*" in reported:
        return "unknown"
    return "conflicting"


def image_generation(path):
    file = Path(path)
    info = file.lstat()
    if file.is_symlink() or not stat.S_ISREG(info.st_mode):
        raise ValueError("The verified executable must be a regular, unlinked file.")
    return {"device": info.st_dev, "inode": info.st_ino, "bytes": info.st_size,
            "modifiedNanoseconds": info.st_mtime_ns, "changedNanoseconds": info.st_ctime_ns}


def parse_image_uuids(data, expected_path):
    result = {}
    lines = data.decode("utf-8").splitlines()
    if not 1 <= len(lines) <= 8:
        raise ValueError("The image UUID output is empty or exceeds its limit.")
    for line in lines:
        match = re.fullmatch(r"UUID: (" + UUID_PATTERN + r") \(([A-Za-z0-9_][A-Za-z0-9_.]{0,63})\) (.+)", line)
        if (not match or path_classification(match.group(3), expected_path) != "exact"
                or match.group(2) in result):
            raise ValueError("The executable UUID output is missing, conflicting or ambiguous.")
        result[match.group(2)] = match.group(1).upper()
    return result


def private_directory(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError("The diagnostic directory must not be linked.")
    path = path.resolve()
    path.chmod(0o700)
    return path


def write_json(path, value):
    data = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    if len(data) > 16 * 1024:
        raise ValueError("Diagnostic metadata is too large.")
    path = Path(path)
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("xb") as stream:
        stream.write(data)
    temporary.chmod(0o600)
    temporary.replace(path)


class BsdInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid",
        "rgid", "svuid", "svgid", "reserved")] + [
        ("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32),
        ("nfiles", ctypes.c_uint32), ("pgid", ctypes.c_uint32),
        ("jobc", ctypes.c_uint32), ("tdev", ctypes.c_uint32),
        ("tpgid", ctypes.c_uint32), ("nice", ctypes.c_int32),
        ("startSeconds", ctypes.c_uint64), ("startMicroseconds", ctypes.c_uint64)]


def libproc():
    # Loading Darwin libraries is deliberately deferred; unit tests run on Linux.
    if sys.platform != "darwin":
        raise RuntimeError("Darwin process inspection is unavailable.")
    library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    library.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                   ctypes.c_void_p, ctypes.c_int]
    library.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32,
                                    ctypes.c_void_p, ctypes.c_int]
    return library


def raw_executable_path(library, pid):
    buffer = ctypes.create_string_buffer(4096)
    if library.proc_pidpath(pid, buffer, len(buffer)) <= 0:
        return None
    return os.fsdecode(buffer.value)


def executable_path(library, pid):
    path = raw_executable_path(library, pid)
    return str(Path(path).resolve()) if path is not None else None


def process_identity(pid, library=None):
    library = library or libproc()
    info = BsdInfo()
    if library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info):
        return None
    if info.pid != pid or info.status == 5:  # A zombie is not a live target.
        return None
    path = executable_path(library, pid)
    if path is None:
        return None
    return {"pid": pid, "uid": info.uid, "parentPid": info.ppid,
            "processGroup": info.pgid, "startSeconds": info.startSeconds,
            "startMicroseconds": info.startMicroseconds, "executable": path}


def installed_hosts(device_root, platform):
    bundle, executable = HOSTS[platform]
    application_root = Path(device_root) / "data/Containers/Bundle/Application"
    if not application_root.exists():
        return {}
    if application_root.is_symlink():
        raise ValueError("The owned application directory must not be linked.")
    directories = list(itertools.islice(application_root.iterdir(), 513))
    if len(directories) > 512:
        raise ValueError("The owned application directory exceeds its limit.")
    result = {}
    for directory in directories:
        if directory.is_symlink() or not directory.is_dir():
            continue
        for app in [directory / (executable + ".app")]:
            if app.is_symlink() or app.name != executable + ".app":
                continue
            info_path = app / "Info.plist"
            if info_path.is_symlink() or not info_path.is_file() or info_path.stat().st_size > 65536:
                continue
            try:
                info = plistlib.loads(info_path.read_bytes())
            except (ValueError, plistlib.InvalidFileException):
                continue
            if info.get("CFBundleIdentifier") != bundle or info.get("CFBundleExecutable") != executable:
                continue
            binary = app / executable
            if binary.is_symlink() or not binary.is_file():
                continue
            if app.resolve().is_relative_to(application_root.resolve()):
                result[str(binary.resolve())] = str(app.resolve())
    return result


def inspect_owned(device_root, platform, udid):
    root = Path(device_root)
    if root.name != udid or root.is_symlink():
        raise ValueError("Only the explicit owned device directory is allowed.")
    root = root.resolve()
    hosts = installed_hosts(root, platform)
    if not hosts:
        return {"state": "host_not_installed", "targets": []}
    library = libproc()
    uid = os.getuid()
    pids = (ctypes.c_int * 16384)()
    size = library.proc_listpids(PROC_UID_ONLY, uid, pids, ctypes.sizeof(pids))
    if size <= 0 or size >= ctypes.sizeof(pids) or size % ctypes.sizeof(ctypes.c_int):
        raise ValueError("The numeric process inventory is unavailable or capped.")
    targets = []
    for pid in pids[:size // ctypes.sizeof(ctypes.c_int)]:
        if pid <= 0:
            continue
        raw = raw_executable_path(library, pid)
        if raw is None or (raw not in hosts and Path(raw).name != HOSTS[platform][1]):
            continue
        # The basename limits work only; canonical path and identity establish ownership.
        if str(Path(raw).resolve()) not in hosts:
            continue
        identity = process_identity(pid, library)
        if identity and identity["uid"] == uid and identity["executable"] in hosts:
            identity.update(appContainer=hosts[identity["executable"]], ownedUDID=udid)
            targets.append(identity)
    return {"state": "observed" if targets else "no_live_owned_host", "targets": targets}


class Recorder:
    def __init__(self, output):
        self.output = private_directory(output)
        self.bytes = 0
        self.dropped = 0

    def event(self, name, **fields):
        row = {"event": name, "utc": utc(), "monotonic": time.monotonic(), **fields}
        data = (json.dumps(row, sort_keys=True) + "\n").encode()
        if self.bytes + len(data) > MAX_METADATA_BYTES - 32768:
            self.dropped += 1
            return
        with (self.output / "events.jsonl").open("ab") as stream:
            stream.write(data)
        self.bytes += len(data)


class NativeBackend:
    def __init__(self, args, recorder):
        self.args = args
        self.recorder = recorder
        self.child = None
        self.stopping = False
        self.deadline = None
        self.sample_commands_requested = 0
        self.last_command_result = None
        self.raw = private_directory(Path(args.control_dir) / "unvalidated")

    def run(self, command, timeout, *, file_limit=None, raw_output=None):
        environment = {key: value for key, value in os.environ.items()
                       if key in {"HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "DEVELOPER_DIR"}}

        def limit_file():
            resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))

        started = time.monotonic()
        deadline = started + timeout
        if self.deadline is not None:
            deadline = min(deadline, self.deadline)
        if time.monotonic() >= deadline:
            raise subprocess.TimeoutExpired(command[0], 0)
        selector = selectors.DefaultSelector()
        output = bytearray()
        received = 0
        counts = {"stdout": 0, "stderr": 0}
        eof = {"stdout": False, "stderr": False}
        if command[0] == "/usr/bin/sample":
            tool, stage = "sample", "stack_capture"
        elif command[:3] == ["/usr/bin/xcrun", "dwarfdump", "--uuid"]:
            tool, stage = "dwarfdump", "image_uuid"
        else:
            tool, stage = "python", "owned_process_inspection"

        def command_state(outcome):
            size = None
            if raw_output is not None:
                path = Path(raw_output)
                if path.parent.resolve() == self.raw and path.is_file() and not path.is_symlink():
                    size = path.stat().st_size
            return {"tool": tool, "stage": stage, "outcome": outcome,
                    "elapsedSeconds": time.monotonic() - started,
                    "wallLimitSeconds": timeout,
                    "childExitCodeAtObservation": self.child.poll() if self.child else None,
                    "stdoutEOF": eof["stdout"], "stderrEOF": eof["stderr"],
                    "stdoutBytes": counts["stdout"], "stderrBytes": counts["stderr"],
                    "openPipeCount": len(selector.get_map()), "rawBytes": size}

        try:
            self.child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                          env=environment, preexec_fn=limit_file if file_limit else None)
            selector.register(self.child.stdout, selectors.EVENT_READ, True)
            selector.register(self.child.stderr, selectors.EVENT_READ, False)
            while selector.get_map():
                if self.stopping or (Path(self.args.control_dir) / "stop.request").exists():
                    raise InterruptedError("The observer was stopped.")
                if time.monotonic() >= deadline:
                    raise subprocess.TimeoutExpired(command[0], timeout)
                for key, _ in selector.select(min(0.05, max(0, deadline - time.monotonic()))):
                    data = os.read(key.fd, 16384)
                    stream = "stdout" if key.data else "stderr"
                    if not data:
                        eof[stream] = True
                        selector.unregister(key.fileobj)
                        continue
                    counts[stream] += len(data)
                    received += len(data)
                    if received > 65536:
                        raise ValueError("The command output exceeds its limit.")
                    if key.data:
                        output.extend(data)
            self.child.wait(timeout=max(0.01, deadline - time.monotonic()))
            self.last_command_result = command_state("completed")
            return self.child.returncode, bytes(output)
        except Exception as error:
            self.last_command_result = command_state(
                "wall_limit" if isinstance(error, subprocess.TimeoutExpired) else "command_error")
            self.last_command_result["errorType"] = type(error).__name__
            self.recorder.event("diagnostic_child_failed", **self.last_command_result)
            raise
        finally:
            selector.close()
            self.cleanup_child()

    def cleanup_child(self):
        if self.child is None:
            return
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=0.3)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=0.3)
        for stream in (self.child.stdout, self.child.stderr):
            if stream:
                stream.close()
        self.child = None

    def query(self):
        command = [sys.executable, str(Path(__file__).resolve()), "inspect", "--platform",
                   self.args.platform, "--udid", self.args.udid, "--device-root", self.args.device_root]
        status, data = self.run(command, QUERY_SECONDS)
        if status:
            raise RuntimeError("Owned process inspection failed.")
        return json.loads(data)

    def generation(self, path):
        return image_generation(path)

    def capture(self, candidate):
        temporary = self.raw / (uuid.uuid4().hex + ".sample.txt")
        try:
            before = [target for target in self.query()["targets"] if lifetime(target) == lifetime(candidate)]
            if len(before) != 1 or before[0]["appContainer"] != candidate["appContainer"]:
                return {"outcome": "target_gone_before_sample"}
            generation = self.generation(candidate["executable"])
            status, uuid_output = self.run(
                ["/usr/bin/xcrun", "dwarfdump", "--uuid", candidate["executable"]], QUERY_SECONDS)
            if status:
                return {"outcome": "image_uuid_command_error", "exitCode": status}
            try:
                image_uuids = parse_image_uuids(uuid_output, candidate["executable"])
            except (ValueError, UnicodeError):
                return {"outcome": "image_uuid_output_rejected"}
            if self.generation(candidate["executable"]) != generation:
                return {"outcome": "executable_file_generation_changed"}
            command = ["/usr/bin/sample", str(candidate["pid"]), str(SAMPLE_SECONDS),
                       str(SAMPLE_INTERVAL_MS), "-file", str(temporary)]
            self.sample_commands_requested += 1
            status, _ = self.run(command, SAMPLE_WALL_SECONDS, file_limit=MAX_STACK_BYTES,
                                 raw_output=temporary)
            after = [target for target in self.query()["targets"] if lifetime(target) == lifetime(candidate)]
            if len(after) != 1 or after[0]["appContainer"] != candidate["appContainer"]:
                return {"outcome": "identity_changed_or_target_gone_after_sample"}
            if self.generation(candidate["executable"]) != generation:
                return {"outcome": "executable_file_generation_changed"}
            if temporary.is_file() and temporary.stat().st_size >= MAX_STACK_BYTES:
                return {"outcome": "stack_output_limit", "exitCode": status}
            if status:
                return {"outcome": "sample_command_error", "exitCode": status}
            if not temporary.is_file() or temporary.is_symlink():
                return {"outcome": "sample_missing"}
            size = temporary.stat().st_size
            if not 0 < size < MAX_STACK_BYTES:
                return {"outcome": "stack_output_limit"}
            data = temporary.read_bytes()
            header = sample_header_checks(data, {**candidate, "imageUuidByArchitecture": image_uuids})
            if not header["accepted"]:
                return {"outcome": "sample_header_mismatch", "headerChecks": header,
                        "sampleExitCode": status, "stackBytes": size}
            total = sum(path.stat().st_size for path in self.recorder.output.iterdir() if path.is_file())
            if total + len(data) + MAX_METADATA_BYTES > MAX_STAGE_BYTES:
                return {"outcome": "stage_output_limit"}
            destination = self.recorder.output / ("sample-" + uuid.uuid4().hex + ".txt")
            temporary.replace(destination)
            destination.chmod(0o600)
            return {"outcome": "validated_sample", "file": destination.name,
                    "bytes": size, "sha256": hashlib.sha256(data).hexdigest(),
                    "headerChecks": header, "imageGeneration": generation}
        finally:
            temporary.unlink(missing_ok=True)


def sample_header_checks(data, candidate):
    text = data.decode("utf-8", errors="replace")
    header = text.split("Call graph:", 1)[0][:16384]
    processes = re.findall(r"^Process:\s+.*\[(\d+)\]\s*$", header, re.MULTILINE)
    paths = re.findall(r"^Path:[ \t]+(.+?)[ \t]*$", header, re.MULTILINE)
    addresses = re.findall(r"^Load Address:[ \t]+(0x[0-9A-Fa-f]+)[ \t]*$", header, re.MULTILINE)
    path = paths[0] if len(paths) == 1 else None
    path_class = path_classification(path, candidate["executable"])
    load = int(addresses[0], 16) if len(addresses) == 1 else None
    image_sections = text.split("Binary Images:\n")
    rows = []
    if len(image_sections) == 2 and load is not None:
        for line in image_sections[1].splitlines():
            start = re.match(r"^\s*(0x[0-9A-Fa-f]+)\s*-", line)
            if start and int(start.group(1), 16) == load:
                rows.append(line)
    # Address-first uniqueness is mandatory, before checking any candidate UUID.
    main = None
    if len(rows) == 1:
        main = re.fullmatch(r"\s*(0x[0-9A-Fa-f]+)\s*-\s*(0x[0-9A-Fa-f]+)\s+.+?\s+<("
                            + UUID_PATTERN + r")>\s+(.+?)\s*", rows[0])
        if main and int(main.group(2), 16) < int(main.group(1), 16):
            main = None
    main_uuid = main.group(3).upper() if main else None
    main_path = main.group(4) if main else None
    main_path_class = path_classification(main_path, candidate["executable"])
    expected = candidate.get("imageUuidByArchitecture", {})
    matching_architectures = [architecture for architecture, value in expected.items() if value == main_uuid]
    checks = {"processFieldPresent": len(processes) == 1,
              "pidMatches": len(processes) == 1 and int(processes[0]) == candidate["pid"],
              "pathFieldPresent": len(paths) == 1, "pathMatches": path_class == "exact",
              "pathClassification": path_class,
              "pathSha256": hashlib.sha256(path.encode()).hexdigest() if path else None,
              "expectedPathSha256": hashlib.sha256(candidate["executable"].encode()).hexdigest(),
              "headerSha256": hashlib.sha256(data[:16384]).hexdigest(),
              "callGraphPresent": len(text.split("Call graph:\n")) == 2,
              "binaryImagesPresent": len(image_sections) == 2,
              "loadAddress": hex(load) if load is not None else None,
              "mainImageCandidateCount": len(rows), "mainImageUuid": main_uuid,
              "mainImagePathClassification": main_path_class,
              "mainImagePathSha256": hashlib.sha256(main_path.encode()).hexdigest() if main_path else None,
              "expectedUuidByArchitecture": expected, "matchedImageArchitectures": matching_architectures,
              "mainImageUuidMatches": bool(main_uuid and matching_architectures),
              "uuidIsCryptographicProof": False, "targetArchitectureVerified": False,
              "atomicProcessLifetimeProof": False}
    allowed_paths = {"exact", "redacted_user_placeholder", "redacted_users_path",
                     "redacted_user_placeholder_app", "redacted_users_path_app",
                     "redacted_username_placeholder", "redacted_username_star"}
    checks["accepted"] = (checks["pidMatches"] and path_class in allowed_paths
                          and main_path_class in allowed_paths
                          and checks["callGraphPresent"] and checks["binaryImagesPresent"]
                          and checks["mainImageCandidateCount"] == 1 and checks["mainImageUuidMatches"])
    checks["rejectionReason"] = None if checks["accepted"] else "pid_path_or_unique_main_image_binding_rejected"
    return checks


def valid_sample_header(data, candidate):
    return sample_header_checks(data, candidate)["accepted"]


class Observer:
    def __init__(self, backend, recorder):
        self.backend = backend
        self.recorder = recorder
        self.seen = {}
        self.attempted = set()
        self.validated = 0
        self.query_errors = 0
        self.observed_lifetimes = set()
        self.last_state = None

    def tick(self, now=None):
        try:
            snapshot = self.backend.query()
        except Exception as error:
            self.query_errors += 1
            self.seen.clear()
            self.recorder.event("query_error", errorType=type(error).__name__)
            return
        # Query time before receipt is not an already-observed lifetime interval.
        now = time.monotonic() if now is None else now
        if snapshot["state"] != self.last_state:
            self.recorder.event("observation_state", state=snapshot["state"])
            self.last_state = snapshot["state"]
        targets = snapshot["targets"]
        if len(targets) != 1:
            self.seen.clear()
            if len(targets) > 1:
                self.recorder.event("ambiguous_owned_targets", count=len(targets))
            return
        candidate = targets[0]
        key = lifetime(candidate)
        self.observed_lifetimes.add(key)
        if key not in self.seen:
            self.seen = {key: now}
            self.recorder.event("owned_lifetime_first_observed", identity=candidate)
        if key in self.attempted or now - self.seen[key] < OBSERVED_SECONDS:
            return
        if len(self.attempted) >= MAX_SAMPLES:
            return
        self.attempted.add(key)
        self.recorder.event("owned_lifetime_sample_started", identity=candidate,
                            observedSeconds=now - self.seen[key], perturbative=True,
                            healthyOperationPossible=True, startupOrHangProven=False)
        try:
            result = self.backend.capture(candidate)
        except Exception as error:
            result = {"outcome": "capture_error", "errorType": type(error).__name__}
            command_failure = getattr(self.backend, "last_command_result", None)
            if isinstance(command_failure, dict):
                result["commandFailure"] = command_failure
        self.validated += result["outcome"] == "validated_sample"
        self.recorder.event("owned_lifetime_sample_finished", identity=candidate, **result)


def observe(args):
    recorder = Recorder(args.output_dir)
    control = private_directory(args.control_dir)
    backend = None
    observer = None
    stopped = False
    outcome = "fatal_error"
    started = time.monotonic()
    try:
        if os.getsid(0) != os.getpid():
            os.setsid()
        identity = process_identity(os.getpid())
        parent = process_identity(args.parent_pid)
        if not identity or not parent or os.getppid() != args.parent_pid or parent["uid"] != os.getuid():
            raise ValueError("The observer parent identity could not be bound.")
        if identity["processGroup"] != os.getpid() or identity["uid"] != os.getuid():
            raise ValueError("The observer must own its separate process group.")
        with (control / "started").open("x"):
            pass
        write_json(control / "instance.json", {"identity": identity, "parent": parent,
                   "outputDirectory": str(recorder.output), "controlDirectory": str(control)})
        backend = NativeBackend(args, recorder)
        # Reserve three seconds for stopping/reaping diagnostic children and metadata.
        backend.deadline = started + MAX_OBSERVER_SECONDS - 3
        observer = Observer(backend, recorder)

        def stop_signal(_number, _frame):
            nonlocal stopped
            stopped = True
            backend.stopping = True

        signal.signal(signal.SIGINT, stop_signal)
        signal.signal(signal.SIGTERM, stop_signal)
        recorder.event("observer_started", platform=args.platform, ownedUDID=args.udid,
                       phase="concrete_profiles_test_without_building", identity=identity,
                       parent=parent, captureTimingGuaranteed=False, sampleIntervalMilliseconds=20,
                       processReuseAttachRaceEliminated=False)
        while not stopped and not (control / "stop.request").exists():
            if time.monotonic() >= backend.deadline:
                outcome = "observer_time_limit"
                break
            current_parent = process_identity(args.parent_pid)
            if not current_parent or lifetime(current_parent) != lifetime(parent):
                outcome = "parent_lifetime_ended"
                break
            observer.tick()
            for _ in range(20):
                if stopped or (control / "stop.request").exists() or time.monotonic() >= backend.deadline:
                    break
                time.sleep(POLL_SECONDS / 20)
        else:
            outcome = "stopped"
    except Exception as error:
        recorder.event("observer_fatal_error", errorType=type(error).__name__)
    finally:
        if backend:
            backend.cleanup_child()
            for path in backend.raw.glob("*"):
                path.unlink(missing_ok=True)
        write_json(recorder.output / "summary.json", {
            "outcome": outcome, "utc": utc(), "durationSeconds": time.monotonic() - started,
            "attemptedSamples": len(observer.attempted) if observer else 0,
            "sampleCommandsRequested": backend.sample_commands_requested if backend else 0,
            "validatedSamples": observer.validated if observer else 0,
            "queryErrors": observer.query_errors if observer else 0,
            "observedLifetimes": len(observer.observed_lifetimes) if observer else 0,
            "sampleAttemptLimitReached": bool(observer and len(observer.attempted) >= MAX_SAMPLES),
            "metadataEventsDropped": recorder.dropped, "perturbative": True,
            "healthyOperationPossible": True, "zeroSamplesIsNotCaptureValidation": True,
            "pastIncidentCauseEstablished": False, "nativeTestVerdict": "independent"})
    return 1 if outcome == "fatal_error" else 0


def stop_observer(args):
    control = Path(args.control_dir)
    if control.is_symlink() or not control.is_dir():
        return 1
    request = control / "stop.request"
    descriptor = os.open(request, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.close(descriptor)
    manifest_path = control / "instance.json"
    if (not manifest_path.is_file() or manifest_path.is_symlink()
            or manifest_path.stat().st_size > 16384):
        return 1
    manifest = json.loads(manifest_path.read_text())
    expected = manifest["identity"]
    if expected["pid"] != args.observer_pid:
        return 1
    result = {"utc": utc(), "observerPid": args.observer_pid, "forcedGroupKill": False,
              "gracefulReapingProven": False}
    for timeout, action in ((1, None), (1, signal.SIGTERM), (1, signal.SIGKILL)):
        current = process_identity(args.observer_pid)
        if current is None:
            result["outcome"] = "observer_exited"
            break
        if (lifetime(current) != lifetime(expected) or current["uid"] != os.getuid()
                or current["processGroup"] != args.observer_pid
                or os.getsid(args.observer_pid) != args.observer_pid):
            result["outcome"] = "observer_identity_mismatch"
            break
        if action:
            os.killpg(args.observer_pid, action)
            result["forcedGroupKill"] = action == signal.SIGKILL
        deadline = time.monotonic() + timeout
        while process_identity(args.observer_pid) is not None and time.monotonic() < deadline:
            time.sleep(0.05)
    if "outcome" not in result:
        result["outcome"] = "observer_exited" if process_identity(args.observer_pid) is None else "observer_stop_unconfirmed"
    write_json(Path(manifest["outputDirectory"]) / "stop.json", result)
    return 0 if result["outcome"] == "observer_exited" else 1


def ready_observer(args):
    deadline = time.monotonic() + QUERY_SECONDS
    while time.monotonic() < deadline:
        path = Path(args.control_dir) / "instance.json"
        if path.is_file() and not path.is_symlink() and path.stat().st_size <= 16384:
            manifest = json.loads(path.read_text())
            expected = manifest["identity"]
            current = process_identity(args.observer_pid)
            if (current and current["pid"] == args.observer_pid == expected["pid"]
                    and lifetime(current) == lifetime(expected) and current["uid"] == os.getuid()
                    and current["parentPid"] == os.getppid()
                    and current["processGroup"] == args.observer_pid
                    and os.getsid(args.observer_pid) == args.observer_pid):
                return 0
        time.sleep(0.05)
    return 1


def validate_directory(directory):
    result = []
    for platform in HOSTS:
        output = Path(directory) / platform
        summary_path, stop_path = output / "summary.json", output / "stop.json"
        if not summary_path.is_file() or not stop_path.is_file():
            raise ValueError("A Profiles observer completion or stop receipt is missing.")
        summary = json.loads(summary_path.read_text())
        stopped = json.loads(stop_path.read_text())
        if (summary["outcome"] != "stopped" or stopped["outcome"] != "observer_exited"
                or stopped["forcedGroupKill"] or summary["observedLifetimes"] < 1):
            raise ValueError("A Profiles observer did not complete its owned observation cleanly.")
        if summary["attemptedSamples"] and not summary["validatedSamples"]:
            raise ValueError("No attempted process sample passed its validation.")
        result.append({"platform": platform, "observedLifetimes": summary["observedLifetimes"],
                       "validatedSamples": summary["validatedSamples"],
                       "captureExercised": summary["validatedSamples"] > 0,
                       "pastIncidentCauseEstablished": False})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    for name in ("observe", "inspect"):
        command = sub.add_parser(name)
        command.add_argument("--platform", choices=HOSTS, required=True)
        command.add_argument("--udid", required=True)
        command.add_argument("--device-root")
        if name == "observe":
            command.add_argument("--output-dir", required=True)
            command.add_argument("--control-dir", required=True)
            command.add_argument("--parent-pid", type=int, required=True)
    for name in ("stop", "ready"):
        command = sub.add_parser(name)
        command.add_argument("--control-dir", required=True)
        command.add_argument("--observer-pid", type=int, required=True)
    command = sub.add_parser("validate")
    command.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if args.mode in {"observe", "inspect"}:
        args.udid = str(uuid.UUID(args.udid)).upper()
        expected = Path.home() / "Library/Developer/CoreSimulator/Devices" / args.udid
        args.device_root = str(expected) if args.device_root is None else args.device_root
        if Path(args.device_root).resolve() != expected.resolve():
            parser.error("Only the selected simulator's standard device directory is allowed.")
    if args.mode == "inspect":
        print(json.dumps(inspect_owned(args.device_root, args.platform, args.udid)))
        return 0
    if args.mode == "validate":
        print(json.dumps(validate_directory(args.output_dir)))
        return 0
    if args.mode == "observe":
        return observe(args)
    return ready_observer(args) if args.mode == "ready" else stop_observer(args)


if __name__ == "__main__":
    raise SystemExit(main())
