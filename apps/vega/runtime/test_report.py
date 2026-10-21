import copy
import unittest
from report import applied, playback, released, validate


def fixture():
    return {"protocol": 1, "created": 1, "owner": {"generation": 1, "sourceLoaded": 1, "cueEnter": 1,
        "cueVisible": True, "errors": 0, "errorCodes": [], "readFailures": 0, "sample": {"sequence": 1,
        "time": 1, "duration": 60, "live": False, "playing": True, "muted": True, "decodedFrames": 30,
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


if __name__ == "__main__": unittest.main()
