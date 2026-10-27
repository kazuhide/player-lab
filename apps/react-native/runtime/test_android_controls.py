import copy
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


spec = importlib.util.spec_from_file_location("android_controls", Path(__file__).with_name("run-android.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class ControlUi(driver.Ui):
    def __init__(self, outcomes):
        self.width, self.height, self.bottom = 400, 800, 800
        self.outcomes = iter(outcomes)
        self.touches = []
        self.last_report = {"owner": {"generation": 2, "sample": {"sequence": 1, "playing": True}}}
        self.last_tree = ET.fromstring('<hierarchy><node text="Pause" bounds="[0,0][80,80]"/>'
            '<node text="Read runtime report" bounds="[0,100][180,180]"/></hierarchy>')

    def top(self):
        pass

    def tree(self):
        return self.last_tree

    def tap(self, node):
        self.touches.append(node.get("text"))

    def wait_report(self, predicate, refresh):
        self.last_report = copy.deepcopy(next(self.outcomes))
        if not predicate(self.last_report):
            raise RuntimeError("No fresh native observation")
        return self.last_report


def observation(sequence, playing, generation=2):
    return {"owner": {"generation": generation, "sample": {"sequence": sequence, "playing": playing}}}


class NativeControlAcknowledgementTests(unittest.TestCase):
    def test_compact_sdk_pause_button_precedes_the_full_video_overlay(self):
        ui = ControlUi([observation(2, False)])
        ui.last_tree = ET.fromstring('<hierarchy><node class="android.webkit.WebView" bounds="[0,0][400,220]">'
            '<node class="android.widget.Button" resource-id="overlay-pause" text="Pause" bounds="[0,0][400,220]"/>'
            '<node class="android.widget.Button" resource-id="bar-pause" text="Pause" bounds="[10,160][60,210]"/>'
            '</node><node text="Read runtime report" bounds="[0,240][180,300]"/></hierarchy>')
        ui.tap = lambda node: ui.touches.append(node.get("resource-id") or node.get("text"))
        ui.pause_visible()
        self.assertEqual(ui.touches, ["bar-pause", "Read runtime report"])

    def test_reveal_only_touch_does_not_count_as_pause(self):
        ui = ControlUi([observation(2, True), observation(3, False)])
        ui.pause_visible()
        self.assertEqual(ui.touches, ["Pause", "Read runtime report"] * 2)

    def test_missing_pause_acknowledgement_fails_after_bounded_touches(self):
        ui = ControlUi([observation(i, True) for i in [2, 3, 4]])
        with self.assertRaises(RuntimeError):
            ui.pause_visible()
        self.assertEqual(ui.touches.count("Pause"), 3)

    def test_stale_sample_or_replaced_owner_cannot_acknowledge_pause(self):
        for value in [observation(1, False), observation(2, False, generation=3)]:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                ControlUi([value]).pause_visible()


if __name__ == "__main__":
    unittest.main()
