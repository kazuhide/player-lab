#!/usr/bin/env python3
"""Check embedded live-rewind controls and native playback using an owned running emulator."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import time
import traceback
from urllib.parse import urlsplit

from controls import live_rewind_transition, vod_controls

spec = importlib.util.spec_from_file_location("configuration_driver", Path(__file__).with_name("run-android.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class ControlsUi(driver.Ui):
    INPUT_LABELS = driver.Ui.INPUT_LABELS | {"Find API operation", "Time (seconds)"}
    def top(self):
        pass  # The workspace keeps its native player above the selected editor.

    def by_id(self, identifier):
        return self.wait(lambda tree: next((n for n in tree.iter("node") if n.get("resource-id", "").endswith(identifier) and self.visible(n)), None))

    def tap_id(self, identifier):
        node = self.by_id(identifier)
        if node.get("enabled") == "false":
            raise RuntimeError("The selected workspace control is unavailable")
        self.tap(node)

    def choice(self, identifier, selected):
        self.tap_id(identifier)
        self.tap_id(identifier + "-option-" + selected)

    def field(self, group, selected):
        self.tap_id("workspace-nav-settings")
        self.choice("configuration-group-selector", group)
        self.choice("workspace-setting-selector", selected)

    def configure(self, url):
        self.field("source", "url"); self.edit("Source URL", url)
        self.field("source", "type")
        hls = self.reveal("HLS")
        if hls.get("enabled") != "false":
            self.tap(hls)
        self.field("source", "startOffset"); self.edit("Start offset (seconds)", "")
        self.field("player", "autoplay"); self.switch("Autoplay", True)
        self.field("player", "muted"); self.switch("Mute on startup", True)
        self.tap_id("configuration-apply")

    def dvr(self, enabled):
        self.tap_id("workspace-nav-more"); self.switch("Allow DVR", enabled)

    def operation(self, identifier):
        self.tap_id("workspace-nav-apis")
        self.choice("api-view-selector", "operations")
        self.tap_id("api-operation-selector")
        self.edit("Find API operation", identifier)
        return self.by_id("api-operation-selector-option-" + identifier)

    def seekbar(self, expected):
        def observed(tree):
            webviews = [n for n in tree.iter("node") if n.get("class") == "android.webkit.WebView"]
            bars = [n for view in webviews for n in view.iter("node") if self.visible(n) and
                    (n.get("class", "").endswith("SeekBar") or n.get("content-desc", "").lower() in {"seek bar", "seekbar"})]
            return {"visible": bool(bars)} if bool(bars) is expected and webviews else None
        return self.wait(observed)["visible"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default=shutil.which("adb"))
    parser.add_argument("--device", required=True)
    parser.add_argument("--media-url", required=True)
    parser.add_argument("--live-url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for raw in [args.media_url, args.live_url]:
        url = urlsplit(raw)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or len(raw) > 512:
            parser.error("Supply credential-free HTTP(S) fixtures without query/fragment")
    root = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    if not args.adb or output.exists() or output == root or root in output.parents:
        parser.error("Supply adb and a new private output directory outside the checkout")
    os.umask(0o077); output.mkdir(parents=True)
    receipt = {"schemaVersion": 1, "platform": "android", "passed": False}
    def phase(name):
        receipt["phase"] = name
        (output / "progress.json").write_text(json.dumps({"phase": name}) + "\n")
    ui = None
    try:
        phase("launch-and-readiness")
        ui = ControlsUi(args.adb, args.device)
        ui.adb("shell", "am", "force-stop", driver.PACKAGE)
        ui.adb("shell", "am", "start", "-W", "-n", driver.PACKAGE + "/.MainActivity")
        ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["viewReady"])
        phase("configure-live"); ui.configure(args.live_url)
        ui.choice("theme-selector", "Live (DVR)")
        phase("native-live-playback")
        live = ui.wait_report(lambda v: v["owner"] and v["owner"]["sample"] and v["owner"]["sample"]["live"] and
                              v["owner"]["sample"]["playing"] and (v["owner"]["sample"]["maxTimeShift"] or 0) < -10)
        frames = [ui.frame(output / "live-playing-before.png")]
        time.sleep(1.5)
        advanced = ui.wait_report(lambda v: v["owner"] and v["owner"]["sample"] and
            v["owner"]["generation"] == live["owner"]["generation"] and
            v["owner"]["sample"]["sequence"] > live["owner"]["sample"]["sequence"] and
            v["owner"]["sample"]["time"] > live["owner"]["sample"]["time"])
        frames.append(ui.frame(output / "live-playing-after.png"))
        ratio = sum(abs(a - b) > 12 for a, b in zip(*frames)) / len(frames[0])
        if ratio <= .01:
            raise RuntimeError("The native video did not change with its live clock")
        receipt["livePlayback"] = {"samples": [live, advanced], "videoRegionChangedRatio": ratio}
        phase("native-pause-and-rewind"); ui.pause_visible()
        ui.tap(ui.operation("Player.timeShift"))
        ui.edit("Time (seconds)", "-10"); ui.tap_id("api-run")
        before = ui.wait_report(lambda v: v["owner"] and v["owner"]["sample"] and
            not v["owner"]["sample"]["playing"] and (v["owner"]["sample"]["timeShift"] or 0) < -5)
        visible = [ui.seekbar(True)]
        phase("embedded-rewind-disabled"); ui.dvr(False); disabled = ui.report(); visible.append(ui.seekbar(False))
        phase("embedded-rewind-enabled"); ui.dvr(True); enabled = ui.report(); visible.append(ui.seekbar(True))
        receipt["liveControls"] = live_rewind_transition(before, disabled, enabled, visible)
        receipt["liveControlSamples"] = [before, disabled, enabled]
        phase("configure-vod"); ui.configure(args.media_url); ui.dvr(False)
        vod = ui.wait_report(lambda v: v["owner"] and v["owner"]["sample"] and not v["owner"]["sample"]["live"] and
                             v["owner"]["sourceLoaded"] > 0)
        ui.pause_visible(); vod_visible = ui.seekbar(True)
        phase("ordinary-source-ad-availability"); unavailable = []
        for identifier in ["Player.skipAd", "Player.scheduleAd"]:
            option = ui.operation(identifier)
            unavailable.append(option.get("enabled") == "false")
            ui.button("Close")
        receipt["vodControls"] = vod_controls(vod, vod_visible, *unavailable)
        receipt["vodSample"] = vod
        phase("normal-owner-cleanup"); ui.tap_id("workspace-nav-settings"); ui.button("Finish runtime checks")
        final = ui.wait_report(lambda v: v["owner"] is None)
        if len(final["retired"]) != final["created"] or not all(owner["wrapperDestroyed"] for owner in final["retired"]):
            raise RuntimeError("The normal owner cleanup was not confirmed")
        receipt.update(final=final, passed=True, nativeReleaseAcknowledgementAvailable=False)
    except (RuntimeError, ValueError, KeyError, TypeError, OSError, driver.subprocess.TimeoutExpired) as error:
        receipt["failure"] = "Native controls qualification failed; private evidence is retained"
        receipt["failureReason"] = str(error)
        (output / "failure.private.log").write_text(traceback.format_exc())
        if ui:
            (output / "last.private.xml").write_bytes(driver.ET.tostring(ui.last_tree)) if ui.last_tree is not None else None
            receipt["lastObservation"] = ui.last_report
            receipt["lastControl"] = ui.last_control
            receipt["lastAction"] = ui.last_action
    finally:
        if ui:
            try:
                ui.adb("shell", "am", "force-stop", driver.PACKAGE)
            except (RuntimeError, OSError, driver.subprocess.TimeoutExpired):
                receipt.update(passed=False, failure="Dedicated target cleanup could not be requested")
        (output / "runtime-report.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"passed": receipt["passed"], "platform": "android"}))
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
