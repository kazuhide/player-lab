import copy
import unittest

from embedded_ios import validate_observations
from test_controls import observation


def values():
    result = []
    for index, shown in enumerate([True, False, True, True]):
        before = observation(index * 2 + 1, index != 1, live=index < 3)
        after = observation(index * 2 + 2, index != 1, live=index < 3)
        if index == 3:
            before["owner"]["generation"] = after["owner"]["generation"] = 2
        result.append({"snapshot": {"sequence": index + 1, "viewIdentity": "live-wk" if index < 3 else "vod-wk",
            "dom": {"width": 393, "height": 220, "controls": [
                {"className": "bmpui-ui-playbacktogglebutton", "visible": True, "hittable": True},
                {"className": "bmpui-ui-seekbar", "visible": shown, "hittable": shown}]}},
            "nativeBefore": before, "nativeAfter": after})
    return result


class WkEvidenceTests(unittest.TestCase):
    def test_absent_seekbar_cannot_pass_when_the_whole_bar_is_hidden(self):
        original = values()
        self.assertTrue(validate_observations(original))
        for key in ["visible", "hittable"]:
            changed = copy.deepcopy(original)
            changed[1]["snapshot"]["dom"]["controls"][0][key] = False
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_observations(changed)

    def test_native_errors_resume_position_jump_and_source_replacement_are_rejected(self):
        for mutate in [lambda v: v[1]["nativeAfter"]["owner"].update(errors=1),
                       lambda v: v[1]["nativeAfter"]["owner"].update(readFailures=1),
                       lambda v: v[1]["nativeAfter"]["owner"].update(sourceLoads=2),
                       lambda v: v[1]["nativeAfter"]["owner"]["sample"].update(playing=True),
                       lambda v: v[1]["nativeAfter"]["owner"]["sample"].update(time=999),
                       lambda v: v[1]["nativeAfter"]["owner"]["sample"].update(sequence=1)]:
            changed = values(); mutate(changed)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                validate_observations(changed)

    def test_reused_wk_snapshot_or_replaced_live_view_cannot_pass(self):
        for mutate in [lambda v: v[1]["snapshot"].update(sequence=1),
                       lambda v: v[1]["snapshot"].update(viewIdentity="replacement"),
                       lambda v: v[1]["snapshot"].update(error="read failed")]:
            changed = values(); mutate(changed)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                validate_observations(changed)


if __name__ == "__main__":
    unittest.main()
