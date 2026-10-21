#!/usr/bin/env python3
"""Drive the opt-in Vega entry with public Kepler automation and SDK observations."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

from driver import Ui
from report import applied, playback, released, validate


def fixture_url(value, https=False):
    url = urlsplit(value)
    return len(value) <= 512 and url.scheme in ({"https"} if https else {"http", "https"}) and bool(url.hostname) and not any([url.username, url.password, url.query, url.fragment])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--appium", default="http://127.0.0.1:4735")
    parser.add_argument("--device", required=True, help="One explicitly owned VDA device, for example 127.0.0.1:5570")
    parser.add_argument("--vda-server-port", type=int, default=5037)
    parser.add_argument("--vega", default=shutil.which("vega"))
    parser.add_argument("--media-url", required=True, help="Credential-free one-minute HLS fixture")
    parser.add_argument("--subtitle-url", required=True, help="HTTPS plain WebVTT fixture with early cues")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    server = urlsplit(args.appium)
    if not args.vega or not shutil.which("ffmpeg") or server.scheme != "http" or server.hostname not in {"127.0.0.1", "localhost", "::1"} or server.query or server.fragment or server.username or server.password:
        parser.error("Supply the Vega CLI, ffmpeg and a loopback Appium server")
    if not fixture_url(args.media_url) or not fixture_url(args.subtitle_url, https=True) or not 1 <= args.vda_server_port <= 65535:
        parser.error("Supply credential-free fixture URLs and a valid VDA server port; WebVTT must use HTTPS")
    checkout = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    if output.exists() or output == checkout or checkout in output.parents:
        parser.error("Use a new private output directory outside the checkout")
    os.umask(0o077); output.mkdir(parents=True)
    result = {"schemaVersion": 1, "platform": "vega", "passed": False, "stages": []}
    ui, last = None, None
    env = {**os.environ, "ADB_SERVER_SOCKET": f"tcp:localhost:{args.vda_server_port}"}

    def os_app(action, component="com.playerlab.vega.main"):
        command = [args.vega, "device", action + "-app", "--device", args.device, "--appName", component]
        value = subprocess.run(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
        if value.returncode: raise RuntimeError("The selected Vega application lifecycle command failed")

    def device_shell(*arguments):
        value = subprocess.run([args.vega, "exec", "vda", "-P", str(args.vda_server_port), "-s", args.device, "shell", *arguments],
                               env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
        if value.returncode or len(value.stdout) > 1024 * 1024:
            raise RuntimeError("The selected Vega app-transfer command did not succeed")
        return value.stdout.decode("utf-8", errors="strict")

    def application_instance():
        # Public OS lifecycle listing, scoped to this component. Keep identifiers
        # private and report only equality/state; never infer warmth from launch.
        listing = device_shell("vlcm", "list", "--app-id", "com.playerlab.vega.main")
        rows = [line.split() for line in listing.splitlines() if line.strip().startswith("com.playerlab.vega.main ")]
        if len(rows) != 1 or len(rows[0]) < 5 or not all(re.fullmatch(r"\d+", v) for v in rows[0][2:4]):
            raise RuntimeError("The selected Vega component instance was not observable")
        return tuple(rows[0][2:4]), rows[0][4]

    def read():
        nonlocal last
        last = validate(ui.report())
        return last

    def wait_report(predicate, seconds=40):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = read()
            if predicate(value): return value
            time.sleep(.2)
        raise RuntimeError("Public Vega SDK observation deadline exceeded")

    def phase(name):
        result["phase"] = name
        (output / "progress.json").write_text(json.dumps({"phase": name}) + "\n")

    def code():
        lines, last_line = {}, None
        ui.focus(ui.reveal("Hide applied code"))
        # Each real code row participates in normal TV focus, so D-pad Down
        # reveals the entire output without test-only scrolling or model access.
        for _ in range(100):
            for node in ui.tree().iter():
                identifier = node.get("test_id", "")
                if not identifier.startswith("applied-code-line-"): continue
                suffix = identifier.removeprefix("applied-code-line-")
                if suffix.endswith("-last"):
                    suffix = suffix.removesuffix("-last")
                    if suffix.isdigit(): last_line = int(suffix)
                if not suffix.isdigit(): continue
                text = node.get("description")
                if text is not None: lines[int(suffix)] = "" if text == "Blank code line" else text
            if last_line is not None and set(lines) == set(range(last_line + 1)):
                value = "\n".join(lines[index] for index in range(last_line + 1))
                if not value or len(value) > 32768: raise RuntimeError("The applied code exceeded its bounded shape")
                return value
            ui.key(108)
        raise RuntimeError("Normal remote focus did not expose every applied-code line")

    def movie(path):
        video = ui.find(ui.tree(), "player-lab-player")
        if video is None: raise RuntimeError("The native video viewport was not visible")
        x, y, w, h = [float(video.get(k, "0")) for k in ["x", "y", "width", "height"]]
        if w < 100 or h < 100: raise RuntimeError("The native video viewport was too small")
        ui.screenshot(path)
        crop = f"crop={int(w*.9)}:{int(h*.6)}:{int(x+w*.05)}:{int(y+h*.1)},scale=128:72"
        value = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", crop, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20)
        if value.returncode or len(value.stdout) != 128 * 72 * 3: raise RuntimeError("Native video-region comparison failed")
        return value.stdout

    def stage(name, dvr):
        phase(name)
        wait_report(lambda v: v["owner"] is not None and v["owner"]["sample"] is not None and v["owner"]["sample"]["playing"])
        pixels = [movie(output / (name + "-video-0.png"))]
        samples = []
        for _ in range(5):
            samples.append(read()); time.sleep(.8)
        pixels.append(movie(output / (name + "-video-4.png")))
        generation = playback(samples, dvr)
        ratio = sum(abs(a-b) > 12 for a,b in zip(*pixels)) / len(pixels[0])
        if ratio <= .01: raise RuntimeError("Visible movie pixels must change with native clocks and decoded frames")
        result["stages"].append({"stage": name, "samples": samples, "videoRegionChangedRatio": ratio})
        return generation

    try:
        phase("normal-gui-readiness")
        os_app("terminate")
        os_app("launch")
        ui = Ui(args.appium, args.device)
        before = wait_report(lambda v: v["owner"] is not None and v["owner"]["sourceLoaded"] > 0 and v["owner"]["sample"] is not None)
        initial_owner = before["owner"]["generation"]
        ui.click("Show configuration")
        title_node = ui.reveal("Source title")
        original_title = next((n.text for n in title_node.iter("text") if n.text), "")
        ui.edit("Source title", "Unapplied draft"); ui.click("Reset draft")
        if not any(n.text == original_title for n in ui.reveal("Source title").iter("text")):
            raise RuntimeError("Reset must restore the applied title")
        phase("external-subtitle-fields")
        for label, value in [("Source URL", args.media_url), ("Source title", "WebVTT example"),
            ("External WebVTT URL", args.subtitle_url), ("Subtitle label", "External English"),
            ("Subtitle language", "EN-us"), ("Start offset (seconds)", "1"),
            ("Video forward buffer (seconds)", "8"), ("Audio forward buffer (seconds)", "8"),
            ("Maximum video bitrate (bits per second)", "2500000")]:
            ui.edit(label, value)
        hls = ui.reveal("HLS")
        if (enabled := hls.find("./traits/enableable")) is None or enabled.get("enabled") != "false": ui.click("HLS")
        for label in ["Autoplay", "Mute on startup", "Enable external subtitle on load"]: ui.switch(label, True)
        ui.click("Apply and recreate player")
        applied_report = wait_report(lambda v: v["owner"] is not None and v["owner"]["generation"] != initial_owner and v["owner"]["sourceLoaded"] > 0)
        applied(applied_report, True)
        cue = wait_report(lambda v: v["owner"] is not None and v["owner"]["cueVisible"] and v["owner"]["cueEnter"] > 0)
        ui.wait(lambda tree: ui.find(tree, "vega-subtitle-cue"))
        ui.screenshot(output / "external-caption-visible.png")
        result["nativeCueEventsAndVisibleOverlay"] = True
        result["cueEvents"] = cue["owner"]["cueEnter"]
        first_owner = stage("applied-playback", True)
        code_generation = last["codeGeneration"]
        phase("show-applied-code")
        ui.click("Show applied code")
        phase("read-applied-code")
        original_code = code()
        result["allAppliedCodeLinesObserved"] = True
        if not all(value in original_code for value in ["player-lab-external", "External English", "en-US"]):
            raise RuntimeError("Applied external subtitle metadata must be visible in generated code")
        phase("edit-unapplied-subtitle-label")
        ui.edit("Subtitle label", "Unapplied subtitle")
        phase("read-code-excluding-draft")
        if code() != original_code:
            raise RuntimeError("Draft subtitle edits must not change applied code")
        ui.click("Reset draft")
        phase("read-code-after-reset")
        if not any(n.text == "External English" for n in ui.reveal("Subtitle label").iter("text")) or code() != original_code:
            raise RuntimeError("Reset must restore applied subtitle metadata and retain code")
        ui.click("Hide applied code")
        # Finish this normal UI transaction before moving TV focus to the
        # separate read-only observation header.
        retained = read()
        if retained["owner"]["generation"] != first_owner or retained["codeGeneration"] != code_generation:
            raise RuntimeError("Draft or code viewing must retain the owner and applied code generation")
        ui.switch("Allow DVR", False)
        ui.edit("Source title", "Retained WebVTT source")
        ui.click("Apply and recreate player")
        replacement = wait_report(lambda v: v["owner"] is not None and v["owner"]["generation"] != first_owner)
        second_owner = stage("source-apply-playback", False)
        if not any(v["generation"] == first_owner and v["releaseConfirmed"] for v in replacement["retired"]):
            raise RuntimeError("Source Apply must wait for the previous native release barrier")
        phase("normal-background-and-return")
        before_instance, _ = application_instance()
        created_before = last["created"]
        code_before = last["codeGeneration"]
        logs_before = last["app"]["logCount"]
        # The documented app-to-app URI route resumes the existing singleton.
        # Home followed by a generic launch can instead cold-start the app.
        device_shell("vmsgr", "send", "orpheus://com.playerlab.runtimecompanion.main")
        time.sleep(2)
        hidden_instance, hidden_state = application_instance()
        if hidden_instance != before_instance or hidden_state != "NOT_VISIBLE":
            raise RuntimeError("App transfer must background the existing component instance")
        device_shell("vmsgr", "send", "orpheus://com.playerlab.vega.main")
        time.sleep(1)
        returned_instance, returned_state = application_instance()
        if returned_instance != before_instance or returned_state == "NOT_VISIBLE":
            raise RuntimeError("App transfer must return to the same component instance")
        result["sameApplicationInstanceThroughBackground"] = True
        wait_report(lambda v: v["owner"] is not None and v["owner"]["generation"] != second_owner)
        foreground_owner = stage("foreground-playback", False)
        if foreground_owner == second_owner: raise RuntimeError("Vega foreground return requires a fresh session")
        if last["created"] != created_before + 1 or last["codeGeneration"] != code_before or last["app"]["logCount"] < logs_before:
            raise RuntimeError("Foreground return must retain applied App state and replace exactly one native session")
        result["appliedCodeDraftIsolation"] = True
        ui.click("Finish runtime checks")
        final = wait_report(lambda v: v["owner"] is None and len(v["retired"]) == v["created"] and all(r["releaseConfirmed"] for r in v["retired"]))
        released(final)
        result.update(final=final, nativeReleaseBarrierConfirmed=True, passed=True)
    except (RuntimeError, ValueError) as failure:
        result["failure"] = str(failure)  # Fixed labels from the public driver/validator only.
    except (OSError, subprocess.TimeoutExpired, ET.ParseError):
        result["failure"] = "Vega GUI qualification did not satisfy every bounded gate"
    finally:
        if last is not None: result["lastReport"] = last
        if ui is not None:
            result["lastControl"], result["lastGuiAction"] = ui.last_label, ui.last_action
            if not result["passed"]:
                try: ui.screenshot(output / "failure.private.png")
                except (RuntimeError, OSError, ValueError): pass
            try: ui.close(); result["automationSessionClosed"] = True
            except (RuntimeError, OSError, ValueError): result.update(passed=False, automationSessionClosed=False)
        try: os_app("terminate"); result["targetApplicationStopped"] = True
        except (RuntimeError, OSError, subprocess.TimeoutExpired): result.update(passed=False, targetApplicationStopped=False)
        try: os_app("terminate", "com.playerlab.runtimecompanion.main"); result["companionApplicationStopped"] = True
        except (RuntimeError, OSError, subprocess.TimeoutExpired): result.update(passed=False, companionApplicationStopped=False)
        (output / "runtime-report.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key:value for key,value in result.items() if key not in {"stages", "final", "lastReport"}}, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__": raise SystemExit(main())
