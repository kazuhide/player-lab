#!/usr/bin/env python3
"""Check app-resource and APK verification using small local fixture bundles."""
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("native_ui", Path(__file__).with_name("check-native-ui.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class NativeAssetsTests(unittest.TestCase):
    def write_ios_config(self, app, **values):
        info = {"BitmovinLicenseKey": "", "BitmovinAnalyticsLicenseKey": ""}
        info.update(values)
        (app / "Info.plist").write_bytes(plistlib.dumps(info))

    def test_missing_changed_and_matching_app_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            app = root / "Sample.app"
            app.mkdir()
            self.write_ios_config(app)
            for name in ("bitmovinplayer-ui.js", "bitmovinplayer-ui.css"):
                (source / name).write_text("generated " + name)
            with self.assertRaises(ValueError):
                checker.check(app, source)
            for path in source.iterdir():
                (app / path.name).write_bytes(path.read_bytes())
            checker.check(app, source)
            (app / "bitmovinplayer-ui.js").write_text("stale")
            with self.assertRaises(ValueError):
                checker.check(app, source)

    def test_apk_contains_both_exact_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apk = root / "app.apk"
            source = root / "source"
            source.mkdir()
            with zipfile.ZipFile(apk, "w") as archive:
                for name in ("bitmovinplayer-ui.js", "bitmovinplayer-ui.css"):
                    (source / name).write_text(name)
                    archive.writestr("assets/" + name, name)
            checker.check(apk, source)

    def test_ios_subdirectory_only_is_not_a_root_bundle_resource(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            app = root / "Sample.app"
            (app / "WebUI").mkdir(parents=True)
            self.write_ios_config(app)
            for name in ("bitmovinplayer-ui.js", "bitmovinplayer-ui.css"):
                (source / name).write_text(name)
                (app / "WebUI" / name).write_text(name)
            with self.assertRaises(ValueError):
                checker.check(app, source)

    def test_built_ios_config_requires_resolved_keys_even_without_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            (app / "Info.plist").write_bytes(plistlib.dumps({}))
            with self.assertRaisesRegex(ValueError, "BitmovinLicenseKey"):
                checker.check_ios_config(app)
            self.write_ios_config(app)
            checker.check_ios_config(app)
            self.write_ios_config(app, BitmovinLicenseKey="$(BITMOVIN_PLAYER_LICENSE_KEY)")
            with self.assertRaisesRegex(ValueError, "BitmovinLicenseKey"):
                checker.check_ios_config(app)
            self.write_ios_config(app, BitmovinAnalyticsLicenseKey=1)
            with self.assertRaisesRegex(ValueError, "BitmovinAnalyticsLicenseKey"):
                checker.check_ios_config(app)

    def test_config_errors_never_echo_credential_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            self.write_ios_config(app, BitmovinLicenseKey="$(private-fixture-value)")
            with self.assertRaises(ValueError) as error:
                checker.check_ios_config(app)
            self.assertNotIn("private-fixture-value", str(error.exception))


if __name__ == "__main__":
    unittest.main()
