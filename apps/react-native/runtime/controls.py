"""Bind real embedded-control observations to fresh native owner/source samples."""
from report import validate_report


def live_rewind_transition(before, disabled, enabled, visible):
    identity = None
    sequence = -1
    for value in [before, disabled, enabled]:
        validate_report(value)
        owner = value["owner"]
        sample = owner and owner["sample"]
        if not sample or owner["errors"] or owner["readFailures"] or not sample["live"] or sample["playing"]:
            raise ValueError("A successful paused native live source is required")
        current = tuple(owner[key] for key in ["generation", "sourceLoads", "sourceLoaded"])
        if identity is None:
            identity = current
        if current != identity or current[1] < 1 or current[2] < 1 or sample["sequence"] <= sequence:
            raise ValueError("The control toggle crossed an owner/source or reused a native sample")
        sequence = sample["sequence"]
        if sample["maxTimeShift"] is None or sample["maxTimeShift"] >= -10 or sample["timeShift"] is None or sample["timeShift"] >= -5:
            raise ValueError("The actual native live source must remain rewound across the toggle")
    if visible != [True, False, True]:
        raise ValueError("The embedded SDK seekbar must hide and return")
    if [value["app"]["dvrAllowed"] for value in [before, disabled, enabled]] != [True, False, True]:
        raise ValueError("The host preference was not applied")
    return {"owner": identity[0], "sourceLoads": identity[1], "sourceLoaded": identity[2], "seekbarVisible": visible}


def vod_controls(value, seekbar_visible, skip_unavailable, schedule_unavailable):
    validate_report(value)
    owner = value["owner"]
    sample = owner and owner["sample"]
    if not sample or sample["live"] or owner["errors"] or owner["readFailures"] or not owner["sourceLoaded"]:
        raise ValueError("A successful ordinary native VOD source is required")
    if value["app"]["dvrAllowed"] or not seekbar_visible or not skip_unavailable or not schedule_unavailable:
        raise ValueError("VOD seeking and ordinary-source ad availability were not established")
    return {"owner": owner["generation"], "seekbarVisible": True, "skipAdUnavailable": True, "scheduleAdUnavailable": True}
