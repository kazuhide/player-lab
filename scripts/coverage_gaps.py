"""Bind bilingual GUI gap explanations to the unchanged public API inventory."""
import re

from coverage_report import (
    CATEGORIES, STATUSES, _array, _date, _hash, _id, _object, _official,
    _require, _text, summarize,
)


def needs_gui_route(row):
    """Identify incomplete input routes or API results that users cannot inspect."""
    _require(isinstance(row, dict), "Expected an API row object.")
    category, status = row.get("category"), row.get("status")
    _require(category in CATEGORIES and status in STATUSES, "Unknown API category or status.")
    if category in ("configuration", "command"):
        return status != "direct"
    return status not in ("direct", "preset", "observed")


def _reason_id(value):
    _require(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", value),
             "Reason IDs must be stable lowercase kebab-case identifiers.")
    return value


def validate_gaps(data, report):
    """Return app/API reason records after exact coverage and report-hash checks.

    The report must first pass the existing public API evidence validator. Gap
    explanations never change its statuses, denominators or runtime evidence.
    """
    _object(data, {"schemaVersion", "checkedAt", "reportInputSha256", "reasons", "applications"})
    _require(type(data["schemaVersion"]) is int and data["schemaVersion"] == 1,
             "Unsupported gap schemaVersion.")
    _require(_date(data["checkedAt"]) >= _date(report["checkedAt"]),
             "Gap check date precedes the report check date.")
    _hash(data["reportInputSha256"])
    _require(data["reportInputSha256"] == summarize(report)["inputSha256"],
             "Gap report hash is stale or belongs to another API inventory.")

    reasons = data["reasons"]
    _require(isinstance(reasons, dict), "Expected a gap reason catalog object.")
    for identifier, reason in reasons.items():
        _reason_id(identifier)
        _object(reason, {"kind", "en", "ja", "references"})
        _require(reason["kind"] in ("implementation", "input-contract"), "Unknown gap reason kind.")
        for language in ("en", "ja"):
            _object(reason[language], {"reason", "action"})
            for text in reason[language].values():
                _text(text)
        for reference in _array(reason["references"]):
            _official(reference)

    expected = {}
    for app in _array(report["applications"]):
        app_id = _id(app["id"])
        _require(app_id not in expected, "Duplicate application in the API report.")
        expected[app_id] = set()
        members = set()
        for row in _array(app["rows"]):
            member = _id(row["id"])
            _require(member not in members, "Duplicate API in the report: " + app_id)
            members.add(member)
            if needs_gui_route(row):
                expected[app_id].add(member)

    result, used_reasons = {}, set()
    for app in _array(data["applications"]):
        _object(app, {"id", "groups"})
        app_id = _id(app["id"])
        _require(app_id in expected, "Unknown application in gap explanations: " + app_id)
        _require(app_id not in result, "Duplicate application in gap explanations: " + app_id)
        mapping = {}
        for group in _array(app["groups"]):
            _object(group, {"reason", "apis"})
            reason_id = _reason_id(group["reason"])
            _require(reason_id in reasons, "Unknown gap reason: " + reason_id)
            apis = _array(group["apis"])
            _require(bool(apis), "Gap reason groups must contain API IDs.")
            for member in apis:
                _id(member)
                _require(member not in mapping, "Duplicate API gap explanation in " + app_id + ": " + member)
                _require(member in expected[app_id],
                         "Gap explanation includes an excluded, unknown or fully exposed API: " + member)
                mapping[member] = {"id": reason_id, **reasons[reason_id]}
            used_reasons.add(reason_id)
        _require(set(mapping) == expected[app_id], "Gap explanations are incomplete for " + app_id)
        result[app_id] = mapping
    _require(set(result) == set(expected), "Gap application IDs do not match the report.")
    _require(used_reasons == set(reasons), "Gap catalog contains unused reasons.")
    return result
