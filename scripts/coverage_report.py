#!/usr/bin/env python3
"""Validate public API evidence and generate deterministic category summaries."""
import argparse
from collections import Counter
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.parse import unquote, urlsplit

CATEGORIES = ("configuration", "command", "observation", "event")
STATUSES = ("direct", "preset", "observed", "internal", "code-only", "missing", "sdk-ui-unverified")
REPOSITORIES = {"player-ios", "player-ios-core", "bitmovin-player-ui", "bitmovin-player-react-native",
    "bitmovin-player-web-sample-fire-tv-vega", "bitmovin-player-android-samples", "bitmovin-player-ios-samples"}
PACKAGES = {"bitmovin-player", "bitmovin-player-ui", "bitmovin-player-react-native"}


class CoverageError(ValueError):
    """The supplied evidence cannot support a reproducible public report."""


def _require(condition, message):
    if not condition:
        raise CoverageError(message)


def _text(value):
    _require(isinstance(value, str) and bool(value.strip()) and "\x00" not in value,
             "Expected a nonempty string.")
    return value


def _id(value):
    _text(value)
    _require(not value.startswith(("/", "\\")) and not re.match(r"^[A-Za-z]:[\\/]", value)
             and "://" not in value and not re.search(r"(?:^|[/\\])(Users|home|private|tmp|var)[/\\]", value)
             and not any(ord(c) < 32 for c in value), "Public IDs must not contain local paths or control characters.")
    return value


def _object(value, required, optional=()):
    _require(isinstance(value, dict), "Expected a JSON object.")
    _require(set(required) <= set(value) <= set(required) | set(optional), "Missing or unsupported object fields.")


def _array(value):
    _require(isinstance(value, list), "Expected a JSON array.")
    return value


def _hash(value):
    _require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), "Expected a lowercase SHA-256 hash.")


def _date(value):
    _require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), "Expected an ISO date.")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise CoverageError("Invalid calendar date.") from error


def _relative(value):
    _text(value)
    parts = value.split("/")
    _require(not value.startswith("/") and "\\" not in value and ":" not in value
             and all(p and p not in (".", "..") for p in parts), "Unsafe relative evidence path.")
    _require(not any(p.lower().startswith(".env") or p.lower() in
             {".git", "local.xcconfig", "local.properties", "key.properties"} for p in parts),
             "Secret or environment files cannot be evidence.")
    return value


def _official(value):
    _text(value)
    try:
        parsed = urlsplit(value)
        path = unquote(parsed.path)
        _require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
                 and parsed.port in (None, 443) and "\\" not in path and "%" not in path
                 and not any(ord(c) < 32 for c in value)
                 and not any(p in (".", "..") for p in path.split("/")),
                 "Official references must be safe HTTPS URLs.")
        host, parts = parsed.hostname.lower(), path.strip("/").split("/")
        allowed = (host == "cdn.bitmovin.com" and path.startswith("/player/")) or (
            host == "developer.bitmovin.com" and path.startswith("/playback/")) or (
            host == "artifacts.bitmovin.com" and path.startswith("/artifactory/public-releases/com/bitmovin/player/")) or (
            host in {"github.com", "raw.githubusercontent.com"} and len(parts) >= 2
            and parts[0] == "bitmovin" and parts[1] in REPOSITORIES) or (
            host == "api.github.com" and len(parts) >= 3 and parts[0] == "repos"
            and parts[1] == "bitmovin" and parts[2] in REPOSITORIES) or (
            host == "registry.npmjs.org" and parts[0] in PACKAGES)
        _require(allowed, "Reference is outside the relevant primary-vendor allowlist.")
    except ValueError as error:
        raise CoverageError("Invalid official URL.") from error


def _line(evidence, content=None):
    if "line" in evidence:
        line = evidence["line"]
        _require(type(line) is int and line > 0, "Evidence line must be a positive integer.")
        if content is not None:
            _require(line <= len(content.splitlines()), "Evidence line is outside the source file.")


