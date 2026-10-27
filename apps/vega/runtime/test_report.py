import copy
import unittest
from report import applied, live_controls, playback, released, shift_completed, validate


def fixture():
    return {"protocol": 1, "created": 1, "owner": {"generation": 1, "sourceLoaded": 1, "cueEnter": 1, "timeShifted": 0,
        "cueVisible": True, "errors": 0, "errorCodes": [], "readFailures": 0, "sample": {"sequence": 1,
        "time": 1, "duration": 60, "live": False, "playing": True, "muted": True, "maxTimeShift": 0, "timeShift": 0, "decodedFrames": 30,
        "subtitleCount": 3, "externalSubtitleAvailable": True, "externalSubtitleEnabled": True}}, "retired": [],
        "setupErrors": 0, "app": {"dvrAllowed": True, "logCount": 2, "sourceType": "hls", "startOffset": 1,
        "autoplay": True, "startupMuted": True, "videoForwardBuffer": 8, "audioForwardBuffer": 8,
        "maxVideoBitrate": 2500000, "externalSubtitleConfigured": True}, "codeGeneration": 1}


class ReportTests(unittest.TestCase):
    def test_rejects_extra_data_and_invalid_scalars(self):
        for change in [lambda v: v.update(key="never-report"), lambda v: v["owner"]["sample"].update(time=float("nan")),
                       lambda v: v["owner"]["sample"].update(muted=1)]:
            value = fixture(); change(value)
            with self.assertRaises(ValueError): validate(value)

    def test_requires_every_applied_setting(self):
        for name, replacement in {"startOffset": 5, "videoForwardBuffer": None, "audioForwardBuffer": None,
            "maxVideoBitrate": None, "autoplay": False, "startupMuted": False, "dvrAllowed": False,
            "sourceType": "dash", "externalSubtitleConfigured": False}.items():
            value = fixture(); value["app"][name] = replacement
            with self.assertRaises(ValueError): applied(value, True)

    def test_requires_current_muted_progress_and_decode(self):
        values = []
        for index in range(5):
            value = fixture(); value["owner"]["sample"].update(sequence=index + 1, time=index + 1, decodedFrames=30 * (index + 1)); values.append(value)
        self.assertEqual(playback(values, True), 1)
        for change in [lambda v: v[2]["owner"]["sample"].update(muted=False),
                       lambda v: v[2]["owner"].update(generation=2),
                       lambda v: v[4]["owner"]["sample"].update(decodedFrames=0),
                       lambda v: v[2]["owner"]["sample"].update(externalSubtitleEnabled=False)]:
            bad = copy.deepcopy(values); change(bad)
            with self.assertRaises(ValueError): playback(bad, True)

    def test_requires_confirmed_release(self):
        value = fixture(); value.update(owner=None, retired=[{"generation": 1, "releaseConfirmed": True}]); released(value)
        value["retired"][0]["releaseConfirmed"] = False
        with self.assertRaises(ValueError): released(value)

    def test_requires_real_live_window_and_every_native_button_to_follow_the_switch(self):
        value = fixture(); value["owner"]["sample"].update(live=True, duration=None, maxTimeShift=-900)
        buttons = {"-10s": True, "-30s": True, "-60s": True}
        live_controls(value, 1, True, buttons)
        for change in [lambda v, b: v["owner"]["sample"].update(live=False),
                       lambda v, b: v["owner"]["sample"].update(maxTimeShift=0),
                       lambda v, b: v["owner"].update(generation=2),
                       lambda v, b: b.update({"-60s": False}),
                       lambda v, b: b.pop("-30s")]:
            bad, controls = copy.deepcopy(value), dict(buttons); change(bad, controls)
            with self.assertRaises(ValueError): live_controls(bad, 1, True, controls)
        value["app"]["dvrAllowed"] = False
        live_controls(value, 1, False, dict.fromkeys(buttons, False))
        with self.assertRaises(ValueError): live_controls(value, 1, False, buttons)

    def test_requires_completion_event_and_same_clock_target_from_immediately_before_the_press(self):
        before = fixture(); before["owner"]["sample"].update(live=True, time=1000, duration=None, maxTimeShift=-900)
        after = copy.deepcopy(before)
        after["owner"]["timeShifted"] = 1
        after["owner"]["sample"].update(sequence=2, time=990, timeShift=-10)
        self.assertTrue(shift_completed(before, after, 1, -10))
        for change in [lambda v: v["owner"].update(timeShifted=0),
                       lambda v: v["owner"].update(generation=2),
                       lambda v: v["owner"]["sample"].update(time=500),
                       lambda v: v["owner"]["sample"].update(sequence=1)]:
            bad = copy.deepcopy(after); change(bad)
            self.assertFalse(shift_completed(before, bad, 1, -10))
        edge = copy.deepcopy(after); edge["owner"]["timeShifted"] = 2
        edge["owner"]["sample"].update(sequence=3, time=1000, timeShift=0)
        self.assertTrue(shift_completed(after, edge, 1, 0))


if __name__ == "__main__": unittest.main()
