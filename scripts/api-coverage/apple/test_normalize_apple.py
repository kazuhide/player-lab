"""Behavioral checks for the pinned DocC adapter and reviewed GUI classification."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import normalize_apple as apple


PREFIX = "doc://com.bitmovin.player/documentation/BitmovinPlayerCore/"


class FixtureDocC:
    def __init__(self):
        self.docs, self.owners = {}, {}

    def owner(self, name):
        path = "/documentation/bitmovinplayercore/" + name.lower()
        self.owners[name] = {"title": name, "kind": "symbol", "url": path}
        self.docs["data" + path + ".json"] = {"topicSections": [], "references": {}}

    def member(self, owner, name, section, *, platforms=("iOS", "tvOS"), setter=False,
               deprecated=False, event=None):
        raw = PREFIX + owner + "/" + name
        path = "/documentation/bitmovinplayercore/" + owner.lower() + "/" + name.lower()
        doc = self.docs["data" + self.owners[owner]["url"] + ".json"]
        doc["topicSections"].append({"title": section, "identifiers": [raw]})
        doc["references"][raw] = {"title": name, "url": path, "deprecated": deprecated}
        tokens = [{"text": "var value { get set }" if setter else "var value { get }", "kind": "text"}]
        if event:
            tokens.append({"kind": "typeIdentifier", "text": event, "identifier": PREFIX + event})
        self.docs["data" + path + ".json"] = {"identifier": {"url": raw},
            "primaryContentSections": [{"kind": "declarations", "declarations": [
                {"languages": ["swift"], "platforms": list(platforms), "tokens": tokens}]}]}

    def read(self, file):
        if file == "data/documentation/bitmovinplayercore.json":
            return {"references": {name: ref for name, ref in self.owners.items()}}
        return self.docs[file]

    def evidence(self, path):
        return {"kind": "sdk", "package": apple.PACKAGE, "version": apple.VERSION,
                "file": "docc/fixture.json", "sha256": "0" * 64}


class AppleAdapterTests(unittest.TestCase):
    def fixture(self):
        docc = FixtureDocC()
        for owner in ("Player", "PlaybackConfig", "PlayerListener", "SourceListener", "PlayedEvent"):
            docc.owner(owner)
        docc.member("Player", "timeShift", "Instance Properties", setter=True)
        docc.member("Player", "duration", "Instance Properties")
        docc.member("Player", "load(sourceConfig:)", "Instance Methods")
        docc.member("Player", "load(source:)", "Instance Methods")
        docc.member("PlaybackConfig", "isMuted", "Instance Properties", platforms=("iOS",), deprecated=True)
        docc.member("PlaybackConfig", "init()", "Initializers")
        docc.member("PlayerListener", "onPlayed(_:player:)", "Instance Methods", event="PlayedEvent")
        docc.member("SourceListener", "onPlayed(_:source:)", "Instance Methods", platforms=("tvOS",),
                    deprecated=True, event="PlayedEvent")
        docc.member("PlayerListener", "onEvent(_:player:)", "Instance Methods", event="Event")
        scope = {"configOwners": ["PlaybackConfig"], "runtimeOwners": ["Player"],
            "eventListeners": ["PlayerListener", "SourceListener"], "propertySections": ["Instance Properties"],
            "methodSections": ["Instance Methods"], "readOnlyConfig": [], "observationMethods": []}
        return docc, scope

    def test_raw_identity_preserves_overloads_and_rejects_other_modules(self):
        self.assertEqual(apple.canonical_id(PREFIX + "PlayerEventsApi/on(_:)-141fj"),
                         "BitmovinPlayerCore.PlayerEventsApi.on(_:)-141fj")
        with self.assertRaises(apple.report.CoverageError):
            apple.canonical_id("doc://unrelated/documentation/Other/foo")

    def test_extracts_platforms_deprecations_setters_and_individual_events(self):
        docc, scope = self.fixture()
        symbols, generic = apple.extract_symbols(docc, scope)
        by_id = {s["id"]: s for s in symbols}
        self.assertEqual(len(symbols), 6)
        self.assertEqual(by_id["BitmovinPlayerCore.Player.timeShift"]["category"], "command")
        self.assertEqual(by_id["BitmovinPlayerCore.Player.duration"]["category"], "observation")
        muted = by_id["BitmovinPlayerCore.PlaybackConfig.isMuted"]
        self.assertEqual(muted["platforms"], ["iOS"])
        self.assertTrue(muted["deprecated"])
        event = by_id["BitmovinPlayerCore.PlayedEvent"]
        self.assertEqual(event["platforms"], ["iOS", "tvOS"])
        self.assertFalse(event["deprecated"])
        self.assertEqual(len(event["callbackSymbols"]), 2)
        self.assertEqual(generic, ["BitmovinPlayerCore.PlayerListener.onEvent(_:player:)"])
        self.assertNotIn("BitmovinPlayerCore.PlaybackConfig.init()", by_id)

    def test_scope_owner_must_exist_in_official_metadata(self):
        docc, scope = self.fixture()
        scope["runtimeOwners"].append("InventedApi")
        with self.assertRaisesRegex(apple.report.CoverageError, "absent from the public DocC"):
            apple.extract_symbols(docc, scope)

    def test_unknown_exposure_cannot_create_sdk_member(self):
        docc, scope = self.fixture()
        symbols, generic = apple.extract_symbols(docc, scope)
        exposure = {"applications": {"ios": {"InventedApi.value": {"status": "direct", "evidence": []}}, "tvos": {}},
                    "scopeNotes": [], "platformNotes": {"ios": [], "tvos": []}}
        with patch.object(apple.report, "_Repo"):
            with self.assertRaisesRegex(apple.report.CoverageError, "missing or unavailable"):
                apple.normalize(symbols, exposure, ".", apple.REVISION, {"sources": []}, generic)

    def test_sparse_mapping_does_not_reduce_independent_inventory(self):
        docc, scope = self.fixture()
        symbols, generic = apple.extract_symbols(docc, scope)
        exposure = {"applications": {"ios": {}, "tvos": {}}, "scopeNotes": [],
                    "platformNotes": {"ios": [], "tvos": []}}
        with patch.object(apple.report, "_Repo"):
            data, inventory = apple.normalize(symbols, exposure, ".", apple.REVISION, {"sources": []}, generic)
        self.assertEqual(len(inventory["ios"]), 6)
        self.assertEqual(len(inventory["tvos"]), 5)
        self.assertTrue(all(r["status"] == "missing" for a in data["applications"] for r in a["rows"]))

    def test_pinned_cache_uses_checksum_records_and_rejects_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            file = "data/documentation/bitmovinplayercore.json"
            target = Path(directory) / file
            target.parent.mkdir(parents=True)
            target.write_bytes(b"{}")
            manifest = {"package": apple.PACKAGE, "version": apple.VERSION, "baseUrl": apple.BASE,
                        "files": {file: {"sha256": hashlib.sha256(b"{}").hexdigest()}}}
            docc = apple.DocC(manifest, directory)
            self.assertEqual(docc.read(file), {})
            self.assertEqual(docc.evidence("/documentation/bitmovinplayercore")["sha256"],
                             manifest["files"][file]["sha256"])
            manifest["files"][file]["sha256"] = hashlib.sha256(b"different").hexdigest()
            with self.assertRaisesRegex(apple.report.CoverageError, "hash mismatch"):
                docc.read(file)

    def test_reviewed_leaf_editors_do_not_credit_config_containers_or_other_load_overloads(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        editable = {"SourceConfig.url", "SourceConfig.type", "SourceConfig.title", "SourceConfig.posterSource",
                    "SourceOptions.startOffset", "SourceOptions.startOffsetTimelineReference",
                    "PlaybackConfig.isAutoplayEnabled", "PlaybackConfig.isMuted", "PlaybackConfig.isTimeShiftEnabled",
                    "AdaptationConfig.maxSelectableBitrate", "BufferMediaTypeConfig.forwardDuration",
                    "StyleConfig.scalingMode"}
        containers = {"SourceConfig.options", "BufferConfig.audioAndVideo", "PlayerConfig.playbackConfig",
                      "PlayerConfig.adaptationConfig", "PlayerConfig.bufferConfig", "PlayerConfig.styleConfig"}
        for app, mapping in exposure["applications"].items():
            direct = {member.removeprefix("BitmovinPlayerCore.") for member, row in mapping.items()
                      if row["status"] == "direct" and not member.startswith("BitmovinPlayerCore.Player.")}
            self.assertEqual(direct, editable)
            self.assertEqual(mapping["BitmovinPlayerCore.Player.load(source:)"]["status"], "direct")
            self.assertNotIn("BitmovinPlayerCore.Player.load(sourceConfig:)", mapping)
            for member in containers | {"PlayerConfig.key"}:
                self.assertEqual(mapping["BitmovinPlayerCore." + member]["status"], "code-only")
            self.assertEqual(mapping["BitmovinPlayerCore.Player.timeShift"]["status"], "preset")
            self.assertFalse(any(member.startswith("BitmovinPlayerCore.Player.load(")
                                 and member != "BitmovinPlayerCore.Player.load(source:)" for member in mapping))
            for member in editable:
                evidence = mapping["BitmovinPlayerCore." + member]["evidence"]
                self.assertTrue(any(item["file"].endswith("ConfigurationEditor.swift") for item in evidence))
                self.assertTrue(any(item["file"].endswith("Configuration.swift") for item in evidence))
            scaling = mapping["BitmovinPlayerCore.StyleConfig.scalingMode"]["evidence"]
            self.assertTrue(any(item["file"].endswith("ConfigurationCode.swift") for item in scaling))
            self.assertTrue(any(item["symbol"] == "SourceFactory.createSource(from: sourceSettings.makeSourceConfig())"
                                for item in mapping["BitmovinPlayerCore.Player.load(source:)"]["evidence"]))
        self.assertEqual(exposure["applications"]["ios"]["BitmovinPlayerCore.TimeChangedEvent"]["eventExposure"], "monitored")
        self.assertNotIn("BitmovinPlayerCore.StyleConfig.playerUiJs", exposure["applications"]["tvos"])

    def test_current_load_route_leaves_the_config_overload_in_the_independent_denominator(self):
        docc, scope = self.fixture()
        symbols, generic = apple.extract_symbols(docc, scope)
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        member = "BitmovinPlayerCore.Player.load(source:)"
        exposure["applications"] = {app: {member: mapping[member]}
                                    for app, mapping in exposure["applications"].items()}
        with patch.object(apple.report, "_Repo") as repository:
            repository.return_value.read.return_value = b"fixture source bytes"
            data, inventory = apple.normalize(symbols, exposure, ".", apple.REVISION, {"sources": []}, generic)
        for app in data["applications"]:
            rows = {row["id"]: row for row in app["rows"]}
            self.assertEqual(rows[member]["status"], "direct")
            self.assertEqual(rows["BitmovinPlayerCore.Player.load(sourceConfig:)"]["status"], "missing")
            self.assertIn("BitmovinPlayerCore.Player.load(sourceConfig:)", inventory[app["id"]])

    def test_initial_track_preferences_credit_runtime_consumers_without_inventing_config_fields(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        for app, mapping in exposure["applications"].items():
            for member in ["Player.audio", "Player.subtitle", "Player.availableAudio", "Player.availableSubtitles",
                           "Player.currentTime", "ReadyEvent", "AudioChangedEvent", "SubtitleChangedEvent"]:
                self.assertEqual(mapping["BitmovinPlayerCore." + member]["status"], "observed")
            self.assertEqual(mapping["BitmovinPlayerCore.Player.setSubtitle(trackIdentifier:)"]["status"], "preset")
            self.assertEqual(mapping["BitmovinPlayerCore.Player.setAudio(trackIdentifier:)"]["status"],
                             "direct" if app == "ios" else "preset")
            self.assertFalse(any("Language" in member and ".PlaybackConfig." in member for member in mapping))

    def test_reviewed_source_bindings_point_to_the_current_application_symbols(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        repository = apple.HERE.parents[2]
        for app, mapping in exposure["applications"].items():
            for member, row in mapping.items():
                for evidence in row["evidence"]:
                    with self.subTest(app=app, member=member, evidence=evidence):
                        lines = (repository / evidence["file"]).read_text().splitlines()
                        self.assertGreater(evidence["line"], 0)
                        self.assertLessEqual(evidence["line"], len(lines))
                        self.assertIn(evidence["symbol"], lines[evidence["line"] - 1])


if __name__ == "__main__":
    unittest.main()