class _Repo:
    def __init__(self, root, revision):
        _require(isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}", revision), "Expected a 40-hex sourceRevision.")
        self.root, self.revision, self.cache = Path(root).resolve(), revision, {}
        self.git("cat-file", "-e", revision + "^{commit}")
        self.tracked = {}
        for entry in self.git("ls-files", "--stage", "-z").split(b"\0"):
            if entry:
                metadata, file = entry.split(b"\t", 1)
                mode, _, stage = metadata.decode().split()
                if stage == "0":
                    self.tracked[file.decode()] = mode

    def git(self, *args):
        try:
            return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.DEVNULL)
        except (OSError, subprocess.CalledProcessError) as error:
            raise CoverageError("Cannot read the declared repository revision or tracked source.") from error

    def read(self, file):
        _relative(file)
        if file not in self.cache:
            _require(self.tracked.get(file) in {"100644", "100755"}, "App evidence must be a tracked regular file.")
            target = self.root
            for part in file.split("/"):
                target = target / part
                _require(not target.is_symlink(), "Symlink evidence is not allowed.")
            try:
                descriptor = os.open(target, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(descriptor, "rb") as reader:
                    meta = os.fstat(reader.fileno())
                    _require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1 and meta.st_size <= 10 * 1024 * 1024,
                             "Evidence must be a bounded regular file without hard links.")
                    current = reader.read()
            except OSError as error:
                raise CoverageError("Cannot read app evidence.") from error
            recorded = self.git("show", self.revision + ":" + file)
            _require(current == recorded, "App source has drifted from sourceRevision: " + file)
            self.cache[file] = current
        return self.cache[file]


def validate(data, repo, *, versions, sdk_resolver=None, inventory_ids=None):
    """Validate normalized data, current app evidence, dependency versions and ID completeness."""
    _object(data, {"schemaVersion", "checkedAt", "sourceRevision", "sdks", "applications"})
    _require(type(data["schemaVersion"]) is int and data["schemaVersion"] == 1, "Unsupported schemaVersion.")
    checked = _date(data["checkedAt"])
    repository = _Repo(repo, data["sourceRevision"])
    _require(isinstance(versions, dict), "Resolved dependency versions are required.")
    _require(inventory_ids is None or isinstance(inventory_ids, dict), "Authoritative inventory must be an object.")
    sdks = {}
    for sdk in _array(data["sdks"]):
        _object(sdk, {"id", "name", "version", "channel", "latestVersion", "latestCheckedAt", "sources"})
        key = _id(sdk["id"])
        _require(key not in sdks, "Duplicate SDK ID.")
        for field in ("name", "version", "channel", "latestVersion"):
            _text(sdk[field])
        _require(versions.get(key) == sdk["version"], "SDK dependency version is missing or stale: " + key)
        _require(_date(sdk["latestCheckedAt"]) <= checked, "SDK check date is after the report check date.")
        _require(bool(_array(sdk["sources"])), "SDK sources cannot be empty.")
        for source in sdk["sources"]:
            _object(source, {"url"}, {"sha256"})
            _official(source["url"])
            if "sha256" in source:
                _hash(source["sha256"])
        sdks[key] = sdk
    app_ids = set()
    for app in _array(data["applications"]):
        _object(app, {"id", "sdkId", "platform", "rows", "excluded", "scopeNotes"})
        key = _id(app["id"])
        _require(key not in app_ids, "Duplicate application ID.")
        app_ids.add(key)
        _text(app["sdkId"])
        _require(app["sdkId"] in sdks, "Unknown application SDK reference.")
        sdk = sdks[app["sdkId"]]
        _text(app["platform"])
        for note in _array(app["scopeNotes"]):
            _text(note)
        ids = set()
        for row in _array(app["rows"]):
            _object(row, {"id", "category", "scope", "deprecated", "status", "officialReference", "evidence"})
            member = _id(row["id"])
            _require(member not in ids, "Duplicate API row ID in " + key)
            ids.add(member)
            _id(row["scope"])
            _require(row["category"] in CATEGORIES and row["status"] in STATUSES, "Unknown category or status.")
            _require(type(row["deprecated"]) is bool, "deprecated must be boolean.")
            _official(row["officialReference"])
            app_evidence = False
            for evidence in _array(row["evidence"]):
                _require(isinstance(evidence, dict), "Expected an evidence object.")
                kind = evidence.get("kind")
                _require(kind in {"app", "sdk"}, "Unknown evidence kind.")
                required = {"kind", "file", "sha256"} | ({"package", "version"} if kind == "sdk" else set())
                _object(evidence, required, {"line"} | ({"symbol"} if kind == "app" else set()))
                _relative(evidence["file"])
                _hash(evidence["sha256"])
                content = None
                if kind == "app":
                    content = repository.read(evidence["file"])
                    app_evidence = True
                    if "symbol" in evidence:
                        _text(evidence["symbol"])
                else:
                    _id(evidence["package"])
                    _text(evidence["version"])
                    expected = versions.get(evidence["package"], sdk["version"])
                    _require(evidence["version"] == expected, "SDK evidence version mismatch.")
                    if sdk_resolver is not None:
                        content = sdk_resolver(evidence["package"], evidence["version"], evidence["file"])
                        _require(isinstance(content, bytes), "SDK resolver must return exact source bytes.")
                if content is not None:
                    _require(hashlib.sha256(content).hexdigest() == evidence["sha256"], "Evidence hash mismatch.")
                _line(evidence, content)
            if row["status"] != "missing":
                _require(app_evidence, "Exposure or code-use status requires verified app evidence.")
        excluded = set()
        for item in _array(app["excluded"]):
            _object(item, {"id", "reason"})
            value = _id(item["id"])
            _require(value not in ids and value not in excluded, "Excluded IDs must be unique and unavailable.")
            _text(item["reason"])
            excluded.add(value)
        if inventory_ids is not None:
            expected = inventory_ids.get(key)
            _require(isinstance(expected, (list, tuple, set)), "Missing authoritative application inventory.")
            for member in expected:
                _id(member)
            _require(len(expected) == len(set(expected)) and ids == set(expected), "API rows do not match the authoritative inventory: " + key)
    if inventory_ids is not None:
        _require(set(inventory_ids) == app_ids, "Authoritative inventory application IDs do not match.")


