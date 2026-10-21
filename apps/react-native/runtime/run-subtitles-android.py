#!/usr/bin/env python3
"""Check external WebVTT through the normal Android form and SDK subtitle menu."""
import argparse
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET


def safe_url(value):
    url = urlsplit(value)
    return url.scheme in {"http", "https"} and bool(url.hostname) and not any([url.username, url.password, url.query, url.fragment]) and len(value) <= 512


def fixture_lines(url):
    with urllib.request.urlopen(url, timeout=15) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024 or not raw.startswith(b"WEBVTT"):
        raise RuntimeError("A bounded plain WebVTT fixture is required")
    lines = []
    for block in re.split(r"\r?\n\s*\r?\n", raw.decode("utf-8-sig")):
        rows = block.splitlines()
        timing = next((i for i, line in enumerate(rows) if "-->" in line), None)
        if timing is not None:
            lines.extend(html.unescape(re.sub(r"<[^>]+>", "", line)).strip() for line in rows[timing + 1:] if len(line.strip()) >= 5)
    if not lines:
        raise RuntimeError("The WebVTT fixture contains no visible plain-text cue")
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--media-url", required=True)
    parser.add_argument("--subtitle-url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not safe_url(args.media_url) or not safe_url(args.subtitle_url):
        parser.error("Use credential-free HTTP(S) fixture URLs without query/fragment")
    output = args.output.resolve()
    checkout = Path(__file__).resolve().parents[3]
    if output.exists() or output == checkout or checkout in output.parents:
        parser.error("Use a new private output directory outside the checkout")
    os.umask(0o077); output.mkdir(parents=True)
    spec = importlib.util.spec_from_file_location("android_gui", Path(__file__).with_name("run-android.py"))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    result = {"schemaVersion": 1, "platform": "android", "passed": False}
    ui = None
    def edit(label, value):
        result["control"] = label
        (output / "progress.json").write_text(json.dumps({"phase": result.get("phase"), "control": label}) + "\n")
        ui.edit(label, value)
    try:
        cues = fixture_lines(args.subtitle_url)
        ui = module.Ui(args.adb, args.device)
        ui.adb("shell", "am", "force-stop", module.PACKAGE)
        ui.adb("shell", "am", "start", "-W", "-n", module.PACKAGE + "/.MainActivity")
        ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["viewReady"])
        result["phase"] = "external-subtitle-fields"
        ui.button("Show configuration")
        edit("Source URL", args.media_url)
        hls = ui.reveal("HLS")
        if hls.get("enabled") != "false": ui.tap(hls)
        edit("Source title", "Runtime subtitles")
        edit("External WebVTT URL", args.subtitle_url)
        edit("Subtitle label", "External English")
        edit("Subtitle language", "EN-us")
        ui.switch("Mark as default", True)
        edit("Start offset (seconds)", "1")
        ui.switch("Autoplay", True); ui.switch("Mute on startup", True)
        ui.button("Apply and recreate player"); ui.button("Hide configuration"); ui.top()
        result["phase"] = "external-subtitle-menu"
        ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and v["owner"]["sample"]["externalSubtitleAvailable"])
        # Operate the real stock UI. The report cannot select a track.
        for label in ["Subtitles", "Settings", "Subtitles/CC"]:
            tree = ui.tree(); node = ui.find(tree, label)
            if node is not None:
                ui.tap(node)
                break
        else:
            video = next((n for n in ui.tree().iter("node") if n.get("resource-id", "").endswith("player-lab-player") and ui.visible(n)), None)
            if video is None: raise RuntimeError("The native player was outside the viewport")
            ui.tap(video)
            node = ui.wait(lambda tree: next((n for label in ["Subtitles", "Settings"] if (n := ui.find(tree, label)) is not None), None))
            ui.tap(node)
        def external(tree):
            return next((n for n in tree.iter("node") if ui.visible(n) and any("external english" in n.get(k, "").casefold() for k in ["text", "content-desc"])), None)
        if external(ui.tree()) is None:
            subtitles = ui.wait(lambda tree: ui.find(tree, "Subtitles"))
            ui.tap(subtitles)
        ui.tap(ui.wait(external))
        selected = ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and
                                  v["owner"]["sample"]["externalSubtitleSelected"] and v["owner"]["cueEnter"] > 0)
        result["selectedExternalTrack"] = True
        result["cueEventsObserved"] = selected["owner"]["cueEnter"]
        ui.wait(lambda tree: any(ui.visible(n) and any(cue.casefold() in n.get("text", "").casefold() for cue in cues) for n in tree.iter("node")))
        ui.frame(output / "external-caption-visible.png")
        result["visibleFixtureCaption"] = True
        result["stages"] = [ui.playback("external-subtitles", output)]
        ui.button("Show configuration")
        if ui.reveal("Subtitle language").get("text") != "en-US": raise RuntimeError("The normalized subtitle language was not retained")
        ui.button("Show applied code"); ui.button("Copy code"); ui.button("Check copied code")
        ui.wait_report(lambda v: v["code"]["clipboardMatches"] is True)
        ui.edit("Subtitle label", "Unapplied subtitle"); ui.button("Reset draft")
        if ui.reveal("Subtitle label").get("text") != "External English": raise RuntimeError("Reset did not restore applied subtitle metadata")
        ui.button("Finish runtime checks")
        final = ui.wait_report(lambda v: v["owner"] is None)
        if len(final["retired"]) != final["created"] or not all(v["wrapperDestroyed"] for v in final["retired"]):
            raise RuntimeError("Normal App unmount did not retire every wrapper owner")
        result.update(passed=True, final=final, wrapperDestroyFlagsConfirmed=True, nativeReleaseAcknowledgementAvailable=False)
    except RuntimeError as failure:
        result["failure"] = str(failure)  # Fixed labels from the public GUI driver only.
    except (ValueError, OSError, subprocess.TimeoutExpired, ET.ParseError):
        result["failure"] = "External subtitle GUI qualification did not satisfy every gate"
    finally:
        if ui is not None:
            if ui.last_report is not None: result["lastReport"] = ui.last_report
            if not result["passed"]:
                try: (output / "failure.private.png").write_bytes(ui.adb("exec-out", "screencap", "-p", maximum=16 * 1024 * 1024))
                except (RuntimeError, OSError, subprocess.TimeoutExpired): pass
            try:
                ui.adb("shell", "am", "force-stop", module.PACKAGE)
                ui.adb("shell", "rm", "-f", "/sdcard/player-lab-runtime.xml")
                result["targetApplicationStopped"] = True
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                result.update(passed=False, targetApplicationStopped=False)
        (output / "runtime-report.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in {"stages", "final", "lastReport"}}, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
