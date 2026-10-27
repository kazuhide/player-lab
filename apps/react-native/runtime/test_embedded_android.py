import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("controls_driver", Path(__file__).with_name("run-controls-android.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


def snapshot(shown):
    return {"width": 400, "height": 220, "controls": [
        {"id": "overlay", "label": "Pause", "className": "bmpui-ui-hugeplaybacktogglebutton", "visible": True, "hittable": True},
        {"id": "compact", "label": "Pause", "className": "bmpui-ui-playbacktogglebutton", "visible": shown, "hittable": shown},
    ]}


def report(sequence, playing, generation=3):
    return {"owner": {"generation": generation, "sourceLoads": 1, "sourceLoaded": 1, "sample": {"sequence": sequence, "playing": playing}}}


class ObservedUi(driver.ControlsUi):
    def __init__(self, snapshots, reports):
        self.snapshots = iter(snapshots)
        self.reports = iter(reports)
        self.touches = []

    def report(self):
        return report(1, True)

    def sdk_frame(self):
        return (0, 0, 400, 220)

    def sdk_snapshot(self):
        return next(self.snapshots)

    def sdk_tap(self, control, frame, observed):
        self.touches.append(control["id"])

    def wait_report(self, predicate):
        value = next(self.reports)
        if not predicate(value):
            raise RuntimeError("Fresh native acknowledgement was unavailable")
        return value


class EffectiveVisibilityTests(unittest.TestCase):
    def test_hidden_bar_is_revealed_then_compact_pause_is_touched_before_native_readback(self):
        ui = ObservedUi([snapshot(False), snapshot(True)], [report(2, False)])
        ui.pause_visible()
        self.assertEqual(ui.touches, ["overlay", "compact"])

    def test_already_visible_bar_is_not_blindly_double_tapped(self):
        ui = ObservedUi([snapshot(True)], [report(2, False)])
        ui.pause_visible()
        self.assertEqual(ui.touches, ["compact"])

    def test_replaced_source_or_stale_native_sample_cannot_acknowledge_the_touch(self):
        for value in [report(1, False), report(2, False, generation=4)]:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                ObservedUi([snapshot(True)], [value]).pause_visible()

    def test_bounded_attempts_still_fail_if_native_playback_does_not_pause(self):
        ui = ObservedUi([snapshot(True)] * 3, [report(i, True) for i in [2, 3, 4]])
        with self.assertRaises(RuntimeError):
            ui.pause_visible()
        self.assertEqual(ui.touches, ["compact"] * 3)


if __name__ == "__main__":
    unittest.main()
