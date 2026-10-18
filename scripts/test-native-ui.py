#!/usr/bin/env python3
"""Check app-resource and APK verification using small local fixture bundles."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("native_ui", Path(__file__).with_name("check-native-ui.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class NativeAssetsTests(unittest.TestCase):
    def test_missing_changed_and_matching_app_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            app = root / "Sample.app"
            app.mkdir()
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
            for name in ("bitmovinplayer-ui.js", "bitmovinplayer-ui.css"):
                (source / name).write_text(name)
                (app / "WebUI" / name).write_text(name)
            with self.assertRaises(ValueError):
                checker.check(app, source)


if __name__ == "__main__":
    unittest.main()