def _canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    except (TypeError, ValueError) as error:
        raise CoverageError("Report contains unsupported or nonfinite values.") from error


def _metrics(rows):
    result = {}
    for category in CATEGORIES:
        group = [r for r in rows if r["category"] == category]
        counts, denominator = Counter(r["status"] for r in group), len(group)
        result[category] = {"denominator": denominator, "byStatus": {s: counts[s] for s in STATUSES},
            "deprecated": sum(r["deprecated"] for r in group),
            "percentDirect": round(100 * counts["direct"] / denominator, 2) if denominator else None,
            "percentDirectOrPreset": round(100 * (counts["direct"] + counts["preset"]) / denominator, 2) if denominator else None}
    return result


def summarize(data):
    """Aggregate validated rows only; no cross-category coverage percentage exists."""
    normalized = dict(data)
    normalized["sdks"] = sorted((dict(s, sources=sorted(s["sources"], key=lambda x: _canonical(x)))
                                 for s in data["sdks"]), key=lambda s: s["id"])
    normalized["applications"] = sorted((dict(a,
        rows=sorted((dict(r, evidence=sorted(r["evidence"], key=_canonical)) for r in a["rows"]), key=lambda r: r["id"]),
        excluded=sorted(a["excluded"], key=lambda e: e["id"])) for a in data["applications"]), key=lambda a: a["id"])
    result = {k: normalized[k] for k in ("schemaVersion", "checkedAt", "sourceRevision", "sdks")}
    result["inputSha256"] = hashlib.sha256(_canonical(normalized)).hexdigest()
    result["applications"] = [dict(id=a["id"], sdkId=a["sdkId"], platform=a["platform"],
        scopeNotes=a["scopeNotes"], excluded=a["excluded"], categories=_metrics(a["rows"]),
        scopes=[{"scope": scope, "categories": _metrics([r for r in a["rows"] if r["scope"] == scope])}
                for scope in sorted({r["scope"] for r in a["rows"]})]) for a in normalized["applications"]]
    return result


def check_summary(data, actual):
    _require(_canonical(summarize(data)) == _canonical(actual), "Generated summary is stale or has incorrect metrics.")


def _unique(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "Duplicate JSON key.")
        result[key] = value
    return result


