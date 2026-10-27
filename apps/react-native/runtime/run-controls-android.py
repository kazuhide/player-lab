#!/usr/bin/env python3
"""Check embedded live-rewind controls and native playback using an owned running emulator."""
import argparse
import importlib.util
import json
import math
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
    sdk_port = None
    sdk_observations = None
    sdk_last_snapshot = None

    def sdk_snapshot(self):
        if self.sdk_port is None:
            pid = self.adb("shell", "pidof", driver.PACKAGE).decode().strip()
            if not pid.isdecimal():
                raise RuntimeError("Expected one owned application process")
            port = self.adb("forward", "tcp:0", "localabstract:webview_devtools_remote_" + pid).decode().strip()
            if not port.isdecimal():
                raise RuntimeError("The owned SDK debugger port was unavailable")
            self.sdk_port = int(port)
        result = driver.subprocess.run(["node", str(Path(__file__).with_name("embedded-ui.mjs")), str(self.sdk_port)],
            stdout=driver.subprocess.PIPE, stderr=driver.subprocess.DEVNULL, timeout=15)
        if result.returncode or len(result.stdout) > 128 * 1024:
            raise RuntimeError("Read-only SDK DOM observation failed")
        self.sdk_last_snapshot = json.loads(result.stdout)
        return self.sdk_last_snapshot

    def sdk_frame(self):
        tree = self.tree()
        views = [node for node in tree.iter("node") if node.get("class") == "android.webkit.WebView" and self.visible(node)]
        if not views:
            raise RuntimeError("The actual SDK WebView was unavailable")
        return self.bounds(views[0])

    def sdk_tap(self, control, frame, snapshot):
        if not control["visible"] or not control["hittable"]:
            raise RuntimeError("The SDK touch target was not visibly hittable")
        left, top, right, bottom = frame
        x, y, width, height = control["rect"]
        x, y = (x + width / 2) / snapshot["width"], (y + height / 2) / snapshot["height"]
        if not 0 <= x <= 1 or not 0 <= y <= 1:
            raise RuntimeError("The SDK touch target was outside its native viewport")
        self.adb("shell", "input", "tap", str(round(left + x * (right - left))), str(round(top + y * (bottom - top))))

    @staticmethod
    def compact_controls(snapshot):
        return [control for control in snapshot["controls"] if "bmpui-ui-playbacktogglebutton" in control["className"].split()]

    def sdk_reveal(self, frame, snapshot):
        if any(control["visible"] and control["hittable"] for control in self.compact_controls(snapshot)):
            return snapshot
        point = snapshot.get("revealPoint")
        if not point or not 0 < point["x"] < snapshot["width"] or not 0 < point["y"] < snapshot["height"]:
            raise RuntimeError("A non-activating SDK reveal point was unavailable")
        left, top, right, bottom = frame
        self.adb("shell", "input", "tap", str(round(left + point["x"] / snapshot["width"] * (right - left))),
                 str(round(top + point["y"] / snapshot["height"] * (bottom - top))))
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            snapshot = self.sdk_snapshot()
            if any(control["visible"] and control["hittable"] for control in self.compact_controls(snapshot)):
                return snapshot
            time.sleep(.1)
        raise RuntimeError("The SDK control bar did not become visible")

    def playback_control(self, play):
        before = self.report()
        identity = tuple(before["owner"][key] for key in ["generation", "sourceLoads", "sourceLoaded"])
        for _ in range(3):
            frame = self.sdk_frame()
            snapshot = self.sdk_reveal(frame, self.sdk_snapshot())
            labels = {"play", "play video"} if play else {"pause", "pause video"}
            controls = [control for control in self.compact_controls(snapshot) if control["visible"] and control["hittable"]
                and (control["label"] or "").lower() in labels]
            if len(controls) != 1:
                raise RuntimeError("The visible compact SDK playback control was unavailable")
            self.sdk_tap(controls[0], frame, snapshot)
            sequence = before["owner"]["sample"]["sequence"]
            current = self.wait_report(lambda value: value["owner"] and value["owner"]["sample"] and value["owner"]["sample"]["sequence"] > sequence)
            if tuple(current["owner"][key] for key in ["generation", "sourceLoads", "sourceLoaded"]) != identity:
                raise RuntimeError("The SDK touch crossed native owners or sources")
            if current["owner"]["sample"]["playing"] is play:
                return
            before = current
        raise RuntimeError("The native player did not acknowledge the visible SDK playback control")

    def close_sdk_observer(self):
        if self.sdk_port is not None:
            self.adb("forward", "--remove", "tcp:" + str(self.sdk_port))
            self.sdk_port = None
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

    def configure(self, url, source_type="hls"):
        self.field("source", "url"); self.edit("Source URL", url)
        self.field("source", "type")
        source_format = self.reveal("DASH" if source_type == "dash" else "HLS")
        if source_format.get("enabled") != "false":
            self.tap(source_format)
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
        self.edit("Find API operation", identifier, dismiss_keyboard=False)
        return self.by_id("api-operation-selector-option-" + identifier)

    def seekbar(self, expected):
        before = self.report()
        snapshot = self.sdk_reveal(self.sdk_frame(), self.sdk_snapshot())
        visible = any(control["visible"] and "bmpui-ui-seekbar" in control["className"].split() for control in snapshot["controls"])
        if visible is not expected:
            raise RuntimeError("The actual SDK seekbar did not match the preference")
        if self.sdk_observations is None:
            self.sdk_observations = []
        after = self.report()
        self.sdk_observations.append({**snapshot, "nativeBefore": before, "nativeAfter": after})
        first, last = before["owner"], after["owner"]
        if not first or not last or any(first[key] != last[key] for key in ["generation", "sourceLoads", "sourceLoaded"]) or not first["sample"] or not last["sample"]:
            raise RuntimeError("The SDK reveal crossed native owners or sources")
        if first["sample"]["playing"] or last["sample"]["playing"] or last["sample"]["sequence"] <= first["sample"]["sequence"] or abs(first["sample"]["time"] - last["sample"]["time"]) > .25:
            raise RuntimeError("The SDK reveal changed paused playback or reused a native observation")
        return visible

    @staticmethod
    def api_scalar(tree, identifier):
        origin = next((n for n in tree.iter("node") if n.get("resource-id", "").endswith("api-result-origin")), None)
        node = next((n for n in tree.iter("node") if n.get("resource-id", "").endswith("api-result-value")), None)
        if origin is None or origin.get("text") != identifier or node is None:
            return None
        raw = node.get("text", "") or node.get("content-desc", "").removeprefix("API result, ")
        try:
            return {"id": identifier, "value": json.loads(raw)}
        except ValueError:
            return None

    def api_query(self, identifier, accept):
        option = self.operation(identifier)
        if option.get("enabled") == "false":
            raise RuntimeError("The loaded native source API was unavailable in the picker")
        self.tap(option); self.tap_id("api-run")
        def result(tree):
            value = self.api_scalar(tree, identifier)
            return value if value and accept(value["value"]) else None
        return self.wait(result)

    def loaded_api_query(self):
        wire = self.api_query("Source.loadingState", lambda value: value == "Loaded")
        window = self.api_query("Player.getMaxTimeShift", lambda value: type(value) in {int, float} and math.isfinite(value) and value < -10)
        return {"loadingStateWire": wire, "sessionQuery": window}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default=shutil.which("adb"))
    parser.add_argument("--device", required=True)
    parser.add_argument("--media-url", required=True)
    parser.add_argument("--live-url", required=True)
    parser.add_argument("--live-type", choices=["hls", "dash"], default="hls")
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
    receipt = {"schemaVersion": 1, "platform": "android", "liveSourceType": args.live_type, "passed": False}
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
        phase("configure-live"); ui.configure(args.live_url, args.live_type)
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
        phase("loaded-source-api"); receipt["loadedSourceApi"] = ui.loaded_api_query()
        phase("native-pause-and-rewind"); ui.pause_visible()
        ui.tap(ui.operation("Player.timeShift"))
        ui.edit("Time (seconds)", "-10"); ui.tap_id("api-run")
        before = ui.wait_report(lambda v: v["owner"] and v["owner"]["sample"] and
            not v["owner"]["sample"]["playing"] and (v["owner"]["sample"]["timeShift"] or 0) < -5)
        visible = [ui.seekbar(True)]
        phase("embedded-rewind-disabled"); ui.dvr(False); disabled = ui.report(); visible.append(ui.seekbar(False))
        phase("embedded-rewind-enabled"); ui.dvr(True); enabled = ui.report(); visible.append(ui.seekbar(True))
        receipt["liveControlSamples"] = [before, disabled, enabled]
        receipt["liveControls"] = live_rewind_transition(before, disabled, enabled, visible)
        phase("configure-vod"); ui.configure(args.media_url); ui.dvr(False)
        vod = ui.wait_report(lambda v: v["owner"] and v["owner"]["sample"] and not v["owner"]["sample"]["live"] and
                             v["owner"]["sourceLoaded"] > 0 and v["owner"]["sample"]["playing"])
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
            receipt["embeddedUiObservations"] = ui.sdk_observations
            receipt["lastEmbeddedUi"] = ui.sdk_last_snapshot
            try:
                ui.close_sdk_observer()
            except (RuntimeError, OSError, driver.subprocess.TimeoutExpired):
                receipt.update(passed=False, failure="Owned SDK debugger cleanup could not be requested")
            try:
                ui.adb("shell", "am", "force-stop", driver.PACKAGE)
            except (RuntimeError, OSError, driver.subprocess.TimeoutExpired):
                receipt.update(passed=False, failure="Dedicated target cleanup could not be requested")
        (output / "runtime-report.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"passed": receipt["passed"], "platform": "android"}))
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
