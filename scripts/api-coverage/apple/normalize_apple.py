#!/usr/bin/env python3
"""Regenerate scoped Apple API evidence from pinned public DocC JSON."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.request
from urllib.parse import quote, unquote

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
import coverage_report as report

PACKAGE = "bitmovin-player-ios-core"
VERSION = "3.128.0"
MODULE = "BitmovinPlayerCore"
BASE = "https://cdn.bitmovin.com/player/ios/" + VERSION
REVISION = "69e127da079bee419bfff4b29746126298485f45"
PLATFORMS = {"ios": "iOS", "tvos": "tvOS"}
BASE_EVENTS = ("AdBreakEvent", "AdEvent", "CueEvent", "Event", "OfflineEvent",
               "PlayerEvent", "PlayerViewEvent", "SourceEvent")


def digest(content):
    return hashlib.sha256(content).hexdigest()


def canonical_id(raw):
    prefix = "doc://com.bitmovin.player/documentation/" + MODULE + "/"
    if not raw.startswith(prefix):
        raise report.CoverageError("Unexpected DocC module or symbol ID.")
    return MODULE + "." + raw[len(prefix):].replace("/", ".")


def declarations(doc):
    return [d for s in doc.get("primaryContentSections", []) if s.get("kind") == "declarations"
            for d in s.get("declarations", []) if "swift" in d.get("languages", [])]


def platforms(doc):
    return sorted({p for d in declarations(doc) for p in d.get("platforms", [])})


class DocC:
    def __init__(self, manifest, sdk_root, legacy_cache=None, fetch=False):
        if manifest["package"] != PACKAGE or manifest["version"] != VERSION or manifest["baseUrl"] != BASE:
            raise report.CoverageError("Unexpected SDK package/version/source manifest.")
        self.manifest, self.root = manifest, Path(sdk_root)
        self.legacy, self.fetch = Path(legacy_cache) if legacy_cache else None, fetch
        self.used = set()

    def read(self, file):
        file = quote(file, safe="/()-_.%")
        report._relative(file)
        if file not in self.manifest["files"]:
            raise report.CoverageError("DocC file is absent from the pinned manifest: " + file)
        expected = self.manifest["files"][file]["sha256"]
        target = self.root
        for part in file.split("/"):
            target = target / part
            if target.is_symlink():
                raise report.CoverageError("DocC cache symlinks are forbidden.")
        if target.is_file():
            content = target.read_bytes()
        else:
            path = unquote(file.removeprefix("data").removesuffix(".json"))
            old = self.legacy / ("module.json" if path == "/documentation/bitmovinplayercore"
                else "docc/" + digest(path.encode()) + ".json") if self.legacy else None
            if old and old.is_file():
                content = old.read_bytes()
            elif self.fetch:
                content = urllib.request.urlopen(BASE + "/" + file, timeout=30).read()
            else:
                raise report.CoverageError("Pinned DocC file is unavailable: " + file)
            if digest(content) != expected:
                raise report.CoverageError("Pinned DocC hash mismatch: " + file)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        if digest(content) != expected:
            raise report.CoverageError("Pinned DocC hash mismatch: " + file)
        self.used.add(file)
        return json.loads(content)

    def evidence(self, path):
        file = quote("data" + path + ".json", safe="/()-_.")
        self.read(file)
        return {"kind": "sdk", "package": PACKAGE, "version": VERSION, "file": file,
                "sha256": self.manifest["files"][file]["sha256"]}


def extract_symbols(docc, scope):
    """Build the denominator without consulting any application exposure mapping."""
    module = docc.read("data/documentation/bitmovinplayercore.json")
    owner_refs = {ref["title"]: ref for ref in module["references"].values()
                  if ref.get("kind") == "symbol" and ref.get("url", "").count("/") == 3}
    config, runtime, listeners = (set(scope[k]) for k in ("configOwners", "runtimeOwners", "eventListeners"))
    properties, methods = set(scope["propertySections"]), set(scope["methodSections"])
    symbols, callbacks, generic = {}, defaultdict(list), []
    for owner in sorted(config | runtime | listeners):
        if owner not in owner_refs:
            raise report.CoverageError("Scope owner is absent from the public DocC module: " + owner)
        doc = docc.read("data" + owner_refs[owner]["url"] + ".json")
        for section in doc.get("topicSections", []):
            if section["title"] not in (methods if owner in listeners else methods | properties):
                continue
            for raw in section["identifiers"]:
                ref = doc["references"][raw]
                leaf = docc.read("data" + ref["url"] + ".json")
                if leaf["identifier"]["url"] != raw:
                    raise report.CoverageError("DocC topic and leaf symbol IDs differ.")
                member = canonical_id(raw)
                evidence = docc.evidence(ref["url"])
                deprecated = bool(ref.get("deprecated") or leaf.get("deprecationSummary"))
                available = platforms(leaf)
                if owner in listeners:
                    if ref["title"].startswith("onEvent("):
                        generic.append(member)
                        continue
                    for declaration in declarations(leaf):
                        for token in declaration.get("tokens", []):
                            event = token.get("identifier")
                            if token.get("kind") == "typeIdentifier" and token.get("text", "").endswith("Event") and event:
                                callbacks[event].append({"owner": owner, "rawSymbol": raw,
                                    "platforms": available, "deprecated": deprecated, "evidence": evidence})
                    continue
                if owner in config and section["title"] in properties:
                    category = "observation" if member in scope["readOnlyConfig"] else "configuration"
                elif section["title"] in methods:
                    category = "observation" if member in scope["observationMethods"] else "command"
                else:
                    declaration = "".join(t["text"] for d in declarations(leaf) for t in d.get("tokens", []))
                    category = "command" if re.search(r"\bset\b", declaration) else "observation"
                if member in symbols:
                    raise report.CoverageError("Duplicate public DocC symbol: " + member)
                symbols[member] = {"id": member, "rawSymbol": raw, "category": category,
                    "scope": MODULE + "." + owner, "root": "configuration" if owner in config else "runtime",
                    "platforms": available, "deprecated": deprecated,
                    "availability": leaf.get("metadata", {}).get("platforms", []),
                    "officialReference": BASE + ref["url"], "evidence": [evidence]}
    for raw, records in callbacks.items():
        member = canonical_id(raw)
        owner = raw.split("/")[-1]
        owners = sorted({r["owner"] for r in records})
        evidence = [docc.evidence(owner_refs[owner]["url"])]
        evidence.extend({json.dumps(r["evidence"], sort_keys=True): r["evidence"] for r in records}.values())
        symbols[member] = {"id": member, "rawSymbol": raw, "category": "event",
            "scope": MODULE + "." + "+".join(owners), "root": "events",
            "platforms": sorted({p for r in records for p in r["platforms"]}),
            "deprecated": all(r["deprecated"] for r in records),
            "officialReference": BASE + owner_refs[owner]["url"], "evidence": evidence,
            "callbackSymbols": sorted({r["rawSymbol"] for r in records})}
    return sorted(symbols.values(), key=lambda r: r["id"]), sorted(generic)


def normalize(symbols, exposure, repo, revision, manifest, generic):
    repository = report._Repo(repo, revision)
    applications, inventories = [], {}
    for app_id, platform in PLATFORMS.items():
        available = {s["id"]: s for s in symbols if platform in s["platforms"]}
        mapping = exposure["applications"][app_id]
        if not set(mapping) <= set(available):
            raise report.CoverageError("Exposure mapping references a missing or unavailable SDK symbol.")
        rows = []
        for member, symbol in sorted(available.items()):
            selection = mapping.get(member, {"status": "missing", "evidence": []})
            evidence = list(symbol["evidence"])
            for item in selection["evidence"]:
                evidence.append(dict(item, kind="app", sha256=digest(repository.read(item["file"]))))
            rows.append({k: symbol[k] for k in ("id", "category", "scope", "deprecated", "officialReference")}
                        | {"status": selection["status"], "evidence": evidence})
        excluded = [{"id": s["id"], "reason": "No Swift declaration is available for " + platform + " in pinned DocC."}
                    for s in symbols if platform not in s["platforms"]]
        excluded.extend({"id": member, "reason": "Generic listener callback is a subscription mechanism, not an event identity."}
                        for member in generic)
        excluded.extend({"id": MODULE + "." + name, "reason": "Abstract or base event type; concrete event identities are counted."}
                        for name in BASE_EVENTS)
        excluded.append({"id": MODULE + ".InterstitialTrackingEvent", "reason": "Configuration input record, not an emitted event identity."})
        applications.append({"id": app_id, "sdkId": "apple", "platform": platform,
            "rows": rows, "excluded": sorted(excluded, key=lambda e: e["id"]),
            "scopeNotes": exposure["scopeNotes"] + exposure["platformNotes"][app_id]})
        inventories[app_id] = sorted(available)
    return {"schemaVersion": 1, "checkedAt": "2026-10-20", "sourceRevision": revision,
        "sdks": [{"id": "apple", "name": "Bitmovin Player iOS/tvOS (scoped Core API)", "version": VERSION,
            "channel": "stable", "latestVersion": VERSION, "latestCheckedAt": "2026-10-20", "sources": manifest["sources"]}],
        "applications": applications}, inventories


def write_json(path, value, check=False):
    content = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    if check:
        if not path.is_file() or path.read_text() != content:
            raise report.CoverageError("Generated Apple artifact is stale: " + path.name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Public player-lab worktree; app evidence must match sourceRevision")
    parser.add_argument("--sdk-root", required=True, help="External local directory for package-relative pinned DocC bytes")
    parser.add_argument("--legacy-cache", help="Optional existing module.json and docc/<sha256(path)>.json cache")
    parser.add_argument("--fetch", action="store_true", help="Download absent pinned public DocC files; verify every hash")
    parser.add_argument("--source-revision", default=REVISION)
    parser.add_argument("--output", default=str(HERE))
    parser.add_argument("--check", action="store_true", help="Reject drift in generated files without rewriting them")
    args = parser.parse_args(argv)
    try:
        manifest, scope, exposure = (report._load(HERE / name) for name in ("docc-manifest.json", "scope.json", "exposure.json"))
        docc = DocC(manifest, args.sdk_root, args.legacy_cache, args.fetch)
        symbols, generic = extract_symbols(docc, scope)
        data, inventory = normalize(symbols, exposure, args.repo, args.source_revision, manifest, generic)
        bindings = report._load(HERE / "bindings.json")
        versions = report.resolve_versions(args.repo, args.source_revision, bindings)
        report.validate(data, args.repo, versions=versions, inventory_ids=inventory,
            sdk_resolver=report._sdk_resolver({PACKAGE: {"version": VERSION, "root": args.sdk_root}}))
        for name, value in (("sdk-symbols.json", symbols), ("inventory.json", inventory),
                            ("coverage.json", data), ("summary.json", report.summarize(data))):
            write_json(Path(args.output) / name, value, args.check)
        print("PASS: Apple DocC symbols, independent inventory, app evidence and category summary "
              + ("checked" if args.check else "written") + ".")
    except (report.CoverageError, OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
