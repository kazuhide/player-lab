"""License-free ownership checks for the public Apple runtime runner."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import plistlib
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

spec = spec_from_file_location("track_qualification", Path(__file__).with_name("run-track-qualification.py"))
runner = module_from_spec(spec)
spec.loader.exec_module(runner)


class SelectedPlanOwnershipTests(unittest.TestCase):
    def test_successful_invocation_removes_only_its_own_plan(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            with runner.selected_test_plan(path, {"fixture": True}) as selected:
                self.assertEqual(selected, path)
                self.assertEqual(plistlib.loads(path.read_bytes()), {"fixture": True})
            self.assertFalse(path.exists())

    def test_existing_plan_is_rejected_and_preserved(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            original = b"another invocation owns this file"
            path.write_bytes(original)
            rejected = None
            try:
                with runner.selected_test_plan(path, {"replacement": True}):
                    self.fail("Existing plan must reject a second owner")
            except Exception as error:
                rejected = error
            self.assertTrue(path.exists(), "A rejected invocation removed another owner's plan")
            self.assertEqual(path.read_bytes(), original)
            self.assertIsInstance(rejected, FileExistsError)

    def test_serialization_failure_removes_the_new_owned_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            with self.assertRaises(TypeError):
                with runner.selected_test_plan(path, {"unsupported": object()}):
                    self.fail("Serialization should fail before yielding")
            self.assertFalse(path.exists())

    def test_partial_write_failure_removes_the_new_owned_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "selected.xctestrun"
            original_open = Path.open

            class PartialWrite:
                def __init__(self, stream):
                    self.stream = stream

                def __enter__(self):
                    self.stream.__enter__()
                    return self

                def __exit__(self, *values):
                    return self.stream.__exit__(*values)

                def write(self, data):
                    self.stream.write(data[:8])
                    self.stream.flush()
                    raise OSError("Synthetic partial write")

            def opened(file, mode="r", *values, **options):
                stream = original_open(file, mode, *values, **options)
                return PartialWrite(stream) if file == path and mode in ["wb", "xb"] else stream

            with patch.object(Path, "open", new=opened), self.assertRaises(OSError):
                with runner.selected_test_plan(path, {"fixture": True}):
                    self.fail("Partial write should fail before yielding")
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
