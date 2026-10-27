import copy
import unittest

from controls import live_rewind_transition, vod_controls
from test_report import report


def observation(sequence, allowed, live=True):
    value = report()
    value["app"] = {"ui": "Live (DVR)", "revision": 1, "sourceType": "hls", "startOffset": None,
                    "autoplay": True, "startupMuted": True, "forwardBuffer": None, "maxBitrate": None,
                    "dvrAllowed": allowed, "externalSubtitleConfigured": False, "logCount": 1}
    value["owner"]["sample"].update(sequence=sequence, playing=False, live=live,
                                    timeShift=-10 if live else 0, maxTimeShift=-120 if live else 0)
    return value


class EmbeddedControlEvidenceTests(unittest.TestCase):
    def test_live_toggle_requires_real_seekbar_and_retained_native_rewind(self):
        values = [observation(1, True), observation(2, False), observation(3, True)]
        self.assertEqual(live_rewind_transition(*values, [True, False, True])["owner"], 1)
        for mutate in [lambda v: v[1]["owner"].update(generation=2),
                       lambda v: v[1]["owner"].update(sourceLoads=2),
                       lambda v: v[1]["owner"].update(sourceLoaded=2),
                       lambda v: v[1]["owner"]["sample"].update(sequence=1),
                       lambda v: v[1]["owner"]["sample"].update(playing=True),
                       lambda v: v[1]["owner"]["sample"].update(timeShift=0),
                       lambda v: v[1]["owner"]["sample"].update(maxTimeShift=0)]:
            changed = copy.deepcopy(values); mutate(changed)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                live_rewind_transition(*changed, [True, False, True])

    def test_app_boolean_without_embedded_seekbar_transition_cannot_pass(self):
        values = [observation(1, True), observation(2, False), observation(3, True)]
        with self.assertRaises(ValueError):
            live_rewind_transition(*values, [True, True, True])

    def test_vod_requires_preserved_seeking_and_both_ordinary_ad_ops_unavailable(self):
        value = observation(1, False, live=False)
        vod_controls(value, True, True, True)
        for visible, skip, schedule in [(False, True, True), (True, False, True), (True, True, False)]:
            with self.subTest(visible=visible, skip=skip, schedule=schedule), self.assertRaises(ValueError):
                vod_controls(value, visible, skip, schedule)


if __name__ == "__main__":
    unittest.main()
