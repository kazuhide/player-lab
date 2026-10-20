import copy
import unittest
from report import playback_samples, validate_report


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
                         lambda s: s[-1]["owner"]["sample"].update(playing=False)]:
            broken = copy.deepcopy(samples)
            mutation(broken)
            with self.assertRaises(ValueError):
                playback_samples(broken)

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
