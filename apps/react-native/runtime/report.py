"""Validate the public, deliberately small runtime report. Never copy SDK payloads."""
import math


def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected.split()):
        raise ValueError("Unexpected runtime report shape")


def validate_report(value):
    _keys(value, "protocol created retired owner app lifecycle code batch")
    if value["protocol"] != 1 or value["lifecycle"] not in {"active", "inactive", "background", "unknown"}:
        raise ValueError("Unsupported runtime report")
    if type(value["created"]) is not int or not 0 <= value["created"] <= 10000:
        raise ValueError("Invalid owner count")
    if not isinstance(value["retired"], list) or len(value["retired"]) > 32:
        raise ValueError("Invalid retirement report")
    for owner in value["retired"]:
        _keys(owner, "generation wrapperDestroyed")
        if type(owner["generation"]) is not int or type(owner["wrapperDestroyed"]) is not bool:
            raise ValueError("Invalid retirement values")
    if value["app"] is not None:
        app = value["app"]
        _keys(app, "ui revision dvrAllowed logCount sourceType startOffset autoplay startupMuted forwardBuffer maxBitrate externalSubtitleConfigured")
        if app["ui"] not in {"Default", "Sports", "Live (DVR)", "Cinema"} or app["sourceType"] not in {"hls", "dash", "progressive"}:
            raise ValueError("Unexpected app selection")
        for name in ["dvrAllowed", "autoplay", "startupMuted", "externalSubtitleConfigured"]:
            if type(app[name]) is not bool:
                raise ValueError("Invalid app flag")
        for name in ["revision", "logCount", "startOffset", "forwardBuffer", "maxBitrate"]:
            number(app[name], nullable=name in {"startOffset", "forwardBuffer", "maxBitrate"})
    code = value["code"]
    _keys(code, "generation clipboardMatches readFailed")
    if type(code["generation"]) is not int or (code["clipboardMatches"] is not None and type(code["clipboardMatches"]) is not bool) or type(code["readFailed"]) is not bool:
        raise ValueError("Invalid code observation")
    if value["owner"] is not None:
        owner = value["owner"]
        _keys(owner, "generation viewReady sourceLoads sourceLoaded timeChanged cueEnter errors readFailures errorCodes sample")
        if type(owner["viewReady"]) is not bool:
            raise ValueError("Invalid view readiness")
        for name in ["generation", "sourceLoads", "sourceLoaded", "timeChanged", "cueEnter", "errors", "readFailures"]:
            if type(owner[name]) is not int or owner[name] < 0:
                raise ValueError("Invalid event count")
        if not isinstance(owner["errorCodes"], list) or len(owner["errorCodes"]) > 8 or any(type(n) is not int or not 0 <= n <= 1000000000 for n in owner["errorCodes"]):
            raise ValueError("Invalid numeric error code")
        if owner["sample"] is not None:
            validate_sample(owner["sample"])
    if value["batch"] is not None:
        batch = value["batch"]
        _keys(batch, "id generation samples")
        if type(batch["id"]) is not int or batch["id"] < 1 or type(batch["generation"]) is not int or not isinstance(batch["samples"], list) or len(batch["samples"]) != 5:
            raise ValueError("Invalid public getter batch")
        for sample in batch["samples"]:
            validate_sample(sample)
    return value


def validate_sample(sample):
    _keys(sample, "sequence time duration live playing muted subtitleCount externalSubtitleAvailable externalSubtitleSelected")
    for name in ["sequence", "subtitleCount"]:
        if type(sample[name]) is not int or sample[name] < 0:
            raise ValueError("Invalid sample counter")
    for name in ["time", "duration"]:
        number(sample[name], nullable=True)
    for name in ["live", "playing", "muted", "externalSubtitleAvailable", "externalSubtitleSelected"]:
        if type(sample[name]) is not bool:
            raise ValueError("Invalid native getter flag")


