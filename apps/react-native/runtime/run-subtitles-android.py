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
import time
import urllib.request
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
from report import external_cue_selection


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
        edit("Source title", "WebVTT example")
        edit("External WebVTT URL", args.subtitle_url)
        edit("Subtitle label", "External English")
        edit("Subtitle language", "EN-us")
        ui.switch("Mark as default", True)
        edit("Start offset (seconds)", "1")
        ui.switch("Autoplay", True); ui.switch("Mute on startup", True)
        ui.button("Apply and recreate player"); ui.button("Hide configuration"); ui.top()
        result["phase"] = "external-subtitle-menu"
        before_selection = ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and v["owner"]["sample"]["externalSubtitleAvailable"])
        # Keep the finite fixture available during slower native menu traversal.
        # Core checks separately qualify autoplay; this case uses actual SDK UI.
        ui.pause_visible()
        before_selection = ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and not v["owner"]["sample"]["playing"])
        result["subtitleMenuPausedByVisibleSdkControl"] = True
        def external(tree):
            return next((n for n in tree.iter("node") if ui.visible(n) and any("external english" in n.get(k, "").casefold() for k in ["text", "content-desc"])), None)
        def subtitles(tree):
            return next((n for n in tree.iter("node") if ui.visible(n) and any(n.get(k, "").casefold().startswith("subtitles") for k in ["text", "content-desc"])), None)
        def reveal_menu_row(tree, lookup):
            # Compact WebView settings scroll inside the video viewport. A
            # clipped final row can overlap the gear's hit target; scroll that
            # real menu before tapping, rather than accepting its AX presence.
            for attempt in range(16):
                parents = {child: parent for parent in tree.iter() for child in parent}
                def menu_viewport(node):
                    while node is not None:
                        if node.get("scrollable") == "true": return ui.bounds(node)
                        node = parents.get(node)
                    return None
                node = lookup(tree)
                if node is not None and node.get("class") == "android.view.MenuItem":
                    box, viewport = ui.bounds(node), menu_viewport(node)
                    if viewport is not None and box[1] >= viewport[1] and box[3] <= viewport[3] and box[3] - box[1] >= 75:
                        return node, tree
                rows = [n for n in tree.iter("node") if n.get("class") == "android.view.MenuItem" and ui.visible(n)]
                if not rows: break
                viewport = menu_viewport(rows[0])
                if viewport is None: break
                left, top, right, bottom = viewport
                if bottom - top < 100: break
                if attempt < 4:
                    ui.adb("shell", "input", "swipe", str((left + right) // 2), str(bottom - 30),
                           str((left + right) // 2), str(top + 30), "300")
                else:
                    # Native parent scrolling can consume the gesture. The
                    # stock menu items declare tabindex=0; normal OS Tab moves
                    # browser focus and scrolls its real panel into view.
                    ui.adb("shell", "input", "keyevent", "61")
                tree = ui.tree()
            raise RuntimeError("The normal SDK menu row was not fully visible")
        # Opacity-hidden stock controls can remain in Android accessibility.
        # A first real tap may only reveal the bar; a second reaches the gear.
        settings = ui.find(ui.tree(), "Settings")
        if settings is None:
            video = next((n for n in ui.tree().iter("node") if n.get("resource-id", "").endswith("player-lab-player") and ui.visible(n)), None)
            if video is None: raise RuntimeError("The native player was outside the viewport")
            ui.tap(video)
            settings = ui.wait(lambda tree: ui.find(tree, "Settings"))
        # Keep the reveal/gear touches together: a full accessibility dump can
        # consume the stock control bar's auto-hide interval between them.
        ui.tap(settings); time.sleep(.15); ui.tap(settings)
        menu = ui.tree()
        if subtitles(menu) is None and external(menu) is None:
            settings = ui.find(menu, "Settings")
            if settings is None: raise RuntimeError("The visible SDK gear was unavailable")
            ui.tap(settings)
            menu = ui.tree()
        (output / "menu.private.xml").write_bytes(ui.adb("exec-out", "cat", "/sdcard/player-lab-runtime.xml"))
        if external(menu) is None:
            target, menu = reveal_menu_row(menu, subtitles)
            ui.tap(target)
            menu = ui.tree()
        target, menu = reveal_menu_row(menu, external)
        ui.tap(target)
        selected = ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and
                                  v["owner"]["sample"]["externalSubtitleSelected"])
        menu = ui.tree()
        if subtitles(menu) is not None or external(menu) is not None:
            settings = ui.find(menu, "Settings")
            if settings is not None: ui.tap(settings)
        ui.play_visible()
        result["externalSelectionResumedByVisibleSdkPlay"] = True
        def fresh_external_cue(value):
            try: external_cue_selection(before_selection, selected, value); return True
            except ValueError: return False
        fresh_cue = ui.wait_report(fresh_external_cue)
        external_cue_selection(before_selection, selected, fresh_cue)
        result["externalCueSelection"] = [before_selection, selected, fresh_cue]
        result["selectedExternalTrack"] = True
        result["freshCueAfterNativeSelection"] = True
        result["cueEventsObserved"] = fresh_cue["owner"]["cueEnter"]
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
            result["lastControl"], result["lastGuiAction"] = ui.last_control, ui.last_action
            if ui.last_report is not None: result["lastReport"] = ui.last_report
            if not result["passed"]:
                try: (output / "failure.private.png").write_bytes(ui.adb("exec-out", "screencap", "-p", maximum=16 * 1024 * 1024))
                except (RuntimeError, OSError, subprocess.TimeoutExpired): pass
                try: (output / "failure.private.xml").write_bytes(ui.adb("exec-out", "cat", "/sdcard/player-lab-runtime.xml"))
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
