"""Fail-closed validation for the opt-in, public-SDK Vega observations."""
import math


def keys(value, names):
    if not isinstance(value, dict) or set(value) != set(names.split()):
        raise ValueError("Unexpected runtime report shape")


def integer(value):
    return type(value) is int and 0 <= value <= 1000000000


def number(value):
    return type(value) in {int, float} and math.isfinite(value)


def validate(value):
    keys(value, "protocol created owner retired setupErrors app codeGeneration")
    if value["protocol"] != 1 or not all(integer(value[k]) for k in ["created", "setupErrors", "codeGeneration"]):
        raise ValueError("Invalid runtime counters")
    app = value["app"]
    if app is not None:
        keys(app, "dvrAllowed logCount sourceType startOffset autoplay startupMuted videoForwardBuffer audioForwardBuffer maxVideoBitrate externalSubtitleConfigured")
        if not integer(app["logCount"]) or app["sourceType"] not in {"hls", "dash", "progressive"}:
            raise ValueError("Invalid applied runtime state")
        if not all(type(app[k]) is bool for k in ["dvrAllowed", "autoplay", "startupMuted", "externalSubtitleConfigured"]):
            raise ValueError("Invalid applied runtime flags")
        if not all(app[k] is None or number(app[k]) for k in ["startOffset", "videoForwardBuffer", "audioForwardBuffer", "maxVideoBitrate"]):
            raise ValueError("Invalid applied numeric settings")
    if not isinstance(value["retired"], list) or len(value["retired"]) > 32:
        raise ValueError("Invalid retired owners")
    for retired in value["retired"]:
        keys(retired, "generation releaseConfirmed")
        if not integer(retired["generation"]) or type(retired["releaseConfirmed"]) is not bool:
            raise ValueError("Invalid release observation")
    owner = value["owner"]
    if owner is not None:
        keys(owner, "generation sourceLoaded cueEnter timeShifted cueVisible errors errorCodes readFailures sample")
        if not all(integer(owner[k]) for k in ["generation", "sourceLoaded", "cueEnter", "timeShifted", "errors", "readFailures"]) or type(owner["cueVisible"]) is not bool:
            raise ValueError("Invalid current owner")
        if not isinstance(owner["errorCodes"], list) or len(owner["errorCodes"]) > 8 or not all(integer(v) for v in owner["errorCodes"]):
            raise ValueError("Invalid SDK error counters")
        sample = owner["sample"]
        if sample is not None:
            keys(sample, "sequence time duration live playing muted maxTimeShift timeShift decodedFrames subtitleCount externalSubtitleAvailable externalSubtitleEnabled")
            if not all(integer(sample[k]) for k in ["sequence", "subtitleCount"]):
                raise ValueError("Invalid native sample counters")
            if not all(type(sample[k]) is bool for k in ["live", "playing", "muted", "externalSubtitleAvailable", "externalSubtitleEnabled"]):
                raise ValueError("Invalid native sample flags")
            if not all(sample[k] is None or number(sample[k]) for k in ["time", "duration", "maxTimeShift", "timeShift", "decodedFrames"]):
                raise ValueError("Invalid native sample values")
    return value


def live_controls(value, generation, allowed, buttons):
    validate(value)
    owner = value["owner"]
    if value["setupErrors"] or owner is None or owner["generation"] != generation or owner["sourceLoaded"] < 1 or owner["errors"] or owner["readFailures"]:
        raise ValueError("Live control observations must retain the loaded native owner")
    sample = owner["sample"]
    if sample is None or not sample["live"] or sample["maxTimeShift"] is None or sample["maxTimeShift"] >= 0:
        raise ValueError("A real live DVR window is required for control verification")
    if value["app"] is None or value["app"]["dvrAllowed"] is not allowed:
        raise ValueError("The normal live rewind switch must update App state")
    if set(buttons) != {"-10s", "-30s", "-60s"} or any(type(enabled) is not bool or enabled is not allowed for enabled in buttons.values()):
        raise ValueError("Every real native rewind button must match the live rewind switch")


def shift_completed(before, after, generation, offset):
    validate(before); validate(after)
    owners = [before["owner"], after["owner"]]
    if any(owner is None or owner["generation"] != generation or owner["sourceLoaded"] < 1 or owner["errors"] or owner["readFailures"] for owner in owners):
        return False
    previous, current = owners
    if current["timeShifted"] <= previous["timeShifted"]:
        return False
    reference, sample = previous["sample"], current["sample"]
    if reference is None or sample is None or not all(s["live"] and number(s["time"]) and number(s["timeShift"]) for s in [reference, sample]):
        return False
    # Fix the SDK media-time target before pressing the real control. A moving
    # live edge must not let an unrelated relative offset satisfy the request.
    target = reference["time"] - reference["timeShift"] + offset
    return sample["sequence"] > reference["sequence"] and abs(sample["time"] - target) < 4


def applied(value, dvr):
    validate(value)
    expected = {"sourceType": "hls", "startOffset": 1, "autoplay": True, "startupMuted": True,
                "videoForwardBuffer": 8, "audioForwardBuffer": 8, "maxVideoBitrate": 2500000,
                "externalSubtitleConfigured": True, "dvrAllowed": dvr}
    if value["app"] is None or any(value["app"][k] != v for k, v in expected.items()):
        raise ValueError("Applied settings were not retained")


def playback(values, dvr):
    if len(values) != 5:
        raise ValueError("Five actual native samples are required")
    generation, sequences, times, frames = None, [], [], []
    for value in values:
        applied(value, dvr)
        owner = value["owner"]
        if value["setupErrors"] or owner is None or owner["errors"] or owner["readFailures"] or owner["sourceLoaded"] < 1:
            raise ValueError("Current playback has a setup/read/SDK error")
        if generation is None: generation = owner["generation"]
        if owner["generation"] != generation:
            raise ValueError("Playback observations crossed owners")
        sample = owner["sample"]
        if sample is None or sample["live"] or not sample["playing"] or not sample["muted"] or not sample["externalSubtitleAvailable"] or not sample["externalSubtitleEnabled"]:
            raise ValueError("Current finite muted subtitle playback was not observed")
        if sample["duration"] is None or not 59 < sample["duration"] < 61 or sample["time"] is None or sample["decodedFrames"] is None:
            raise ValueError("The expected one-minute native fixture was not observed")
        sequences.append(sample["sequence"]); times.append(sample["time"]); frames.append(sample["decodedFrames"])
    if any(b <= a for a, b in zip(sequences, sequences[1:])) or times[-1] - times[0] <= 2 or frames[-1] <= frames[0]:
        raise ValueError("Fresh native clocks and decoded frames must advance")
    return generation


def released(value):
    validate(value)
    if value["owner"] is not None or value["setupErrors"] or value["created"] < 1 or len(value["retired"]) != value["created"]:
        raise ValueError("Every created owner must retire")
    if sorted(v["generation"] for v in value["retired"]) != list(range(1, value["created"] + 1)) or not all(v["releaseConfirmed"] for v in value["retired"]):
        raise ValueError("The actual SDK/native release barrier must acknowledge every owner")
