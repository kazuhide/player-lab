"""Check that reused guide build directories cannot supply stale Android sources."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("guide_examples", Path(__file__).with_name("check-guide-native-examples.py"))
examples = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(examples)


class AndroidMirrorTests(unittest.TestCase):
    def test_reused_work_directory_compiles_only_current_tracked_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository, work = root / "repository", root / "work"
            source = repository / "apps/android/app/src/main/kotlin"
            source.mkdir(parents=True)
            example = repository / "apps/android/examples/MinimalPlayerActivity.kt"
            example.parent.mkdir(parents=True)
            example.write_text("class MinimalPlayerActivity\n")
            (source / "Old.kt").write_text("class Old\n")
            (repository / "apps/android/.env.private").write_text("excluded fixture\n")
            (repository / "apps/android/local.properties").write_text("excluded fixture\n")
            subprocess.run(["git", "init", "-q", str(repository)], check=True)
            subprocess.run(["git", "add", "."], cwd=repository, check=True)
            work.mkdir()
            compiled = []

            def observe(_command, mirror):
                compiled.append({path.name for path in (mirror / "app/src/main/kotlin").rglob("*.kt")})
                self.assertFalse((mirror / ".env.private").exists())
                self.assertFalse((mirror / "local.properties").exists())

            with patch.object(examples, "ROOT", repository), patch.object(examples, "run", observe):
                examples.android(work)
                (source / "Old.kt").rename(source / "New.kt")
                (source / "New.kt").write_text("class New\n")
                subprocess.run(["git", "add", "-A"], cwd=repository, check=True)
                unrelated = work / "android/keep.txt"
                unrelated.parent.mkdir(parents=True, exist_ok=True)
                unrelated.write_text("Retain unrelated work-directory content.\n")
                examples.android(work)
                self.assertEqual(compiled, [
                    {"Old.kt", "MinimalPlayerActivity.kt"},
                    {"New.kt", "MinimalPlayerActivity.kt"},
                ])
                self.assertTrue(unrelated.is_file())
            self.assertFalse(list(work.glob("android-example-*")))

    def test_failed_compilation_cleans_only_its_owned_source_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            unrelated = work / "keep.txt"
            unrelated.write_text("Retain unrelated files.\n")
            with patch.object(examples, "run", side_effect=RuntimeError("Expected compiler failure")):
                with self.assertRaisesRegex(RuntimeError, "Expected compiler failure"):
                    examples.android(work)
            self.assertTrue(unrelated.is_file())
            self.assertFalse(list(work.glob("android-example-*")))


if __name__ == "__main__":
    unittest.main()
