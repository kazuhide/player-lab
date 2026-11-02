#!/usr/bin/env python3
"""Seal Apple result members and guard one non-destructive upload-stage recovery."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
import urllib.request
import zipfile

MAX_FILES = 50000
MAX_BYTES = 8 * 1024 ** 3
MAX_MANIFEST = 16 * 1024 ** 2
MAX_RESPONSE = 512 * 1024
SNAPSHOT_SECONDS = 120
API_SECONDS = 20
REQUIRED_STEPS = (
    "checkout", "shared_ui", "sync_shared_ui", "playback_core", "xcodegen",
    "prepare_configuration", "generate_project", "restore_sdks", "ios_configuration",
    "configuration_results", "ios_profiles", "ios_results", "stop_ios", "tvos_profiles",
    "tvos_results", "diagnostic_validation", "diagnostic_results",
)


class EvidenceError(ValueError):
    """An unsafe, missing or ambiguous evidence state."""


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def positive(value):
    return isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,18}", value) is not None


def sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def identity(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def snapshot(root):
    """Hash regular members without following links; retain directory identity too."""
    deadline = time.monotonic() + SNAPSHOT_SECONDS
    files, directories, identities = [], [], []
    total = 0

    def visit(descriptor, relative, depth):
        nonlocal total
        require(depth <= 64 and time.monotonic() < deadline, "Result snapshot exceeded its bounds.")
        before = os.fstat(descriptor)
        with os.scandir(descriptor) as scan:
            names = sorted(entry.name for entry in scan)
        require(len(names) + len(files) + len(directories) <= MAX_FILES, "Too many result members.")
        for name in names:
            # The pinned action excludes hidden files by default; never silently omit one.
            require(not name.startswith(".") and not any(char in name for char in '\\":<>|*?')
                    and all(32 <= ord(char) != 127 for char in name) and len(name.encode()) <= 255,
                    "A result member cannot be represented safely by the pinned uploader.")
            path = (relative + "/" + name).lstrip("/")
            require(len(path.encode()) <= 4096, "A result member path is too long.")
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                try:
                    require(identity(os.fstat(child)) == identity(info), "A result directory changed.")
                    directories.append({"path": path, "type": "directory"})
                    visit(child, path, depth + 1)
                finally:
                    os.close(child)
            else:
                require(stat.S_ISREG(info.st_mode), "Only regular result members are allowed.")
                total += info.st_size
                require(total <= MAX_BYTES, "Result bytes exceeded the evidence bound.")
                member = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
                try:
                    require(identity(os.fstat(member)) == identity(info), "A result member changed.")
                    digest, size = hashlib.sha256(), 0
                    with os.fdopen(member, "rb", closefd=False) as stream:
                        while chunk := stream.read(512 * 1024):
                            size += len(chunk)
                            require(size <= info.st_size and time.monotonic() < deadline,
                                    "A result member changed or exceeded its deadline.")
                            digest.update(chunk)
                    require(size == info.st_size and identity(os.fstat(member)) == identity(info),
                            "A result member changed while hashing.")
                finally:
                    os.close(member)
                files.append({"path": path, "type": "file", "size": size, "sha256": digest.hexdigest()})
                identities.append({"path": path, "stat": identity(info)})
            require(identity(os.stat(name, dir_fd=descriptor, follow_symlinks=False)) == identity(info),
                    "A result path changed while hashing.")
        require(identity(os.fstat(descriptor)) == identity(before), "A result directory changed while hashing.")
        identities.append({"path": relative, "stat": identity(before)})

    try:
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            visit(descriptor, "", 0)
        finally:
            os.close(descriptor)
    except OSError:
        raise EvidenceError("The completed result bundle is missing or unsafe.") from None
    require(files, "The completed result bundle has no regular members.")
    return {"members": sorted(files, key=lambda row: row["path"]),
            "directories": sorted(directories, key=lambda row: row["path"]),
            "inputIdentityDigest": hashlib.sha256(canonical(sorted(identities, key=lambda row: row["path"]))).hexdigest()}


def context(env):
    repository = env.get("GITHUB_REPOSITORY", "")
    require(re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*", repository),
            "The current repository identity is invalid.")
    require(positive(env.get("GITHUB_RUN_ID")) and positive(env.get("GITHUB_RUN_ATTEMPT")),
            "The current run identity is invalid.")
    source, checkout = env.get("EVIDENCE_SOURCE_HEAD", ""), env.get("GITHUB_SHA", "")
    require(all(re.fullmatch(r"[0-9a-f]{40}", value) for value in (source, checkout)),
            "The source identity is invalid.")
    require(env.get("GITHUB_JOB") == "ios", "Only the Apple job owns these result names.")
    require(env.get("GITHUB_EVENT_NAME") in ("push", "pull_request", "workflow_dispatch"),
            "Unknown current workflow event.")
    return {"repository": repository, "runId": int(env["GITHUB_RUN_ID"]),
            "runAttempt": int(env["GITHUB_RUN_ATTEMPT"]), "job": "ios",
            "sourceHead": source, "checkout": checkout, "event": env.get("GITHUB_EVENT_NAME", "")}


def locations(platform, env):
    require(platform in ("ios", "tvos"), "Unknown Apple result platform.")
    root = Path(env["RUNNER_TEMP"]).resolve(strict=True)
    require("\n" not in str(root) and "\r" not in str(root), "The runner directory is unsafe.")
    return (root / f"apple-profiles-{platform}.xcresult",
            root / "apple-profiles-startup-diagnostics" / "result-evidence" / platform)


def write_record(path, value):
    body = json.dumps(value, indent=2, sort_keys=True).encode() + b"\n"
    require(len(body) <= MAX_MANIFEST, "Evidence metadata exceeded its bound.")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(body)


def read_record(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Evidence metadata is unsafe.")
        body = stream.read(MAX_MANIFEST + 1)
    require(len(body) <= MAX_MANIFEST, "Evidence metadata exceeded its bound.")
    return json.loads(body)


def seal(platform, env):
    bundle, state = locations(platform, env)
    current = context(env)
    try:
        parent = os.open(state.parents[2], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in ("apple-profiles-startup-diagnostics", "result-evidence"):
                try:
                    os.mkdir(part, mode=0o700, dir_fd=parent)
                except FileExistsError:
                    pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                os.close(parent)
                parent = child
            os.mkdir(platform, mode=0o700, dir_fd=parent)
        finally:
            os.close(parent)
        captured = snapshot(bundle)
        manifest = {**current, "schema": 1, "platform": platform, "bundle": bundle.name,
                    "artifactName": f"apple-profiles-{platform}-ui-results", **captured,
                    "contentDigest": hashlib.sha256(canonical(captured["members"])).hexdigest()}
        write_record(state / "manifest.json", manifest)
        return manifest
    except OSError:
        raise EvidenceError("The result seal could not obtain exclusive ownership.") from None


def unchanged(platform, env):
    bundle, state = locations(platform, env)
    require(state.resolve(strict=True) == state, "Result evidence state is unsafe.")
    manifest = read_record(state / "manifest.json")
    require(all(manifest.get(key) == value for key, value in context(env).items()),
            "The result seal belongs to another source or run.")
    actual = snapshot(bundle)
    require(all(manifest.get(key) == value for key, value in actual.items()), "The sealed result bundle changed.")
    require(manifest.get("platform") == platform and manifest.get("bundle") == bundle.name
            and manifest.get("artifactName") == f"apple-profiles-{platform}-ui-results"
            and manifest.get("contentDigest") == hashlib.sha256(canonical(actual["members"])).hexdigest(),
            "The result seal identity is inconsistent.")
    return manifest, state


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise EvidenceError("Artifact metadata redirects are not allowed.")


def request_metadata(path, env, deadline):
    require(env.get("GITHUB_API_URL") == "https://api.github.com", "Only the fixed GitHub API is allowed.")
    require(env.get("GITHUB_TOKEN"), "Artifact metadata requires a read-only token.")
    current = context(env)
    base = f"/repos/{current['repository']}/actions/runs/{current['runId']}"
    require(path in (base + f"/attempts/{current['runAttempt']}", base + "/artifacts?per_page=100&page=1")
            and time.monotonic() < deadline, "The metadata request is outside the current run or deadline.")
    request = urllib.request.Request("https://api.github.com" + path, headers={
        "Authorization": "Bearer " + env["GITHUB_TOKEN"], "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "player-lab-apple-result-evidence",
    })
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=min(5, max(0.1, deadline - time.monotonic()))) as response:
            require(response.status == 200 and not response.headers.get("Link"),
                    "Artifact metadata is incomplete or paginated.")
            require(response.geturl() == request.full_url, "Artifact metadata identity changed.")
            body = bytearray()
            while len(body) <= MAX_RESPONSE:
                require(time.monotonic() < deadline, "Artifact metadata exceeded its deadline.")
                chunk = response.read1(min(64 * 1024, MAX_RESPONSE + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
        require(len(body) <= MAX_RESPONSE and time.monotonic() < deadline,
                "Artifact metadata exceeded its response or time bound.")
        def unique_pairs(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, "Artifact metadata has duplicate fields.")
                result[key] = value
            return result
        result = json.loads(body, object_pairs_hook=unique_pairs)
        require(isinstance(result, dict), "Artifact metadata is not an object.")
        return result
    except Exception:
        # Never expose response bodies, authorization headers or signed endpoint URLs.
        raise EvidenceError("The bounded artifact metadata lookup failed.") from None


def guard(platform, env, api=None):
    manifest, state = unchanged(platform, env)
    require(not (state / "recovery.json").exists(), "Only one additional upload stage is allowed.")
    deadline = time.monotonic() + API_SECONDS
    lookup = api or (lambda path: request_metadata(path, env, deadline))
    base = f"/repos/{manifest['repository']}/actions/runs/{manifest['runId']}"
    try:
        run = lookup(base + f"/attempts/{manifest['runAttempt']}")
        require(type(run.get("id")) is int and type(run.get("run_attempt")) is int
                and run.get("id") == manifest["runId"] and run.get("run_attempt") == manifest["runAttempt"]
                and run.get("head_sha") == manifest["sourceHead"] and run.get("event") == manifest["event"]
                and run.get("repository", {}).get("full_name") == manifest["repository"],
                "The metadata run does not match this producer.")
        listed = lookup(base + "/artifacts?per_page=100&page=1")
        rows, count = listed.get("artifacts"), listed.get("total_count")
        require(type(count) is int and isinstance(rows, list) and 0 <= count == len(rows) <= 100,
                "The artifact list is incomplete or exceeds its bound.")
        for row in rows:
            require(isinstance(row, dict) and type(row.get("id")) is int and row["id"] > 0
                    and isinstance(row.get("name"), str) and len(row["name"]) <= 255,
                    "Artifact metadata is ambiguous.")
            require(row["name"] != manifest["artifactName"], "An original artifact already owns this name.")
        require(time.monotonic() < deadline, "Artifact metadata exceeded its deadline.")
        unchanged(platform, env)
        write_record(state / "recovery.json", {**context(env), "contentDigest": manifest["contentDigest"],
                                               "finalizedNameAbsent": True, "additionalUploadStages": 1})
    except Exception:
        raise EvidenceError("The additional upload stage was not safely authorized.") from None


def finish(platform, env):
    manifest, state = unchanged(platform, env)
    first, second, guarded = (env.get(name, "") for name in ("FIRST_OUTCOME", "SECOND_OUTCOME", "GUARD_OUTCOME"))
    if first == "success":
        require(second == guarded == "skipped", "A successful original must never be uploaded again.")
        selected = "FIRST"
    else:
        require((first, guarded, second) == ("failure", "success", "success"), "Result transport did not succeed.")
        recovery = read_record(state / "recovery.json")
        require(recovery == {**context(env), "contentDigest": manifest["contentDigest"],
                             "finalizedNameAbsent": True, "additionalUploadStages": 1}, "Recovery ownership changed.")
        selected = "SECOND"
    artifact_id, digest = env.get(selected + "_ARTIFACT_ID", ""), env.get(selected + "_ARTIFACT_DIGEST", "")
    require(positive(artifact_id) and sha256(digest), "Required artifact ID or ZIP digest is missing or invalid.")
    receipt = {**context(env), "artifactName": manifest["artifactName"], "artifactId": int(artifact_id),
               "artifactDigest": digest, "contentDigest": manifest["contentDigest"],
               "attempts": [first, second], "guardOutcome": guarded}
    write_record(state / "upload.json", receipt)
    return receipt


def verify_archive(manifest, archive, digest):
    """Verify the downloaded original ZIP separately from its member-content digest."""
    deadline = time.monotonic() + SNAPSHOT_SECONDS
    require(sha256(digest) and Path(archive).stat().st_size <= MAX_BYTES, "Invalid original artifact ZIP.")
    actual = hashlib.sha256()
    with Path(archive).open("rb") as stream:
        while chunk := stream.read(512 * 1024):
            require(time.monotonic() < deadline, "Original artifact verification exceeded its deadline.")
            actual.update(chunk)
    require(actual.hexdigest() == digest, "The original ZIP digest does not match.")
    expected = {row["path"]: row for row in manifest["members"]}
    directories = {row["path"] for row in manifest["directories"]}
    found, names, total = [], set(), 0
    with zipfile.ZipFile(archive) as zipped:
        require(len(zipped.infolist()) <= MAX_FILES, "Too many archived members.")
        for info in zipped.infolist():
            path = info.filename.rstrip("/")
            require(info.orig_filename == info.filename and path and path not in names
                    and "\\" not in path and not PurePosixPath(path).is_absolute()
                    and all(part not in ("", ".", "..") for part in path.split("/")), "Unsafe archived member path.")
            names.add(path)
            mode = info.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG)
                    and not info.flag_bits & 1, "Unsafe archived member type.")
            if info.is_dir():
                require(path in directories, "Unexpected archived directory.")
                continue
            require(path in expected and info.file_size == expected[path]["size"], "Archived member set or size changed.")
            total += info.file_size
            require(total <= MAX_BYTES, "Archived result bytes exceeded their bound.")
            member_hash, size = hashlib.sha256(), 0
            with zipped.open(info) as stream:
                while chunk := stream.read(512 * 1024):
                    size += len(chunk)
                    require(size <= info.file_size and time.monotonic() < deadline,
                            "Archived member exceeded its size or verification deadline.")
                    member_hash.update(chunk)
            require(size == info.file_size and member_hash.hexdigest() == expected[path]["sha256"],
                    "Archived member content changed.")
            found.append({"path": path, "type": "file", "size": size, "sha256": member_hash.hexdigest()})
    content_digest = hashlib.sha256(canonical(sorted(found, key=lambda row: row["path"]))).hexdigest()
    require(len(found) == len(expected) and content_digest == manifest["contentDigest"], "Archived result content is incomplete.")
    return content_digest


def terminal_gate(outcomes, cancelled):
    require(not cancelled and set(outcomes) == set(REQUIRED_STEPS)
            and all(outcomes[name] == "success" for name in REQUIRED_STEPS),
            "Apple qualification requires every native, prerequisite, diagnostic and evidence stage to succeed.")


def validate_upload_receipts(env):
    for platform in ("ios", "tvos"):
        manifest, state = unchanged(platform, env)
        receipt = read_record(state / "upload.json")
        prefix = platform.upper()
        artifact_id = env.get(prefix + "_ARTIFACT_ID", "")
        digest = env.get(prefix + "_ARTIFACT_DIGEST", "")
        content_digest = env.get(prefix + "_CONTENT_DIGEST", "")
        require(positive(artifact_id) and sha256(digest) and sha256(content_digest)
                and receipt.get("artifactId") == int(artifact_id)
                and receipt.get("artifactDigest") == digest
                and receipt.get("contentDigest") == content_digest == manifest["contentDigest"]
                and receipt.get("artifactName") == manifest["artifactName"]
                and all(receipt.get(key) == value for key, value in context(env).items()),
                "The result upload receipt or required action outputs do not match.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("seal", "guard", "finish", "gate", "verify-archive"))
    parser.add_argument("--platform", choices=("ios", "tvos"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--artifact-digest")
    args = parser.parse_args()
    if args.mode == "gate":
        terminal_gate(json.loads(os.environ["REQUIRED_OUTCOMES"]), os.environ.get("CANCELLED") != "false")
        validate_upload_receipts(os.environ)
        print("Every required Apple stage succeeded.")
    elif args.mode == "verify-archive":
        print(verify_archive(read_record(args.manifest), args.archive, args.artifact_digest))
    else:
        require(args.platform is not None, "An Apple result platform is required.")
        if args.mode == "guard":
            guard(args.platform, os.environ)
        else:
            record = seal(args.platform, os.environ) if args.mode == "seal" else finish(args.platform, os.environ)
            outputs = {"artifact-name": record["artifactName"], "content-digest": record["contentDigest"]}
            if args.mode == "seal":
                outputs["bundle-path"] = str(locations(args.platform, os.environ)[0])
            else:
                outputs.update({"artifact-id": str(record["artifactId"]), "artifact-digest": record["artifactDigest"]})
            with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
                for key, value in outputs.items():
                    stream.write(f"{key}={value}\n")
        print("Apple result evidence stage completed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("::error::Apple result evidence is missing, changed, unsafe, or could not be retained.", file=sys.stderr)
        raise SystemExit(1) from None
