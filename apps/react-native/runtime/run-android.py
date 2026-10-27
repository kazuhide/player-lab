#!/usr/bin/env python3
"""Drive the opt-in Expo entry using Android's public input/accessibility tools."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

from report import batch_reports, configuration_stage, configuration_stages, playback_samples, validate_report

PACKAGE = "com.playerlab.reactnative"


class Ui:
    INPUT_LABELS = {"Source URL", "Source title", "Poster URL", "External WebVTT URL", "Subtitle label",
                    "Subtitle language", "Start offset (seconds)", "Forward buffer (seconds)",
                    "Maximum bitrate (bits per second)"}
    def __init__(self, adb, serial):
        self.prefix = [adb, "-s", serial]
        self.last_report = None
        self.last_tree = None
        self.last_control, self.last_action = None, None
        size = self.adb("shell", "wm", "size").decode()
        match = re.search(r"(\d+)x(\d+)", size)
        if not match:
            raise RuntimeError("Cannot determine the dedicated device viewport")
        self.width, self.height = map(int, match.groups())
        self.scroll_top, self.bottom = 0, self.height
        self.keyboard_visible = False

    def adb(self, *args, maximum=4 * 1024 * 1024):
        result = subprocess.run([*self.prefix, *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
        if result.returncode or len(result.stdout) > maximum:
            raise RuntimeError("Android tool did not return a bounded successful result")
        return result.stdout

    def tree(self):
        self.adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/player-lab-runtime.xml")
        tree = ET.fromstring(self.adb("exec-out", "cat", "/sdcard/player-lab-runtime.xml"))
        self.scroll_top, self.bottom = 0, self.height
        scroll = next((n for n in tree.iter("node") if n.get("resource-id", "").endswith("player-lab-screen")), None)
        if scroll is not None:
            bounds = self.bounds(scroll)
            if len(bounds) == 4 and bounds[3] > bounds[1]: self.scroll_top, self.bottom = bounds[1], min(bounds[3], self.height)
        # Edge-to-edge Android can retain full ScrollView bounds behind the IME,
        # and uiautomator's compressed App tree omits the keyboard window.
        display = self.adb("shell", "dumpsys", "window", "displays").decode(errors="replace")
        ime_tops = []
        for line in display.splitlines():
            if "type=ime" in line.lower() and "visible=true" in line.lower():
                match = re.search(r"frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]", line, re.IGNORECASE)
                if match and 0 < int(match.group(2)) < self.height: ime_tops.append(int(match.group(2)))
        self.keyboard_visible = bool(ime_tops)
        if ime_tops: self.bottom = min(self.bottom, min(ime_tops))
        self.last_tree = tree
        return tree

    @staticmethod
    def bounds(node):
        return tuple(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))

    def visible(self, node):
        bounds = self.bounds(node)
        return len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1] and bounds[0] < self.width and 0 <= (bounds[1] + bounds[3]) / 2 < self.bottom

    def find(self, tree, label):
        # A caption can be visible while its EditText is clipped. It must never
        # substitute for the input: a tap would leave the previous field focused.
        if label in self.INPUT_LABELS:
            return next((node for node in tree.iter("node") if node.get("class") == "android.widget.EditText" and
                node.get("content-desc") == label and self.visible(node) and
                self.bounds(node)[1] >= self.scroll_top and self.bounds(node)[3] <= self.bottom and
                self.bounds(node)[3] - self.bounds(node)[1] >= 40), None)
        for key in ["content-desc", "text"]:
            match = next((node for node in tree.iter("node") if self.visible(node) and node.get(key, "").casefold() == label.casefold()), None)
            if match is not None:
                return match
        return None

    def assert_configuration_footer(self, tree):
        """Fixed actions must fit above the IME without scrolling the editor."""
        window = next(tree.iter("node"), None)
        viewport = self.bounds(window) if window is not None else ()
        if len(viewport) == 4:
            viewport = (*viewport[:3], min(viewport[3], getattr(self, "bottom", viewport[3])))
        ids = ("configuration-actions", "configuration-reset", "configuration-apply")
        controls = {identifier: next((node for node in tree.iter("node")
            if node.get("resource-id", "").endswith(identifier)), None) for identifier in ids}
        for node in controls.values():
            box = self.bounds(node) if node is not None else ()
            if len(viewport) != 4 or len(box) != 4 or not (viewport[0] <= box[0] < box[2] <= viewport[2]
                    and viewport[1] <= box[1] < box[3] <= viewport[3] and box[3] - box[1] >= 40):
                raise RuntimeError("The fixed configuration actions are missing or clipped")
        scroll = next((node for node in tree.iter("node")
            if node.get("resource-id", "").endswith("configuration-fields-scroll")), None)
        scroll_box = self.bounds(scroll) if scroll is not None else ()
        moves_with_editor = scroll is not None and any(node in controls.values() for node in scroll.iter("node"))
        if (len(scroll_box) != 4 or moves_with_editor
                or scroll_box[3] > self.bounds(controls["configuration-actions"])[1] + 1):
            raise RuntimeError("The fixed configuration actions overlap or scroll with the editor")

    def tap(self, node):
        left, top, right, bottom = self.bounds(node)
        self.adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))

    def wait(self, predicate, seconds=40):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = predicate(self.tree())
            if value is not None and value is not False:
                return value
            time.sleep(.2)
        raise RuntimeError("Normal Android GUI observation deadline exceeded")

    def swipe(self, down=False):
        start, end = (.35, .8) if down else (.8, .35)
        available = self.bottom - self.scroll_top
        self.adb("shell", "input", "swipe", str(self.width - 8), str(int(self.scroll_top + available * start)),
                 str(self.width - 8), str(int(self.scroll_top + available * end)), "300")

    def reveal(self, label, upwards=False):
        for direction in [upwards, not upwards]:
            for _ in range(8):
                found = self.find(self.tree(), label)
                if found is not None:
                    return found
                self.swipe(direction)
        raise RuntimeError("Normal App control remained outside its viewport")

    def button(self, label):
        node = self.reveal(label, upwards=label in {"Hide configuration", "Sports", "Default"})
        if node.get("enabled") == "false":
            raise RuntimeError("Normal App button is disabled")
        self.tap(node)

    def top(self):
        for _ in range(20):
            if self.find(self.tree(), "Sports") is not None:
                return
            self.swipe(True)
        raise RuntimeError("The normal App header was unreachable")

    @staticmethod
    def input_acknowledged(tree, label, expected):
        for node in tree.iter("node"):
            if node.get("class") != "android.widget.EditText" or node.get("content-desc") != label or node.get("focused") != "true":
                continue
            text, hint = node.get("text", ""), node.get("hint", "")
            # Android AX exposes an empty input's placeholder as its text.
            if text == expected or (expected == "" and hint and text == hint):
                return True
        return False

    def edit(self, label, text, dismiss_keyboard=True):
        self.last_control, self.last_action = label, "focus"
        self.tap(self.reveal(label, upwards=label in {"Source URL", "Source title"}))
        keyboard_deadline = time.monotonic() + 2
        while time.monotonic() < keyboard_deadline:
            self.tree()
            if self.keyboard_visible: break
            time.sleep(.1)
        # The target was visible when tapped. Edge-to-edge Android may cover it
        # with the IME at the end of a form; OS typing still targets that input.
        self.last_action = "clear"
        self.adb("shell", "input", "keycombination", "113", "29")
        self.adb("shell", "input", "keyevent", "67")
        def acknowledged(tree, expected):
            # Android can scroll a focused input during IME/layout animation.
            # Read that exact focused input; typing still uses normal OS input.
            return self.input_acknowledged(tree, label, expected)
        self.wait(lambda tree: acknowledged(tree, ""))
        # React controlled inputs must acknowledge each edit before the next one.
        self.last_action = "type"
        for index, character in enumerate(text):
            self.adb("shell", "input text " + shlex.quote(character.replace(" ", "%s")))
            prefix = text[:index + 1]
            if index == 0:
                self.wait(lambda tree: acknowledged(tree, prefix))
            time.sleep(.1)
        self.wait(lambda tree: acknowledged(tree, text))
        self.tree()
        if self.keyboard_visible and dismiss_keyboard:
            self.adb("shell", "input", "keyevent", "4")
            self.wait(lambda tree: not self.keyboard_visible)
        self.last_action = "acknowledged"

    def switch(self, label, enabled):
        node = self.reveal(label)
        if (node.get("checked") == "true") != enabled:
            self.tap(node)
        self.wait(lambda tree: (node := self.find(tree, label)) is not None and (node.get("checked") == "true") == enabled)

    def report(self, refresh=True):
        if refresh:
            self.button("Read runtime report")
        def read(tree):
            node = next((n for n in tree.iter("node") if n.get("resource-id", "").endswith("runtime-report")), None)
            if node is None:
                return None
            raw = node.get("content-desc", "")
            if not raw:
                return None
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                return None  # The accessibility tree can precede the first React label update.
            self.last_report = validate_report(parsed)
            return self.last_report
        return self.wait(read)

    def wait_report(self, predicate, seconds=40, refresh=True):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = self.report(refresh)
            if predicate(value):
                return value
        raise RuntimeError("Public SDK getter observation deadline exceeded")

    def play_visible(self):
        self.playback_control(True)

    def pause_visible(self):
        self.playback_control(False)

    def playback_button(self, tree, play):
        names = {"play", "play video"} if play else {"pause", "pause video"}
        webviews = [node for node in tree.iter("node") if node.get("class") == "android.webkit.WebView"]
        candidates = [node for view in webviews for node in view.iter("node")
                      if node.get("class") == "android.widget.Button" and self.visible(node) and
                      any(node.get(key, "").casefold() in names for key in ["text", "content-desc"])]
        if candidates:
            # A full-video overlay can share the label while only revealing controls.
            # Prefer the compact SDK control; native readback still acknowledges every touch.
            return min(candidates, key=lambda node: (self.bounds(node)[2] - self.bounds(node)[0]) *
                       (self.bounds(node)[3] - self.bounds(node)[1]))
        control = self.find(tree, "Play" if play else "Pause")
        return control if control is not None else self.find(tree, "Play video" if play else "Pause video")

    def playback_control(self, play):
        self.top()
        tree = self.tree()
        for _ in range(3):
            control = self.playback_button(tree, play)
            if control is not None:
                read = self.find(tree, "Read runtime report")
                prior = self.last_report and self.last_report["owner"]
                self.tap(control)
                if read is None:
                    return  # Ordinary-entry screenshots have no observation header.
                # Keep the actual control/readback touches together. An AX dump
                # between them can exceed the stock bar's auto-hide interval.
                self.tap(read)
                previous_sequence = prior["sample"]["sequence"] if prior and prior["sample"] else 0
                value = self.wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and
                    v["owner"]["sample"]["sequence"] > previous_sequence, refresh=False)
                if prior is not None and value["owner"]["generation"] != prior["generation"]:
                    raise RuntimeError("The SDK playback control crossed native owners")
                if value["owner"]["sample"]["playing"] is play:
                    return
                tree = self.last_tree
                continue
            video = next((n for n in tree.iter("node") if n.get("resource-id", "").endswith("player-lab-player") and self.visible(n)), None)
            if video is not None:
                self.tap(video)
            tree = self.tree()
        raise RuntimeError("No visible SDK playback control was available")

    def frame(self, output):
        tree = self.tree()
        video = next((n for n in tree.iter("node") if n.get("resource-id", "").endswith("player-lab-player") and self.visible(n)), None)
        if video is None:
            raise RuntimeError("Native video viewport was not visible")
        output.write_bytes(self.adb("exec-out", "screencap", "-p", maximum=16 * 1024 * 1024))
        left, top, right, bottom = self.bounds(video)
        crop = f"crop={int((right-left)*.9)}:{int((bottom-top)*.6)}:{left+int((right-left)*.05)}:{top+int((bottom-top)*.1)},scale=128:72"
        result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-vf", crop, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode or len(result.stdout) != 128 * 72 * 3:
            raise RuntimeError("Video-region image comparison failed")
        return result.stdout

    def playback(self, stage, output):
        self.top()
        value = self.wait_report(lambda v: v["owner"] is not None and v["owner"]["sourceLoaded"] > 0 and
                                 v["owner"]["sample"] is not None and v["owner"]["sample"]["playing"])
        owner = value["owner"]["generation"]
        previous_batch = value["batch"]["id"] if value["batch"] else 0
        frames = [self.frame(output / f"{stage}-video-0.png")]
        self.button("Read playback samples")
        value = self.wait_report(lambda v: v["batch"] is not None and v["batch"]["id"] > previous_batch and v["batch"]["generation"] == owner, refresh=False)
        samples = batch_reports(value)
        frames.append(self.frame(output / f"{stage}-video-4.png"))
        playback_samples(samples)
        ratio = sum(abs(a-b) > 12 for a, b in zip(*frames)) / len(frames[0])
        if ratio <= .01:
            raise RuntimeError("The visible video region did not change with the native clock")
        return {"stage": stage, "samples": samples, "videoRegionChangedRatio": ratio}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="Dedicated, already-booted emulator serial")
    parser.add_argument("--adb", default=shutil.which("adb"), help="Android SDK platform-tools adb")
    parser.add_argument("--media-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    url = urlsplit(args.media_url)
    if not args.adb or url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or len(args.media_url) > 512:
        parser.error("Supply adb and a credential-free HTTP(S) 60-second HLS URL without query/fragment")
    root = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    if output.exists() or output == root or root in output.parents:
        parser.error("Output must be a new private directory outside the checkout")
    os.umask(0o077)
    output.mkdir(parents=True)
    result = {"schemaVersion": 1, "platform": "android", "passed": False, "stages": []}
    def phase(name):
        result["phase"] = name
        (output / "progress.json").write_text(json.dumps({"phase": name}) + "\n")
    ui = None
    try:
        phase("launch-and-readiness")
        ui = Ui(args.adb, args.device)
        ui.adb("shell", "am", "force-stop", PACKAGE)
        ui.adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        initial = ui.wait_report(lambda v: v["owner"] is not None and v["owner"]["viewReady"])
        ui.button("Show configuration")
        phase("reset-draft")
        original = ui.reveal("Source title").get("text")
        ui.edit("Source title", "Unapplied runtime draft"); ui.button("Reset draft")
        if ui.reveal("Source title").get("text") != original:
            raise RuntimeError("Reset did not restore the applied draft")
        ui.assert_configuration_footer(ui.tree())
        phase("edit-configuration")
        ui.edit("Source URL", args.media_url)
        hls = ui.reveal("HLS")
        if hls.get("enabled") != "false":
            ui.tap(hls)
        ui.edit("Source title", "Runtime VOD")
        ui.edit("Start offset (seconds)", "5")
        ui.switch("Autoplay", True); ui.switch("Mute on startup", True)
        ui.edit("Forward buffer (seconds)", "8")
        ui.edit("Maximum bitrate (bits per second)", "2500000")
        ui.button("Apply and recreate player"); ui.button("Hide configuration")
        phase("default-playback")
        stage = ui.playback("default", output); result["stages"].append(stage)
        configuration_stage(stage["samples"], "Default", True, initial["app"]["logCount"])
        old = stage["samples"][-1]["owner"]["generation"]
        if old == initial["owner"]["generation"]:
            raise RuntimeError("Apply did not replace the owner")
        phase("clipboard-and-draft-isolation")
        ui.button("Show configuration"); ui.button("Show applied code"); ui.button("Copy code")
        ui.button("Check copied code")
        ui.wait_report(lambda v: v["code"]["clipboardMatches"] is True)
        ui.edit("Source title", "Unapplied code draft"); ui.button("Reset draft")
        ui.assert_configuration_footer(ui.tree())
        if ui.report()["owner"]["generation"] != old:
            raise RuntimeError("Draft or clipboard unexpectedly replaced the owner")
        ui.button("Hide configuration"); ui.switch("Allow DVR", False); ui.button("Sports")
        phase("sports-playback")
        sports = ui.playback("sports", output); result["stages"].append(sports)
        configuration_stage(sports["samples"], "Sports", False, stage["samples"][-1]["app"]["logCount"])
        sports_owner = sports["samples"][-1]["owner"]["generation"]
        if sports_owner == old:
            raise RuntimeError("Sports UI did not replace the native player owner")
        ui.button("Default")
        phase("default-return-playback")
        stage = ui.playback("default-return", output); result["stages"].append(stage)
        configuration_stage(stage["samples"], "Default", False, sports["samples"][-1]["app"]["logCount"])
        owner = stage["samples"][-1]["owner"]["generation"]
        if owner == sports_owner:
            raise RuntimeError("Returning to Default UI did not replace the native player owner")
        # A paused one-minute fixture cannot finish while OS/accessibility
        # commands collect the background/foreground observations.
        ui.pause_visible()
        ui.adb("shell", "input", "keyevent", "3"); time.sleep(1)
        ui.adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        phase("foreground-playback")
        current = ui.wait_report(lambda v: v["lifecycle"] == "active" and v["owner"] is not None and v["owner"]["sample"] is not None)
        if not current["owner"]["sample"]["playing"]:
            ui.play_visible()
        stage = ui.playback("foreground", output); result["stages"].append(stage)
        configuration_stage(stage["samples"], "Default", False, result["stages"][-2]["samples"][-1]["app"]["logCount"])
        if stage["samples"][-1]["owner"]["generation"] != owner:
            raise RuntimeError("Foreground unexpectedly replaced the React Native owner")
        configuration_stages(result["stages"])
        ui.button("Finish runtime checks")
        phase("normal-owner-cleanup")
        final = ui.wait_report(lambda v: v["owner"] is None)
        if len(final["retired"]) != final["created"] or not all(v["wrapperDestroyed"] for v in final["retired"]):
            raise RuntimeError("Normal unmount did not set every wrapper destroy flag")
        result.update(passed=True, final=final, wrapperDestroyFlagsConfirmed=True, nativeReleaseAcknowledgementAvailable=False)
    except RuntimeError as failure:
        # All RuntimeError labels originate in this driver; native stderr is never included.
        result["failure"] = str(failure)
    except ValueError as failure:
        result["failure"] = str(failure)  # report.py uses fixed labels without native payloads.
    except (KeyError, subprocess.TimeoutExpired, ET.ParseError, OSError):
        result["failure"] = "Runtime qualification failed; completed safe observations are retained"
    finally:
        if ui is not None:
            result["lastControl"], result["lastGuiAction"] = ui.last_control, ui.last_action
            if ui.last_report is not None:
                result["lastReport"] = ui.last_report
            if not result["passed"]:
                try:
                    (output / "failure.private.png").write_bytes(ui.adb("exec-out", "screencap", "-p", maximum=16 * 1024 * 1024))
                    (output / "failure.private.xml").write_bytes(ui.adb("exec-out", "cat", "/sdcard/player-lab-runtime.xml"))
                except (RuntimeError, subprocess.TimeoutExpired, OSError): pass
            try:
                ui.adb("shell", "am", "force-stop", PACKAGE)
                ui.adb("shell", "rm", "-f", "/sdcard/player-lab-runtime.xml")
                result["targetApplicationStopped"] = True
            except (RuntimeError, subprocess.TimeoutExpired, OSError):
                result.update(passed=False, targetApplicationStopped=False, failure="Dedicated target cleanup was not confirmed")
        (output / "runtime-report.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in {"stages", "final", "lastReport"}}, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