def batch_reports(value):
    import copy
    validate_report(value)
    batch, owner = value["batch"], value["owner"]
    if batch is None or owner is None or batch["generation"] != owner["generation"]:
        raise ValueError("The getter batch does not belong to the current owner")
    rows = []
    for sample in batch["samples"]:
        row = copy.deepcopy(value)
        row["batch"] = None
        row["owner"]["sample"] = sample
        rows.append(row)
    return rows


def number(value, nullable=False):
    if value is None and nullable:
        return
    if type(value) not in {int, float} or not math.isfinite(value):
        raise ValueError("Invalid numeric observation")


def playback_samples(samples):
    if len(samples) != 5:
        raise ValueError("Five playback samples are required")
    owners, sequences, times = [], [], []
    for value in samples:
        validate_report(value)
        owner = value["owner"]
        sample = owner and owner["sample"]
        if not sample or owner["errors"] != 0 or owner["sourceLoaded"] < 1 or not sample["playing"] or sample["live"] or sample["muted"] is not True:
            raise ValueError("Native finite playback was not established")
        if sample["duration"] is None or not 59 < sample["duration"] < 61 or sample["time"] is None:
            raise ValueError("The named 60-second fixture is required")
        owners.append(owner["generation"])
        sequences.append(sample["sequence"])
        times.append(sample["time"])
    if len(set(owners)) != 1 or any(b <= a for a, b in zip(sequences, sequences[1:])) or any(b < a for a, b in zip(times, times[1:])) or times[-1] <= times[0] + 2:
        raise ValueError("Current-owner playback did not advance")
    return {"owner": owners[0], "times": times, "duration": samples[-1]["owner"]["sample"]["duration"]}


def external_cue_selection(before, selected, after):
    """Bind a new cue to the selected external track's current source epoch."""
    identity = None
    for index, value in enumerate([before, selected, after]):
        validate_report(value)
        owner = value["owner"]
        if owner is None or owner["sample"] is None or owner["errors"] or owner["readFailures"] or owner["sourceLoaded"] < 1:
            raise ValueError("The external cue requires a current successful source")
        current = tuple(owner[key] for key in ["generation", "sourceLoads", "sourceLoaded"])
        if identity is None: identity = current
        if current != identity or not owner["sample"]["externalSubtitleAvailable"]:
            raise ValueError("External subtitle selection crossed the owner or source epoch")
        if index > 0 and not owner["sample"]["externalSubtitleSelected"]:
            raise ValueError("The external track must remain natively selected")
    if after["owner"]["cueEnter"] <= max(before["owner"]["cueEnter"], selected["owner"]["cueEnter"]) or after["owner"]["sample"]["sequence"] <= selected["owner"]["sample"]["sequence"]:
        raise ValueError("A fresh native cue after selected-track observation is required")


def configuration_stage(samples, ui, dvr_allowed, minimum_log_count=0):
    observation = playback_samples(samples)
    expected = {"ui": ui, "revision": 1, "sourceType": "hls", "startOffset": 5, "autoplay": True,
                "startupMuted": True, "forwardBuffer": 8, "maxBitrate": 2500000,
                "externalSubtitleConfigured": False, "dvrAllowed": dvr_allowed}
    for value in samples:
        app = value["app"]
        if app is None or any(app[key] != expected_value for key, expected_value in expected.items()):
            raise ValueError("The recreated App did not retain the expected applied settings and UI")
        if app["logCount"] < minimum_log_count:
            raise ValueError("The recreated App lost its existing log")
    return observation


def configuration_stages(stages):
    if [stage["stage"] for stage in stages] != ["default", "sports", "default-return", "foreground"]:
        raise ValueError("The four expected native GUI playback stages were not completed")
    owners, previous_logs = [], 0
    for index, stage in enumerate(stages):
        observation = configuration_stage(stage["samples"], "Sports" if index == 1 else "Default", index == 0, previous_logs)
        previous_logs = stage["samples"][-1]["app"]["logCount"]
        owners.append(observation["owner"])
    if owners[0] == owners[1] or owners[1] == owners[2] or owners[2] != owners[3]:
        raise ValueError("UI replacement and foreground ownership did not match the expected generations")
