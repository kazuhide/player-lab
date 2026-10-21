import copy
import unittest
from report import configuration_stages, playback_samples, validate_report


def report():
    return {"protocol": 1, "created": 1, "retired": [], "app": None, "lifecycle": "active", "batch": None,
            "code": {"generation": 0, "clipboardMatches": None, "readFailed": False},
            "owner": {"generation": 1, "viewReady": True, "sourceLoads": 1, "sourceLoaded": 1, "timeChanged": 1,
                      "cueEnter": 0, "errors": 0, "readFailures": 0, "errorCodes": [],
                      "sample": {"sequence": 1, "time": 5, "duration": 60, "live": False, "playing": True,
                                 "muted": True, "subtitleCount": 0, "externalSubtitleAvailable": False, "externalSubtitleSelected": False}}}


class SafeReportTests(unittest.TestCase):
    def test_unknown_fields_are_rejected_at_every_public_boundary(self):
        for path in [[], ["owner"], ["owner", "sample"], ["code"]]:
            value = report()
            target = value
            for key in path:
                target = target[key]
            target["unexpected"] = "not allowed"
            with self.assertRaises(ValueError):
                validate_report(value)

    def test_no_progress_stale_owner_and_sdk_errors_fail(self):
        samples = [copy.deepcopy(report()) for _ in range(5)]
        for index, value in enumerate(samples):
            value["owner"]["sample"].update(sequence=index + 1, time=5 + index)
        self.assertEqual(playback_samples(samples)["times"], [5, 6, 7, 8, 9])
        for mutation in [lambda s: s[-1]["owner"].update(generation=2),
                         lambda s: s[-1]["owner"].update(errors=1),
                         lambda s: s[-1]["owner"]["sample"].update(time=5),
                         lambda s: s[-1]["owner"]["sample"].update(muted=False),
                         lambda s: s[-1]["owner"]["sample"].update(playing=False)]:
            broken = copy.deepcopy(samples)
            mutation(broken)
            with self.assertRaises(ValueError):
                playback_samples(broken)

    def test_every_recreated_stage_requires_the_applied_settings_and_ui(self):
        stages = []
        for index, name in enumerate(["default", "sports", "default-return", "foreground"]):
            samples = [copy.deepcopy(report()) for _ in range(5)]
            for sequence, value in enumerate(samples):
                value["created"] = 4
                value["owner"]["generation"] = [2, 3, 4, 4][index]
                value["owner"]["sample"].update(sequence=sequence + 1, time=5 + sequence)
                value["app"] = {"ui": "Sports" if index == 1 else "Default", "revision": 1,
                                "sourceType": "hls", "startOffset": 5, "autoplay": True, "startupMuted": True,
                                "forwardBuffer": 8, "maxBitrate": 2500000, "dvrAllowed": index == 0,
                                "externalSubtitleConfigured": False, "logCount": index + 1}
            stages.append({"stage": name, "samples": samples})
        configuration_stages(stages)
        for key, wrong in {"ui": "Default", "sourceType": "dash", "startOffset": None,
                           "autoplay": False, "startupMuted": False, "forwardBuffer": None,
                           "maxBitrate": None, "dvrAllowed": True, "logCount": 0}.items():
            broken = copy.deepcopy(stages)
            broken[1]["samples"][2]["app"][key] = wrong
            with self.subTest(key=key), self.assertRaises(ValueError):
                configuration_stages(broken)
        for index, stale in [(1, 2), (2, 3), (3, 5)]:
            broken = copy.deepcopy(stages)
            for value in broken[index]["samples"]:
                value["owner"]["generation"] = stale
            with self.subTest(stage=index), self.assertRaises(ValueError):
                configuration_stages(broken)

    def test_numeric_flags_nonfinite_values_and_fractional_counters_are_rejected(self):
        for mutation in [lambda v: v["code"].update(clipboardMatches=1),
                         lambda v: v["owner"]["sample"].update(sequence=1.5),
                         lambda v: v["owner"]["sample"].update(duration=float("inf")),
                         lambda v: v["owner"]["sample"].update(playing=1)]:
            value = report()
            mutation(value)
            with self.assertRaises(ValueError):
                validate_report(value)


if __name__ == "__main__":
    unittest.main()