def _load(path):
    _require(not Path(path).is_symlink() and not Path(path).name.lower().startswith(".env"), "Unsafe JSON input path.")
    def nonfinite(_):
        raise CoverageError("Nonfinite JSON values are forbidden.")
    return json.loads(Path(path).read_text(), object_pairs_hook=_unique, parse_constant=nonfinite)


def resolve_versions(repo, source_revision, bindings):
    repository, result = _Repo(repo, source_revision), {}
    _require(isinstance(bindings, dict), "Version bindings must be an object.")
    for sdk_id, binding in bindings.items():
        _id(sdk_id)
        _object(binding, {"file"}, {"pointer", "pattern", "identity"})
        _require(("pointer" in binding) != ("pattern" in binding), "Use exactly one version pointer or pattern.")
        _require("identity" not in binding or "pointer" in binding, "Package identity requires a JSON pointer.")
        content = repository.read(binding["file"]).decode()
        if "pointer" in binding:
            value = json.loads(content, object_pairs_hook=_unique)
            if "identity" in binding:
                identity = _text(binding["identity"])
                _require(isinstance(value, dict) and isinstance(value.get("pins"), list),
                         "Package identity requires a Swift package pin array.")
                selected = [pin for pin in value["pins"] if isinstance(pin, dict) and pin.get("identity") == identity]
                _require(len(selected) == 1, "Package identity must match exactly one pin.")
                value = selected[0]
            pointer = _text(binding["pointer"])
            _require(pointer.startswith("/"), "Expected a JSON pointer.")
            try:
                for part in pointer[1:].split("/"):
                    part = part.replace("~1", "/").replace("~0", "~")
                    value = value[int(part)] if isinstance(value, list) else value[part]
            except (KeyError, IndexError, TypeError, ValueError) as error:
                raise CoverageError("Version pointer does not resolve.") from error
        else:
            try:
                pattern = re.compile(_text(binding["pattern"]))
            except re.error as error:
                raise CoverageError("Invalid version binding pattern.") from error
            matches = pattern.findall(content)
            _require(pattern.groups == 1 and len(matches) == 1, "Version pattern must have exactly one capture and one match.")
            value = matches[0]
        result[sdk_id] = _text(value)
    return result


def _sdk_resolver(sources):
    def resolve(package, version, file):
        source = sources.get(package)
        _require(isinstance(source, dict) and source.get("version") == version, "SDK artifact version is unavailable.")
        target = Path(source["root"]).resolve()
        for part in _relative(file).split("/"):
            target = target / part
            _require(not target.is_symlink(), "SDK artifact symlinks are forbidden.")
        _require(target.is_file(), "SDK artifact file is unavailable.")
        return target.read_bytes()
    return resolve


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, epilog="Publication requires --bindings and --inventory. --unit-mode is for fixtures only.")
    for name in ("input", "summary", "repo"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--bindings", help="JSON SDK-ID to tracked manifest file and pointer/pattern bindings")
    parser.add_argument("--inventory", help="JSON application-ID to authoritative available API-ID arrays")
    parser.add_argument("--sdk-sources", help="Optional external package to exact version/root artifact mapping")
    parser.add_argument("--unit-mode", action="store_true", help="Fixture-only bypass for absent bindings/inventory; never publish")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Validate and reject stale/incorrect generated summary")
    mode.add_argument("--write", action="store_true", help="Validate and write deterministic summary JSON")
    args = parser.parse_args(argv)
    try:
        _require(args.unit_mode or (args.bindings and args.inventory), "Publication requires --bindings and --inventory.")
        data = _load(args.input)
        versions = resolve_versions(args.repo, data["sourceRevision"], _load(args.bindings)) if args.bindings else {
            s["id"]: s["version"] for s in data["sdks"]}
        validate(data, args.repo, versions=versions,
            inventory_ids=_load(args.inventory) if args.inventory else None,
            sdk_resolver=_sdk_resolver(_load(args.sdk_sources)) if args.sdk_sources else None)
        if args.check:
            check_summary(data, _load(args.summary))
        else:
            target = Path(args.summary)
            _require(not target.is_symlink() and not target.name.lower().startswith(".env"), "Unsafe summary output path.")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(summarize(data), ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n")
        print("PASS: public API coverage evidence and summary " + ("checked" if args.check else "written") + ".")
    except (CoverageError, OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
