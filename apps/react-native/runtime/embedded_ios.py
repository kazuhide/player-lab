"""Require real WK visibility and fresh native playback for the iOS UI observations."""
from report import validate_report


def validate_observations(values):
    if not isinstance(values, list) or len(values) != 4:
        raise ValueError("Four read-only embedded UI observations are required")
    identity = None
    sequence = 0
    for index, (value, expected) in enumerate(zip(values, [True, False, True, True])):
        snapshot = value["snapshot"]
        if snapshot.get("error") or not isinstance(snapshot.get("viewIdentity"), str) or not snapshot["viewIdentity"]:
            raise ValueError("An actual native WK view identity is required")
        if type(snapshot.get("sequence")) is not int or snapshot["sequence"] <= sequence:
            raise ValueError("A fresh read-only WK observation is required")
        sequence = snapshot["sequence"]
        dom = snapshot["dom"]
        if dom["width"] <= 0 or dom["height"] <= 0:
            raise ValueError("The WK viewport must be visible")
        controls = dom["controls"]
        compact = [control for control in controls if "bmpui-ui-playbacktogglebutton" in control["className"].split()
                   and control["visible"] is True and control["hittable"] is True]
        if len(compact) != 1:
            raise ValueError("An ordinary compact SDK control must be actually visible")
        seekbar = any("bmpui-ui-seekbar" in control["className"].split() and control["visible"] is True for control in controls)
        if seekbar is not expected:
            raise ValueError("The actual WK seekbar did not match the preference")
        before, after = value["nativeBefore"], value["nativeAfter"]
        validate_report(before); validate_report(after)
        first, last = before["owner"], after["owner"]
        if not first or not last or any(first[key] != last[key] for key in ["generation", "sourceLoads", "sourceLoaded"]):
            raise ValueError("The WK observation crossed native owners or sources")
        previous, current = first["sample"], last["sample"]
        if any(owner["errors"] or owner["readFailures"] for owner in [first, last]) or not previous or not current:
            raise ValueError("A successful native source is required")
        if previous["playing"] or current["playing"] or current["sequence"] <= previous["sequence"]:
            raise ValueError("The WK observation must retain freshly observed paused playback")
        if previous["time"] is None or current["time"] is None or abs(current["time"] - previous["time"]) > .25:
            raise ValueError("The WK observation changed paused native playback position")
        current_identity = (snapshot["viewIdentity"], first["generation"], first["sourceLoads"], first["sourceLoaded"])
        if index == 0:
            identity = current_identity
        if index < 3 and current_identity != identity:
            raise ValueError("The live roundtrip replaced its native view, player or source")
    return True
