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

    def test_reviewed_leaf_editors_and_typed_parent_consumers_remain_direct(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        editable = {"SourceConfig.url", "SourceConfig.type", "SourceConfig.title", "SourceConfig.posterSource",
                    "SourceOptions.startOffset", "SourceOptions.startOffsetTimelineReference",
                    "PlaybackConfig.isAutoplayEnabled", "PlaybackConfig.isMuted", "PlaybackConfig.isTimeShiftEnabled",
                    "AdaptationConfig.maxSelectableBitrate", "BufferMediaTypeConfig.forwardDuration",
                    "StyleConfig.scalingMode"}
        containers = {"SourceConfig.options", "BufferConfig.audioAndVideo", "PlayerConfig.playbackConfig",
                      "PlayerConfig.adaptationConfig", "PlayerConfig.bufferConfig", "PlayerConfig.styleConfig"}
        for app, mapping in exposure["applications"].items():
            for member in editable | containers | {"PlayerConfig.key", "Player.timeShift"}:
                with self.subTest(app=app, member=member):
                    self.assertEqual(mapping["BitmovinPlayerCore." + member]["status"], "direct")
            for member in editable:
                evidence = mapping["BitmovinPlayerCore." + member]["evidence"]
                self.assertTrue(any(item["file"].endswith("ConfigurationEditor.swift") for item in evidence))
                self.assertTrue(any(item["file"].endswith("Configuration.swift") for item in evidence))
            for member in containers:
                evidence = mapping["BitmovinPlayerCore." + member]["evidence"]
                self.assertTrue(any(" =" in item["symbol"] for item in evidence),
                                "A parent needs an actual editable child assignment, not merely construction")
            for overload in ["source:", "sourceConfig:", "playlistConfig:"]:
                row = mapping["BitmovinPlayerCore.Player.load(" + overload + ")"]
                self.assertEqual(row["status"], "direct")
                self.assertTrue(any("player.load(" + overload in item["symbol"] for item in row["evidence"]))
        repository = apple.HERE.parents[2]
        player_model = (repository / "apps/ios/Showcase/PlayerModel.swift").read_text()
        self.assertIn("SourceFactory.createSource(from: sourceSettings.makeSourceConfig(callbackJournal:", player_model)
        scaling_code = (repository / "apps/ios/Showcase/ConfigurationCode.swift").read_text()
        self.assertIn("playerConfig.styleConfig.scalingMode =", scaling_code)
        operations = (repository / "apps/ios/Showcase/ApiOperations.swift").read_text()
        self.assertIn("case .timeShift: player.timeShift = Double(value)!", operations)
        self.assertEqual(exposure["applications"]["ios"]["BitmovinPlayerCore.TimeChangedEvent"]["status"], "observed")
        self.assertNotIn("BitmovinPlayerCore.StyleConfig.playerUiJs", exposure["applications"]["tvos"])

    def test_reviewed_exposure_preserves_all_current_report_rows_and_notes(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        repository = apple.HERE.parents[2]
        reviewed = json.loads((repository / "docs/api-coverage/coverage.json").read_text())
        inventory = json.loads((repository / "docs/api-coverage/inventory.json").read_text())
        for application in reviewed["applications"]:
            app = application["id"]
            if app not in apple.PLATFORMS:
                continue
            mapping = exposure["applications"][app]
            self.assertEqual(set(mapping), set(inventory[app]))
            self.assertEqual(len(mapping), 562 if app == "ios" else 457)
            expected = {row["id"]: {"status": row["status"], "evidence": [
                {key: item[key] for key in ("file", "line", "symbol")} for item in row["evidence"]
                if item["kind"] == "app"]} for row in application["rows"]}
            self.assertEqual(mapping, expected)
            self.assertEqual(exposure["scopeNotes"] + exposure["platformNotes"][app], application["scopeNotes"])
        self.assertEqual(apple.REVISION, reviewed["sourceRevision"])

    def test_regeneration_retains_reviewed_apple_coverage_from_independent_sdk_symbols(self):
        repository = apple.HERE.parents[2]
        symbols = json.loads((repository / "docs/api-coverage/apple/sdk-symbols.json").read_text())
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        reviewed = json.loads((repository / "docs/api-coverage/coverage.json").read_text())
        independent_inventory = json.loads((repository / "docs/api-coverage/inventory.json").read_text())
        with patch.object(apple.report, "_Repo") as source:
            source.return_value.read.side_effect = lambda file: (repository / file).read_bytes()
            generated, inventory = apple.normalize(symbols, exposure, repository, apple.REVISION,
                                                   {"sources": []}, [])
        for application in generated["applications"]:
            app = application["id"]
            self.assertEqual(inventory[app], independent_inventory[app])
            expected = next(item for item in reviewed["applications"] if item["id"] == app)
            self.assertEqual({row["id"]: row["status"] for row in application["rows"]},
                             {row["id"]: row["status"] for row in expected["rows"]})
            self.assertEqual(application["scopeNotes"], expected["scopeNotes"])

    def test_os_constraints_do_not_credit_unavailable_children_or_system_callbacks(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        ios, tvos = (exposure["applications"][app] for app in ("ios", "tvos"))
        for member in ["AdvertisingConfig.ima", "PlayerViewConfig.tweaksConfig",
                       "BitmovinUserInterfaceMetadata.title", "BitmovinUserInterfaceMetadata.sourceDescription"]:
            self.assertEqual(ios["BitmovinPlayerCore." + member]["status"], "direct")
            self.assertEqual(tvos["BitmovinPlayerCore." + member]["status"], "missing")
        for member in ["AdvertisingConfig.ima", "BitmovinUserInterfaceMetadata.title",
                       "BitmovinUserInterfaceMetadata.sourceDescription"]:
            self.assertEqual(tvos["BitmovinPlayerCore." + member]["evidence"], [])
        self.assertNotIn("BitmovinPlayerCore.PlayerConfig.remoteControlConfig", tvos)
        self.assertEqual(ios["BitmovinPlayerCore.OfflineManager.add(completionHandler:for:)"]["status"], "code-only")
        self.assertNotIn("BitmovinPlayerCore.OfflineManager.add(completionHandler:for:)", tvos)
        for mapping in (ios, tvos):
            for member in ["AdBreakConfig.identifier", "AdBreakConfig.position", "AdBreakConfig.skippableAfter",
                           "AdConfig.replaceContentDuration", "AdTagConfig.tag", "AdTagConfig.fallbackTags"]:
                self.assertEqual(mapping["BitmovinPlayerCore." + member]["status"], "missing")

    def test_native_command_evidence_invokes_the_actual_request_and_correct_event_overloads(self):
        exposure = json.loads((apple.HERE / "exposure.json").read_text())
        for app, mapping in exposure["applications"].items():
            setters = {
                "Player.allowsAirPlay": "case .allowsAirPlay: player.allowsAirPlay =",
                "Player.maxSelectableBitrate": "case .bitrate: player.maxSelectableBitrate =",
                "Player.playbackSpeed": "player.playbackSpeed = speed",
                "Player.timeShift": "case .timeShift: player.timeShift =",
                "Player.volume": "case .volume: player.volume =",
                "SourceLatencyApi.automaticallyPreservesLatency": "source.latency.automaticallyPreservesLatency =",
                "UserInterfaceApi.scalingMode": "try requireApiView().scalingMode =",
            }
            for member, assignment in setters.items():
                row = mapping["BitmovinPlayerCore." + member]
                self.assertEqual(row["status"], "direct")
                self.assertTrue(any(item["file"].endswith("ApiOperations.swift") and assignment in item["symbol"]
                                    for item in row["evidence"]), "A state getter cannot replace the editable setter")
            renewal = mapping["BitmovinPlayerCore.SourceDrmFairplayApi.renewExpiringLicense(for:)"]
            self.assertEqual(renewal["status"], "direct")
            self.assertTrue(any(item["symbol"].startswith("source.drm.fairplay.renewExpiringLicense(for: apiObjects.acquiredLicenses[index].request)")
                                for item in renewal["evidence"]), "An exported string cannot stand in for native request renewal")
            for suffix, event in [("141fj", "SourceLoadedEvent"), ("1mxxx", "AdBreakFinishedEvent")]:
                row = mapping["BitmovinPlayerCore.PlayerEventsApi.on(_:)-" + suffix]
                self.assertEqual(row["status"], "direct")
                self.assertTrue(any("subscriptions.append(player.events.on(" + event + ".self).sink"
                                    in item["symbol"] for item in row["evidence"]))

    def test_sparse_selected_load_route_keeps_other_sdk_overload_in_inventory(self):
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
            self.assertEqual(mapping["BitmovinPlayerCore.Player.setSubtitle(trackIdentifier:)"]["status"], "direct")
            self.assertEqual(mapping["BitmovinPlayerCore.Player.setAudio(trackIdentifier:)"]["status"], "direct")
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
