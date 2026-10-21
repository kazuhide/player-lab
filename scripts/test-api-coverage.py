"""Behavioral coverage for the portable publication boundary and counts."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from coverage_report import CoverageError, check_summary, resolve_versions, summarize, validate


class CoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.repo = Path(cls.directory.name) / "repo"
        cls.repo.mkdir()
        (cls.repo / "app").mkdir()
        cls.source = b"# Public fixture\nplayer.play()\n"
        (cls.repo / "app/player.py").write_bytes(cls.source)
        (cls.repo / "package.json").write_text('{"dependencies":{"bitmovin-player":"8.280.0"}}\n')
        (cls.repo / "Package.resolved").write_text('{"pins":[{"state":{"version":"3.128.0"}}]}\n')
        (cls.repo / "build.gradle.kts").write_text('val playerVersion = "3.171.0"\n')
        cls.git("init", "-q")
        cls.git("add", ".")
        cls.git("-c", "user.name=Coverage Fixture", "-c", "user.email=fixture@example.invalid",
                "commit", "-q", "-m", "Public coverage fixture")
        cls.revision = cls.git("rev-parse", "HEAD").strip()

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    @classmethod
    def git(cls, *args):
        return subprocess.check_output(["git", "-C", str(cls.repo), *args], text=True)

    def setUp(self):
        self.data = {"schemaVersion": 1, "checkedAt": "2026-10-20", "sourceRevision": self.revision,
            "sdks": [{"id": "web", "name": "Bitmovin Web", "version": "8.280.0", "channel": "stable",
                "latestVersion": "8.280.0", "latestCheckedAt": "2026-10-20",
                "sources": [{"url": "https://registry.npmjs.org/bitmovin-player"}]}],
            "applications": [{"id": "web-app", "sdkId": "web", "platform": "browser", "rows": [],
                "excluded": [{"id": "Player.nativeOnly", "reason": "Unavailable in this platform."}],
                "scopeNotes": ["Static app-owned GUI evidence only."]}]}
        self.versions = {"web": "8.280.0"}
        self.rows = self.data["applications"][0]["rows"]
        for name, category, status in [("auto", "configuration", "direct"),
                ("ui", "configuration", "preset"), ("read", "configuration", "observed"),
                ("play", "command", "missing"), ("time", "observation", "observed"),
                ("PlayingEvent", "event", "observed")]:
            self.rows.append({"id": "Player." + name, "category": category, "scope": "Player",
                "deprecated": name == "read", "status": status,
                "officialReference": "https://cdn.bitmovin.com/player/web/8/docs/interfaces/Core.PlayerAPI.html",
                "evidence": [] if status == "missing" else [{"kind": "app", "file": "app/player.py",
                    "sha256": hashlib.sha256(self.source).hexdigest(), "line": 2, "symbol": "player.play()"}]})

    def inventory(self):
        return {"web-app": sorted(row["id"] for row in self.rows)}

    def valid(self, **kwargs):
        validate(self.data, self.repo, versions=self.versions, inventory_ids=self.inventory(), **kwargs)

    def test_direct_and_presets_stay_separate_and_observed_never_earns_config_credit(self):
        self.valid()
        metric = summarize(self.data)["applications"][0]["categories"]["configuration"]
        self.assertEqual(metric["denominator"], 3)
        self.assertEqual(metric["percentDirect"], 33.33)
        self.assertEqual(metric["percentDirectOrPreset"], 66.67)
        self.assertEqual(metric["byStatus"]["observed"], 1)
        self.assertEqual(metric["deprecated"], 1)

    def test_report_is_deterministic_without_combining_categories(self):
        first = summarize(self.data)
        self.rows.reverse()
        self.assertEqual(first, summarize(self.data))
        self.assertNotIn("percentDirect", first["applications"][0])
        self.assertEqual(first["applications"][0]["excluded"], self.data["applications"][0]["excluded"])

    def test_zero_denominators_are_explicit_nulls_and_finite_json(self):
        self.rows.clear()
        self.valid()
        app = summarize(self.data)["applications"][0]
        for metric in app["categories"].values():
            self.assertEqual(metric["denominator"], 0)
            self.assertIsNone(metric["percentDirect"])
            self.assertIsNone(metric["percentDirectOrPreset"])
        json.dumps(app, allow_nan=False)

    def test_duplicate_api_id_is_rejected(self):
        self.rows.append(copy.deepcopy(self.rows[0]))
        with self.assertRaises(CoverageError):
            self.valid()

    def test_authoritative_inventory_rejects_missing_or_fake_member(self):
        expected = self.inventory()
        expected["web-app"].append("Player.missingMapping")
        with self.assertRaises(CoverageError):
            validate(self.data, self.repo, versions=self.versions, inventory_ids=expected)
        self.rows[0]["id"] = "Player.fakeMember"
        with self.assertRaises(CoverageError):
            validate(self.data, self.repo, versions=self.versions, inventory_ids=expected)

    def test_duplicate_sdk_or_application_ids_are_rejected(self):
        for key in ("sdks", "applications"):
            changed = copy.deepcopy(self.data)
            changed[key].append(copy.deepcopy(changed[key][0]))
            with self.subTest(key=key), self.assertRaises(CoverageError):
                validate(changed, self.repo, versions=self.versions)

    def test_invalid_sdk_category_and_status_are_rejected(self):
        for target, key, value in [(self.data["applications"][0], "sdkId", "unknown"),
                (self.rows[0], "category", "invented"), (self.rows[0], "status", "100-percent")]:
            original = target[key]
            target[key] = value
            with self.subTest(key=key), self.assertRaises(CoverageError):
                self.valid()
            target[key] = original

    def test_every_exposure_and_code_use_status_requires_app_evidence(self):
        for status in ("direct", "preset", "observed", "internal", "code-only", "sdk-ui-unverified"):
            self.rows[0]["status"] = status
            self.rows[0]["evidence"] = []
            with self.subTest(status=status), self.assertRaises(CoverageError):
                self.valid()

    def test_unsafe_or_secret_evidence_paths_are_rejected(self):
        for path in ("/etc/passwd", "../player.py", "app/../player.py", "app\\player.py",
                ".env", "apps/web/.env.local", "apps/ios/Local.xcconfig", ".git/config"):
            self.rows[0]["evidence"][0]["file"] = path
            with self.subTest(path=path), self.assertRaises(CoverageError):
                self.valid()

    def test_untracked_evidence_file_is_rejected(self):
        self.rows[0]["evidence"][0]["file"] = "untracked.py"
        (self.repo / "untracked.py").write_bytes(self.source)
        try:
            with self.assertRaises(CoverageError):
                self.valid()
        finally:
            (self.repo / "untracked.py").unlink()

    def test_symlink_component_is_rejected(self):
        link = self.repo / "link"
        link.symlink_to(self.repo / "app", target_is_directory=True)
        self.rows[0]["evidence"][0]["file"] = "link/player.py"
        try:
            with self.assertRaises(CoverageError):
                self.valid()
        finally:
            link.unlink()

    def test_stale_current_file_hash_is_rejected(self):
        file = self.repo / "app/player.py"
        file.write_bytes(self.source + b"player.pause()\n")
        try:
            with self.assertRaises(CoverageError):
                self.valid()
        finally:
            file.write_bytes(self.source)

    def test_new_hash_cannot_claim_an_old_source_revision(self):
        file = self.repo / "app/player.py"
        changed = self.source + b"player.pause()\n"
        file.write_bytes(changed)
        self.rows[0]["evidence"][0]["sha256"] = hashlib.sha256(changed).hexdigest()
        try:
            with self.assertRaises(CoverageError):
                self.valid()
        finally:
            file.write_bytes(self.source)

    def test_stale_dependency_version_is_rejected(self):
        self.versions["web"] = "8.281.0"
        with self.assertRaises(CoverageError):
            self.valid()

    def test_version_bindings_support_json_pointers_locks_and_one_regex_capture(self):
        result = resolve_versions(self.repo, self.revision, {
            "web": {"file": "package.json", "pointer": "/dependencies/bitmovin-player"},
            "apple": {"file": "Package.resolved", "pointer": "/pins/0/state/version"},
            "android": {"file": "build.gradle.kts", "pattern": 'playerVersion = "([^"]+)"'}})
        self.assertEqual(result, {"web": "8.280.0", "apple": "3.128.0", "android": "3.171.0"})

    def test_ambiguous_version_binding_is_rejected(self):
        with self.assertRaises(CoverageError):
            resolve_versions(self.repo, self.revision,
                {"web": {"file": "package.json", "pattern": "(.)"}})

    def test_malformed_binding_regex_has_a_consistent_public_error(self):
        with self.assertRaises(CoverageError):
            resolve_versions(self.repo, self.revision,
                {"web": {"file": "package.json", "pattern": "("}})

    def test_nonobject_inventory_has_a_consistent_public_error(self):
        with self.assertRaises(CoverageError):
            validate(self.data, self.repo, versions=self.versions, inventory_ids=[])

    def test_sdk_evidence_version_and_optional_resolved_bytes_are_checked(self):
        sdk = {"kind": "sdk", "package": "bitmovin-player", "version": "8.280.0",
            "file": "types/index.d.ts", "sha256": hashlib.sha256(b"public SDK").hexdigest()}
        self.rows[0]["evidence"].append(sdk)
        self.valid(sdk_resolver=lambda package, version, file: b"public SDK")
        with self.assertRaises(CoverageError):
            self.valid(sdk_resolver=lambda package, version, file: b"different version bytes")
        sdk["version"] = "9.0.0"
        with self.assertRaises(CoverageError):
            self.valid()

    def test_unofficial_or_traversing_reference_is_rejected(self):
        for url in ("http://cdn.bitmovin.com/player/web/8/docs/", "https://example.org/docs",
                "https://github.com/attacker/player-ios", "https://github.com/bitmovin/player-ios/../../attacker",
                "https://github.com/bitmovin/player-ios/%2e%2e/attacker",
                "https://github.com/bitmovin/player-ios/%252e%252e/attacker",
                "https://github.com/bitmovin/player-ios/tree/main/..\\..\\attacker",
                "https://cdn.bitmovin.com.evil.test/player/"):
            self.rows[0]["officialReference"] = url
            with self.subTest(url=url), self.assertRaises(CoverageError):
                self.valid()

    def test_edited_or_stale_summary_is_rejected(self):
        report = summarize(self.data)
        check_summary(self.data, report)
        report["applications"][0]["categories"]["configuration"]["percentDirect"] = 100
        with self.assertRaises(CoverageError):
            check_summary(self.data, report)
        old = summarize(self.data)
        self.data["sdks"][0]["latestCheckedAt"] = "2026-10-19"
        with self.assertRaises(CoverageError):
            check_summary(self.data, old)

    def test_nonfinite_metrics_and_invented_zero_percentages_are_rejected(self):
        self.rows.clear()
        for wrong in (0, float("nan"), float("inf")):
            report = summarize(self.data)
            report["applications"][0]["categories"]["configuration"]["percentDirect"] = wrong
            with self.subTest(wrong=wrong), self.assertRaises(CoverageError):
                check_summary(self.data, report)

    def test_positive_integer_line_and_real_dates_are_required(self):
        for line in (0, -1, True, float("nan"), 500):
            self.rows[0]["evidence"][0]["line"] = line
            with self.subTest(line=line), self.assertRaises(CoverageError):
                self.valid()
        self.data["checkedAt"] = "2026-02-30"
        with self.assertRaises(CoverageError):
            self.valid()

    def test_cli_requires_publication_guards_and_detects_summary_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in {"input": self.data, "inventory": self.inventory(),
                    "bindings": {"web": {"file": "package.json", "pointer": "/dependencies/bitmovin-player"}}}.items():
                (root / (name + ".json")).write_text(json.dumps(value))
            command = [sys.executable, str(Path(__file__).with_name("coverage_report.py")),
                "--repo", str(self.repo), "--input", str(root / "input.json"), "--summary", str(root / "summary.json")]
            failed = subprocess.run(command + ["--check"], capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            guarded = command + ["--bindings", str(root / "bindings.json"), "--inventory", str(root / "inventory.json")]
            self.assertEqual(subprocess.run(guarded + ["--write"], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(guarded + ["--check"], capture_output=True).returncode, 0)
            (root / "summary.json").write_text("{}")
            self.assertNotEqual(subprocess.run(guarded + ["--check"], capture_output=True).returncode, 0)


class NativeSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util

        path = Path(__file__).with_name("check-api-coverage.py")
        spec = importlib.util.spec_from_file_location("native_snapshot_check", path)
        cls.checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.checker)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.directory = self.repo / "docs/api-coverage"
        package = "bitmovin-player-ios-core"
        apple_base = "https://cdn.bitmovin.com/player/ios/3.128.0"
        android_base = "https://cdn.bitmovin.com/player/android/3.171.0/docs/"
        # Two public Apple declarations cover shared and iOS-only availability.
        apple = []
        for owner, member, platforms, deprecated, file, digest in [
                ("Player", "play()", ["iOS", "tvOS"], False,
                 "player/play().json", "fc4bf58be19e5f1ba99bfb6761bbf2a0ac87dca394d9f696cca0e65bc22bfeec"),
                ("BitmovinCastManager", "initializeCasting(applicationId:)", ["iOS"], True,
                 "bitmovincastmanager/initializecasting(applicationid%3A).json",
                 "2626de18bbea12136fd5aca89cf4f5e8c3a6c9c09c999b20e7b9a4e584320114")]:
            apple.append({"id": "BitmovinPlayerCore." + owner + "." + member,
                "category": "command", "scope": "BitmovinPlayerCore." + owner,
                "deprecated": deprecated, "platforms": platforms,
                "officialReference": apple_base + "/documentation/bitmovinplayercore/"
                    + owner.lower() + "/" + member.lower(),
                "evidence": [{"kind": "sdk", "package": package, "version": "3.128.0",
                    "file": "data/documentation/bitmovinplayercore/" + file, "sha256": digest}]})
        android = {"sdkId": "android", "version": "3.171.0", "rows": [
            {"id": "android:com.bitmovin.player.api.Player." + member + "()",
             "category": "command", "scope": "runtime_playback", "deprecated": False,
             "officialReference": android_base + "player-core/com.bitmovin.player.api/-player/"
                 + member + ".html"} for member in ("play", "pause")]}
        self.snapshots = {
            "apple/sdk-symbols.json": apple,
            "android/sdk-symbols.json": android,
            "android/sources.json": {"sdkId": "android", "version": "3.171.0",
                "officialDokkaBase": android_base},
            "manifest": {"package": package, "version": "3.128.0", "baseUrl": apple_base,
                "files": {row["evidence"][0]["file"]: {"sha256": row["evidence"][0]["sha256"]} for row in apple}}}
        self.data = {"sdks": [{"id": "apple", "version": "3.128.0"},
                              {"id": "android", "version": "3.171.0"}], "applications": []}
        for app_id, sdk_id, platform, symbols in [
                ("ios", "apple", "iOS", [row for row in apple if "iOS" in row["platforms"]]),
                ("tvos", "apple", "tvOS", [row for row in apple if "tvOS" in row["platforms"]]),
                ("android", "android", "Android", android["rows"])]:
            rows = [{key: copy.deepcopy(row[key]) for key in self.checker.FACTS} for row in symbols]
            for row, symbol in zip(rows, symbols):
                row.update({"status": "missing", "evidence": copy.deepcopy(symbol.get("evidence", []))})
            self.data["applications"].append({"id": app_id, "sdkId": sdk_id,
                "platform": platform, "rows": rows})

    @staticmethod
    def app(data, app_id):
        return next(app for app in data["applications"] if app["id"] == app_id)

    def check(self, data=None, snapshots=None):
        for name, value in (self.snapshots if snapshots is None else snapshots).items():
            path = (self.repo / "scripts/api-coverage/apple/docc-manifest.json"
                    if name == "manifest" else self.directory / name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value))
        return self.checker.check_native(self.data if data is None else data, self.directory)

    def test_pinned_native_snapshots_accept_platform_specific_and_deprecated_members(self):
        self.assertEqual([len(app["rows"]) for app in self.data["applications"]], [2, 1, 2])
        self.assertTrue(self.app(self.data, "ios")["rows"][1]["deprecated"])
        self.assertIsNone(self.check())

    def test_unknown_native_id_is_rejected_for_each_application(self):
        for app_id in ("ios", "tvos", "android"):
            data = copy.deepcopy(self.data)
            self.app(data, app_id)["rows"][0]["id"] = "native:invented.member()"
            with self.subTest(app=app_id), self.assertRaisesRegex(CoverageError, "Native SDK inventory differs"):
                self.check(data)

    def test_omitted_and_extra_native_members_are_rejected(self):
        for app_id in ("ios", "tvos", "android"):
            for change in ("omitted", "extra"):
                data = copy.deepcopy(self.data)
                rows = self.app(data, app_id)["rows"]
                if change == "omitted":
                    rows.pop()
                else:
                    rows.append(dict(rows[0], id="native:invented.member()"))
                with self.subTest(app=app_id, change=change), self.assertRaisesRegex(
                        CoverageError, "Native SDK inventory differs"):
                    self.check(data)

    def test_changed_apple_availability_cannot_reassign_a_member_to_tvos(self):
        snapshots = copy.deepcopy(self.snapshots)
        snapshots["apple/sdk-symbols.json"][1]["platforms"] = ["tvOS"]
        with self.assertRaisesRegex(CoverageError, "Native SDK inventory differs"):
            self.check(snapshots=snapshots)

    def test_wrong_application_platform_is_rejected(self):
        for app_id, platform in (("ios", "tvOS"), ("tvos", "iOS"), ("android", "browser")):
            data = copy.deepcopy(self.data)
            self.app(data, app_id)["platform"] = platform
            with self.subTest(app=app_id), self.assertRaises(CoverageError):
                self.check(data)

    def test_wrong_native_sdk_binding_is_rejected(self):
        for app_id, sdk_id in (("ios", "android"), ("tvos", "android"), ("android", "apple")):
            data = copy.deepcopy(self.data)
            self.app(data, app_id)["sdkId"] = sdk_id
            with self.subTest(app=app_id), self.assertRaises(CoverageError):
                self.check(data)

    def test_changed_native_category_scope_deprecation_and_reference_are_rejected(self):
        for app_id in ("ios", "tvos", "android"):
            for key, value in (("category", "observation"), ("scope", "invented"),
                    ("deprecated", True), ("officialReference", "https://cdn.bitmovin.com/player/old/member")):
                data = copy.deepcopy(self.data)
                self.app(data, app_id)["rows"][0][key] = value
                with self.subTest(app=app_id, field=key), self.assertRaisesRegex(
                        CoverageError, "Native SDK member facts differ"):
                    self.check(data)

    def test_stale_report_and_snapshot_sdk_versions_are_rejected(self):
        for sdk_id, version in (("apple", "3.127.0"), ("android", "3.170.0")):
            data = copy.deepcopy(self.data)
            next(sdk for sdk in data["sdks"] if sdk["id"] == sdk_id)["version"] = version
            with self.subTest(source="report", sdk=sdk_id), self.assertRaisesRegex(
                    CoverageError, "SDK snapshot version differs"):
                self.check(data)
        for source in ("manifest", "android/sdk-symbols.json", "android/sources.json"):
            snapshots = copy.deepcopy(self.snapshots)
            snapshots[source]["version"] = "0.0.0"
            with self.subTest(source=source), self.assertRaisesRegex(CoverageError, "SDK snapshot version differs"):
                self.check(snapshots=snapshots)

    def test_apple_provenance_is_bound_to_manifest_package_version_file_and_hash(self):
        for key, value in (("package", "different-package"), ("version", "3.127.0"),
                ("file", "data/documentation/missing.json"), ("sha256", "0" * 64)):
            snapshots = copy.deepcopy(self.snapshots)
            data = copy.deepcopy(self.data)
            snapshots["apple/sdk-symbols.json"][0]["evidence"][0][key] = value
            # Keep report and snapshot in agreement to exercise the independent manifest guard.
            for app_id in ("ios", "tvos"):
                self.app(data, app_id)["rows"][0]["evidence"][0][key] = value
            with self.subTest(field=key), self.assertRaisesRegex(CoverageError, "Apple SDK manifest provenance differs"):
                self.check(data, snapshots)

    def test_missing_or_stale_manifest_file_hash_is_rejected(self):
        for change in ("missing", "stale"):
            snapshots = copy.deepcopy(self.snapshots)
            files = snapshots["manifest"]["files"]
            file = next(iter(files))
            if change == "missing":
                files.pop(file)
            else:
                files[file]["sha256"] = "0" * 64
            with self.subTest(change=change), self.assertRaisesRegex(
                    CoverageError, "Apple SDK manifest provenance differs"):
                self.check(snapshots=snapshots)

    def test_missing_or_changed_required_sdk_evidence_is_rejected(self):
        for app_id in ("ios", "tvos"):
            for change in ("missing", "changed"):
                data = copy.deepcopy(self.data)
                proof = self.app(data, app_id)["rows"][0]["evidence"]
                if change == "missing":
                    proof.clear()
                else:
                    proof[0]["sha256"] = "0" * 64
                with self.subTest(app=app_id, change=change), self.assertRaisesRegex(
                        CoverageError, "Native SDK provenance differs"):
                    self.check(data)

    def test_android_reference_must_match_the_versioned_source_even_if_report_agrees(self):
        for url in ("https://cdn.bitmovin.com/player/android/3.170.0/docs/player.html",
                    "https://example.invalid/player.html"):
            snapshots = copy.deepcopy(self.snapshots)
            data = copy.deepcopy(self.data)
            snapshots["android/sdk-symbols.json"]["rows"][0]["officialReference"] = url
            self.app(data, "android")["rows"][0]["officialReference"] = url
            with self.subTest(url=url), self.assertRaisesRegex(CoverageError, "Android member reference differs"):
                self.check(data, snapshots)

    def test_duplicate_report_native_rows_are_rejected(self):
        for app_id in ("ios", "tvos", "android"):
            data = copy.deepcopy(self.data)
            rows = self.app(data, app_id)["rows"]
            rows.append(copy.deepcopy(rows[0]))
            with self.subTest(app=app_id), self.assertRaisesRegex(CoverageError, "Duplicate native API row"):
                self.check(data)

    def test_duplicate_native_snapshot_symbols_are_rejected(self):
        for source in ("apple/sdk-symbols.json", "android/sdk-symbols.json"):
            snapshots = copy.deepcopy(self.snapshots)
            rows = snapshots[source] if source.startswith("apple") else snapshots[source]["rows"]
            rows.append(copy.deepcopy(rows[0]))
            with self.subTest(source=source), self.assertRaisesRegex(CoverageError, "Duplicate .* SDK symbol"):
                self.check(snapshots=snapshots)


class CoverageGapTests(unittest.TestCase):
    def setUp(self):
        from coverage_gaps import needs_gui_route, validate_gaps
        self.needs_gui_route = needs_gui_route
        self.validate_gaps = validate_gaps
        rows = []
        for name, category, status in [
                ("autoplay", "configuration", "direct"),
                ("theme", "configuration", "preset"),
                ("callback", "configuration", "code-only"),
                ("configRead", "configuration", "observed"),
                ("play", "command", "direct"),
                ("speed", "command", "preset"),
                ("initialize", "command", "internal"),
                ("volume", "command", "missing"),
                ("time", "observation", "observed"),
                ("state", "observation", "code-only"),
                ("playing", "event", "observed"),
                ("warning", "event", "missing")]:
            rows.append({"id": "Player." + name, "category": category, "scope": "Player",
                "deprecated": False, "status": status,
                "officialReference": "https://cdn.bitmovin.com/player/web/8/docs/interfaces/Core.PlayerAPI.html",
                "evidence": []})
        self.report = {"schemaVersion": 1, "checkedAt": "2026-10-20", "sourceRevision": "a" * 40,
            "sdks": [], "applications": [
                {"id": "web", "sdkId": "web", "platform": "Web", "rows": rows,
                 "excluded": [{"id": "Player.generated", "reason": "Generated helper alias."}], "scopeNotes": []},
                {"id": "covered", "sdkId": "web", "platform": "Web", "rows": [rows[0]],
                 "excluded": [], "scopeNotes": []}]}
        self.gaps = {"schemaVersion": 1, "checkedAt": "2026-10-20",
            "reportInputSha256": summarize(self.report)["inputSha256"],
            "reasons": {
                "editor-missing": {"kind": "implementation",
                    "en": {"reason": "The app lacks an editor or visible route.", "action": "Add a typed user control."},
                    "ja": {"reason": "編集・表示経路が未実装です。", "action": "型付きの操作経路を実装します。"},
                    "references": []},
                "callback-contract": {"kind": "input-contract",
                    "en": {"reason": "The API accepts a function rather than JSON.", "action": "Provide a typed callback strategy."},
                    "ja": {"reason": "JSON値ではなく関数を受け取ります。", "action": "型付き処理を選択できるようにします。"},
                    "references": ["https://cdn.bitmovin.com/player/web/8/docs/interfaces/Core.PlayerAPI.html"]}},
            "applications": [
                {"id": "web", "groups": [
                    {"reason": "editor-missing", "apis": ["Player.theme", "Player.configRead", "Player.speed",
                        "Player.initialize", "Player.volume", "Player.state", "Player.warning"]},
                    {"reason": "callback-contract", "apis": ["Player.callback"]}]},
                {"id": "covered", "groups": []}]}

    def test_complete_reasons_preserve_api_statuses_and_denominators(self):
        before_report, before_gaps = copy.deepcopy(self.report), copy.deepcopy(self.gaps)
        result = self.validate_gaps(self.gaps, self.report)
        self.assertEqual(set(result), {"web", "covered"})
        self.assertEqual(set(result["web"]), {"Player.theme", "Player.callback", "Player.configRead",
            "Player.speed", "Player.initialize", "Player.volume", "Player.state", "Player.warning"})
        self.assertEqual(result["covered"], {})
        self.assertEqual(result["web"]["Player.callback"],
            {"id": "callback-contract", **self.gaps["reasons"]["callback-contract"]})
        self.assertIsNot(result["web"]["Player.callback"], self.gaps["reasons"]["callback-contract"])
        self.assertEqual(self.report, before_report)
        self.assertEqual(self.gaps, before_gaps)
        self.assertEqual(summarize(self.report), summarize(before_report))

    def test_route_requirement_distinguishes_value_inputs_from_visible_reads(self):
        statuses = ("direct", "preset", "observed", "internal", "code-only", "missing", "sdk-ui-unverified")
        for category in ("configuration", "command", "observation", "event"):
            visible = {"direct"} if category in ("configuration", "command") else {"direct", "preset", "observed"}
            for status in statuses:
                with self.subTest(category=category, status=status):
                    self.assertEqual(self.needs_gui_route({"category": category, "status": status}), status not in visible)
        for row in ({"category": "invented", "status": "missing"}, {"category": "event", "status": "invented"}):
            with self.subTest(row=row), self.assertRaises(CoverageError):
                self.needs_gui_route(row)

    def test_an_inventory_without_gaps_needs_no_invented_explanations(self):
        self.report["applications"] = [self.report["applications"][1]]
        self.gaps["reportInputSha256"] = summarize(self.report)["inputSha256"]
        self.gaps["reasons"] = {}
        self.gaps["applications"] = [{"id": "covered", "groups": []}]
        self.assertEqual(self.validate_gaps(self.gaps, self.report), {"covered": {}})

    def test_report_change_invalidates_the_bound_reason_inventory(self):
        self.report["applications"][0]["rows"][0]["status"] = "missing"
        with self.assertRaisesRegex(CoverageError, "hash|fingerprint|stale"):
            self.validate_gaps(self.gaps, self.report)
        self.gaps["reportInputSha256"] = summarize(self.report)["inputSha256"]
        with self.assertRaisesRegex(CoverageError, "missing|match|complete"):
            self.validate_gaps(self.gaps, self.report)

    def test_missing_unknown_excluded_and_fully_exposed_members_are_rejected(self):
        for change in ("missing", "unknown", "excluded", "direct", "visible-read", "visible-event"):
            gaps = copy.deepcopy(self.gaps)
            apis = gaps["applications"][0]["groups"][0]["apis"]
            if change == "missing":
                apis.remove("Player.volume")
            else:
                apis.append({"unknown": "Player.invented", "excluded": "Player.generated",
                    "direct": "Player.play", "visible-read": "Player.time", "visible-event": "Player.playing"}[change])
            with self.subTest(change=change), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)

    def test_duplicate_member_within_or_across_groups_is_rejected(self):
        for index in (0, 1):
            gaps = copy.deepcopy(self.gaps)
            gaps["applications"][0]["groups"][index]["apis"].append("Player.volume")
            with self.subTest(group=index), self.assertRaisesRegex(CoverageError, "Duplicate|duplicate"):
                self.validate_gaps(gaps, self.report)

    def test_application_inventory_is_exact_even_when_an_app_has_no_gaps(self):
        for change in ("missing", "extra", "duplicate"):
            gaps = copy.deepcopy(self.gaps)
            apps = gaps["applications"]
            if change == "missing":
                apps.pop()
            elif change == "extra":
                apps.append({"id": "unknown", "groups": []})
            else:
                apps.append(copy.deepcopy(apps[0]))
            with self.subTest(change=change), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)

    def test_reason_catalog_rejects_unknown_unused_and_unstable_ids(self):
        for change in ("unknown", "unused", "unstable"):
            gaps = copy.deepcopy(self.gaps)
            if change == "unknown":
                gaps["applications"][0]["groups"][0]["reason"] = "unknown"
            elif change == "unused":
                gaps["reasons"]["unused-reason"] = copy.deepcopy(gaps["reasons"]["editor-missing"])
            else:
                gaps["reasons"]["Unstable ID"] = gaps["reasons"].pop("editor-missing")
                gaps["applications"][0]["groups"][0]["reason"] = "Unstable ID"
            with self.subTest(change=change), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)

    def test_reason_and_action_are_required_in_both_languages(self):
        for language in ("en", "ja"):
            for field in ("reason", "action"):
                for invalid in (None, "", " \n", "invalid\x00value"):
                    gaps = copy.deepcopy(self.gaps)
                    gaps["reasons"]["editor-missing"][language][field] = invalid
                    with self.subTest(language=language, field=field, invalid=invalid), self.assertRaises(CoverageError):
                        self.validate_gaps(gaps, self.report)
            gaps = copy.deepcopy(self.gaps)
            del gaps["reasons"]["editor-missing"][language]
            with self.subTest(missing_language=language), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)

    def test_references_are_safe_primary_vendor_urls_and_required_arrays(self):
        for references in (None, "https://cdn.bitmovin.com/player/", ["http://cdn.bitmovin.com/player/"],
                ["https://example.invalid/"], ["https://cdn.bitmovin.com/player/../secret"],
                ["https://user:secret@cdn.bitmovin.com/player/"], ["https://cdn.bitmovin.com/player/%252e%252e/secret"]):
            gaps = copy.deepcopy(self.gaps)
            gaps["reasons"]["editor-missing"]["references"] = references
            with self.subTest(references=references), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)
        gaps = copy.deepcopy(self.gaps)
        del gaps["reasons"]["editor-missing"]["references"]
        with self.assertRaises(CoverageError):
            self.validate_gaps(gaps, self.report)

    def test_unknown_schema_fields_kinds_and_invalid_dates_are_rejected(self):
        for field, value in (("schemaVersion", 2), ("schemaVersion", True),
                ("checkedAt", "2026-02-30"), ("checkedAt", "2026-10-19"), ("checkedAt", "2026-1-1"),
                ("reportInputSha256", "not-a-hash"), ("unexpected", True)):
            gaps = copy.deepcopy(self.gaps)
            gaps[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)
        gaps = copy.deepcopy(self.gaps)
        gaps["reasons"]["editor-missing"]["kind"] = "sdk-impossible"
        with self.assertRaises(CoverageError):
            self.validate_gaps(gaps, self.report)

    def test_nested_schema_cannot_hide_overrides_or_empty_reason_groups(self):
        for location in ("reason", "translation", "application", "group", "empty-group"):
            gaps = copy.deepcopy(self.gaps)
            if location == "reason":
                gaps["reasons"]["editor-missing"]["notes"] = "Unvalidated override"
            elif location == "translation":
                gaps["reasons"]["editor-missing"]["en"]["status"] = "direct"
            elif location == "application":
                gaps["applications"][0]["excluded"] = ["Player.volume"]
            elif location == "group":
                gaps["applications"][0]["groups"][0]["status"] = "direct"
            else:
                gaps["applications"][0]["groups"][0]["apis"] = []
            with self.subTest(location=location), self.assertRaises(CoverageError):
                self.validate_gaps(gaps, self.report)



class AndroidVariantTests(unittest.TestCase):
    def setUp(self):
        from android_variants import validate_variant
        self.check_variant = validate_variant
        root = Path(__file__).resolve().parents[1] / "docs/api-coverage"
        self.contract = json.loads((root / "android/variant-contract.json").read_text())
        report = json.loads((root / "coverage.json").read_text())
        self.app = next(a for a in report["applications"] if a["id"] == "android")
        self.sdk = next(s for s in report["sdks"] if s["id"] == "android")
        self.sources = json.loads((root / "android/sources.json").read_text())
        # The report fixture explicitly binds both published binary flavors.
        known = {s["url"] for s in self.sdk["sources"]}
        self.sdk["sources"] += [{"url": a["officialArtifact"], "sha256": a["aarSha256"]}
                                for a in self.contract["artifacts"] if a["officialArtifact"] not in known]

    def test_original_inventory_survives_binary_package_relocation(self):
        self.check_variant(self.contract, self.app, self.sdk, self.sources)
        self.assertEqual({r["id"] for r in self.contract["rows"]}, {r["id"] for r in self.app["rows"]})

    def test_missing_duplicate_unknown_or_recategorized_member_is_rejected(self):
        for change in ("missing", "duplicate", "unknown", "category"):
            contract = copy.deepcopy(self.contract)
            if change == "missing":
                contract["rows"].pop()
            elif change == "duplicate":
                contract["rows"].append(copy.deepcopy(contract["rows"][0]))
            elif change == "unknown":
                contract["rows"][0]["id"] += ".invented"
            else:
                contract["rows"][0]["category"] = "invented"
            with self.subTest(change=change), self.assertRaises(CoverageError):
                self.check_variant(contract, self.app, self.sdk, self.sources)

    def test_non_relocation_signature_drift_cannot_be_hidden_by_success_flags(self):
        contract = copy.deepcopy(self.contract)
        owner = next(r["owner"] for r in contract["rows"] if r["shapeDifferenceOwner"] is None)
        contract["publicOwners"][owner]["jason"].append("public void inventedBehavior();")
        with self.assertRaises(CoverageError):
            self.check_variant(contract, self.app, self.sdk, self.sources)

    def test_artifact_coordinates_hashes_and_canonical_report_binding_are_required(self):
        for change in ("url", "hash", "module", "missing", "report-hash", "source-hash", "version"):
            contract, sdk = copy.deepcopy(self.contract), copy.deepcopy(self.sdk)
            if change == "url":
                contract["artifacts"][0]["officialArtifact"] = "https://example.com/player.aar"
            elif change == "hash":
                contract["artifacts"][0]["aarSha256"] = "invalid"
            elif change == "module":
                contract["artifacts"][0]["module"] = "invented"
            elif change == "missing":
                contract["artifacts"].pop()
            elif change == "report-hash":
                target = contract["artifacts"][0]["officialArtifact"]
                next(s for s in sdk["sources"] if s["url"] == target)["sha256"] = "0" * 64
            elif change == "source-hash":
                contract["sourceArtifact"]["sha256"] = "0" * 64
            else:
                contract["variantsCompared"][0] = "0.0.0"
            with self.subTest(change=change), self.assertRaises(CoverageError):
                self.check_variant(contract, self.app, sdk, self.sources)

    def test_member_presence_is_derived_from_raw_signatures(self):
        contract = copy.deepcopy(self.contract)
        row = next(r for r in contract["rows"] if r["category"] == "command")
        contract["publicOwners"][row["owner"]] = {"standard": ["public class Empty {"], "jason": ["public class Empty {"]}
        with self.assertRaises(CoverageError):
            self.check_variant(contract, self.app, self.sdk, self.sources)



    def test_actual_app_flavor_requires_its_matching_snapshot(self):
        from android_variants import check_android_variant
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "android").mkdir()
            raw = (json.dumps(self.contract, ensure_ascii=False, indent=2) + "\n").encode()
            metadata = copy.deepcopy(self.sources)
            metadata.update(appVariant="+jason", variantContractSha256=hashlib.sha256(raw).hexdigest())
            (root / "android/variant-contract.json").write_bytes(raw)
            (root / "android/sources.json").write_text(json.dumps(metadata))
            data = {"applications": [self.app], "sdks": [self.sdk]}
            gradle = 'implementation("com.bitmovin.player:player:' + self.sdk["version"] + '+jason")'
            check_android_variant(data, root, gradle)
            for bad in (gradle + "\n" + gradle, gradle.replace("+jason", "+unknown"), gradle.replace(self.sdk["version"], "0.0.0")):
                with self.subTest(gradle=bad), self.assertRaises(CoverageError):
                    check_android_variant(data, root, bad)
            metadata["variantContractSha256"] = "0" * 64
            (root / "android/sources.json").write_text(json.dumps(metadata))
            with self.assertRaises(CoverageError):
                check_android_variant(data, root, gradle)

    def test_standard_source_inventory_does_not_inherit_binary_flavor_proofs(self):
        from android_variants import check_android_variant
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "android").mkdir()
            metadata = copy.deepcopy(self.sources)
            metadata.pop("appVariant", None)
            metadata.pop("variantContractSha256", None)
            (root / "android/sources.json").write_text(json.dumps(metadata))
            data = {"applications": [self.app], "sdks": [self.sdk]}
            gradle = 'implementation("com.bitmovin.player:player:' + self.sdk["version"] + '")'
            check_android_variant(data, root, gradle)


if __name__ == "__main__":
    unittest.main()
