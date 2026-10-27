"""Small W3C Appium client for Vega's public native automation toolkit."""
import base64
from contextlib import contextmanager
import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


class Ui:
    def __init__(self, server, device):
        self.server = server.rstrip("/")
        self.session = None
        self.deadline = time.monotonic() + 900
        self.last_label, self.last_action = None, None
        value = self.request("POST", "/session", {"capabilities": {"alwaysMatch": {
            "platformName": "Kepler", "appium:automationName": "automation-toolkit/JSON-RPC",
            "kepler:device": "vda://" + device, "appium:appURL": "com.playerlab.vega.main",
            "appium:noReset": True, "appium:newCommandTimeout": 300,
        }, "firstMatch": [{}]}})
        self.session = value["sessionId"]

    def request(self, method, path, value=None):
        deadline = min(self.deadline, getattr(self, "operation_deadline", None) or self.deadline)
        if time.monotonic() >= deadline:
            raise RuntimeError("The dedicated Vega check exceeded its total deadline")
        data = None if value is None else json.dumps(value).encode()
        request = urllib.request.Request(self.server + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=min(30, deadline - time.monotonic())) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
            if time.monotonic() >= deadline:
                raise RuntimeError("The Vega automation reply arrived after its observation deadline")
            if len(raw) > 4 * 1024 * 1024:
                raise RuntimeError("Vega automation response exceeded its size limit")
            result = json.loads(raw)["value"]
            if isinstance(result, dict) and result.get("error"):
                raise RuntimeError("Vega automation command did not succeed")
            return result
        except (urllib.error.URLError, ValueError, KeyError):
            # Do not propagate response bodies, native messages or source text.
            raise RuntimeError("Vega automation command did not return a bounded successful result") from None

    def command(self, method, path, value=None):
        return self.request(method, "/session/" + self.session + path, value)

    def tree(self):
        return ET.fromstring(self.command("GET", "/source"))

    @staticmethod
    def find(tree, label):
        return Ui._find(tree, label, plain_text=False)

    @staticmethod
    def find_text(tree, text):
        return Ui._find(tree, text, plain_text=True)

    @staticmethod
    def _visibility_check(scope, clip_scrollable=False):
        viewport = scope.find("child")
        width = float(viewport.get("width", "1920")) if viewport is not None else 1920
        height = float(viewport.get("height", "1080")) if viewport is not None else 1080
        parents = {child: parent for parent in scope.iter() for child in parent}
        def visible(node):
            try:
                x, y, w, h = [float(node.get(k, "0")) for k in ["x", "y", "width", "height"]]
                if w <= 0 or h <= 0 or not 0 <= x + w / 2 < width or not 0 <= y + h / 2 < height:
                    return False
            except ValueError:
                return False
            center_x, center_y = x + w / 2, y + h / 2
            while node is not None:
                visibility = node.find("./traits/visibility")
                if visibility is not None and visibility.get("alpha") == "0": return False
                if clip_scrollable and node.find("./traits/scrollable") is not None:
                    try:
                        x, y, w, h = [float(node.get(k, "0")) for k in ["x", "y", "width", "height"]]
                        if w <= 0 or h <= 0 or not x <= center_x < x + w or not y <= center_y < y + h:
                            return False
                    except ValueError:
                        return False
                node = parents.get(node)
            return True
        return visible

    @staticmethod
    def _find(tree, label, plain_text):
        scope = next((n for n in tree.iter("app") if n.get("appName") == "com.playerlab.vega"), None)
        if scope is None:
            return None
        visible = Ui._visibility_check(scope)
        for node in scope.iter():
            if not visible(node):
                continue
            text_matches = any(child.text == label for child in node.iter("text"))
            if plain_text:
                matches = node.get("role") == "text" and text_matches
            else:
                matches = node.get("description") == label or node.get("test_id") == label or (node.get("role") == "button" and text_matches)
            if matches:
                return node
        return None

    def wait(self, predicate, seconds=30):
        with self.observation_budget(time.monotonic() + seconds) as deadline:
            while time.monotonic() < deadline:
                value = predicate(self.tree())
                if time.monotonic() >= deadline: break
                if value is not None and value is not False:
                    return value
                time.sleep(min(.15, max(0, deadline - time.monotonic())))
        raise RuntimeError("Normal Vega GUI observation deadline exceeded")

    @contextmanager
    def observation_budget(self, deadline):
        previous = getattr(self, "operation_deadline", None)
        deadline = min(self.deadline, previous or self.deadline, deadline)
        self.operation_deadline = deadline
        try: yield deadline
        finally: self.operation_deadline = previous

    def key(self, code):
        self.command("POST", "/execute/sync", {"script": "jsonrpc: injectInputKeyEvent",
            "args": [[{"inputKeyEvent": str(code), "holdDuration": 100}]]})

    def focus(self, node):
        self.command("POST", "/execute/sync", {"script": "jsonrpc: setFocus", "args": [[{"id": int(node.get("id"))}]]})
        if node.find("./traits/focusable") is not None:
            self.wait(lambda tree: any(n.get("id") == node.get("id") and
                (focus := n.find("./traits/focusable")) is not None and focus.get("focused") == "true" for n in tree.iter()))

    def reveal(self, label):
        return self._reveal(label, self.find)

    def reveal_text(self, text):
        return self._reveal(text, self.find_text)

    def reveal_input(self, label):
        return self._reveal(label, self.find, require_editable=True)

    def _reveal(self, label, lookup, require_editable=False):
        self.last_label, self.last_action = label, "reveal"
        # Focus follows the normal TV hierarchy and scrolls its controls into view.
        for direction in [108, 103]:
            for _ in range(70):
                tree = self.tree()
                node = lookup(tree, label)
                editable = self.editable(tree, label) if require_editable else None
                focus = editable.find("./traits/focusable") if editable is not None else None
                # Traversal can open this field's own keyboard. Keep it for
                # the edit when the current visible target already owns focus.
                if node is not None and focus is not None and focus.get("focused") == "true":
                    return node
                if self.keyboard_node(tree, "Done") is not None:
                    # Passing an editable field can open the OS keyboard and
                    # capture arrows. Commit its unchanged value normally.
                    self.dismiss_keyboard()
                    continue
                if node is not None:
                    if require_editable and editable is None:
                        # A clipped RN wrapper can remain in the AX tree after
                        # its real editable child leaves the ScrollView.
                        scope = next(n for n in tree.iter("app") if n.get("appName") == "com.playerlab.vega")
                        viewport = scope.find("child")
                        height = float(viewport.get("height", "1080")) if viewport is not None else 1080
                        self.key(103 if float(node.get("y", "0")) < height / 2 else 108)
                        time.sleep(.12)
                        continue
                    return node
                self.key(direction)
                time.sleep(.12)
        raise RuntimeError("Normal Vega control remained outside its viewport")

    def click(self, label):
        node = self.reveal(label)
        enabled = node.find("./traits/enableable")
        if enabled is not None and enabled.get("enabled") == "false":
            raise RuntimeError("The normal Vega control is disabled")
        self.focus(node)
        self.last_action = "select"
        self.key(28)
        time.sleep(.15)

    def switch(self, label, enabled):
        node = self.reveal(label)
        switch = node.find("./traits/switchable")
        if switch is None:
            raise RuntimeError("The labelled Vega control is not a native switch")
        if (switch.get("on") == "true") != enabled:
            self.focus(node)
            self.key(28)  # Actual TV Select; touch-style clickCenter does not toggle this native control.
        self.wait(lambda tree: (node := self.find(tree, label)) is not None and
                  (switch := node.find("./traits/switchable")) is not None and (switch.get("on") == "true") == enabled)

    @staticmethod
    def keyboard_node(tree, label=None, focused=False):
        scope = next((node for node in tree.iter("app") if node.get("appName") == "com.amazon.silverstone"), None)
        if scope is None: return None
        viewport = scope.find("child")
        width = float(viewport.get("width", "1920")) if viewport is not None else 1920
        height = float(viewport.get("height", "1080")) if viewport is not None else 1080
        parents = {child: parent for parent in scope.iter() for child in parent}
        for node in scope.iter():
            focus = node.find("./traits/focusable")
            if focus is None or (focused and focus.get("focused") != "true") or (label is not None and node.get("description") != label):
                continue
            try:
                x, y, w, h = [float(node.get(k, "0")) for k in ["x", "y", "width", "height"]]
                if w <= 0 or h <= 0 or not 0 <= x + w / 2 < width or not 0 <= y + h / 2 < height: continue
            except ValueError:
                continue
            owner, visible = node, True
            while owner is not None:
                visibility = owner.find("./traits/visibility")
                if visibility is not None and visibility.get("alpha") == "0": visible = False
                owner = parents.get(owner)
            if visible: return node
        return None

    @staticmethod
    def _ordinary_done_observation(tree):
        if not any(node.get("appName") == "com.amazon.silverstone" for node in tree.iter("app")):
            return tree, False
        if Ui.keyboard_node(tree, "Done") is not None and Ui.keyboard_node(tree, focused=True) is not None:
            return tree, True
        return None

    def keyboard_select(self, label, deadline=None, target_label=None, ordinary_dismiss=False):
        if ordinary_dismiss and (label != "Done" or target_label is not None or deadline is None):
            raise RuntimeError("Only bounded ordinary Done dismissal accepts a closed keyboard")
        self.last_action = "native-keyboard-" + label.lower()
        for _ in range(35):
            if deadline is not None and time.monotonic() >= deadline:
                raise RuntimeError("The native keyboard action exceeded its observation deadline")
            if ordinary_dismiss:
                tree, active = self.wait(self._ordinary_done_observation, max(0, deadline - time.monotonic()))
                if not active: return "closed"
            else:
                tree = self.tree()
            if target_label is not None and self.input_with_keyboard(tree, target_label) is None:
                raise RuntimeError("The current labelled input lost its native keyboard focus")
            current, wanted = self.keyboard_node(tree, focused=True), self.keyboard_node(tree, label)
            if current is None or wanted is None:
                raise RuntimeError("The active native keyboard did not expose focus and its real key")
            if current.get("id") == wanted.get("id"):
                self.key(28)
                return
            cx, cy = float(current.get("x")) + float(current.get("width"))/2, float(current.get("y")) + float(current.get("height"))/2
            tx, ty = float(wanted.get("x")) + float(wanted.get("width"))/2, float(wanted.get("y")) + float(wanted.get("height"))/2
            self.key(108 if cy < ty - 40 else 103 if cy > ty + 40 else 106 if cx < tx else 105)
            time.sleep(.12)
        raise RuntimeError("The real native keyboard did not reach its requested key")

    def dismiss_keyboard(self, seconds=30):
        with self.observation_budget(time.monotonic() + seconds) as deadline:
            if self.keyboard_node(self.tree(), "Done") is not None:
                # An incidental keyboard can finish closing before it focuses
                # a key. This optional dismissal does not commit an edit.
                _, active = self.wait(self._ordinary_done_observation, max(0, deadline - time.monotonic()))
                if not active: return
                if self.keyboard_select("Done", deadline, ordinary_dismiss=True) == "closed": return
                self.wait(lambda tree: self.keyboard_node(tree, "Done") is None, max(0, deadline - time.monotonic()))

    @staticmethod
    def editable(tree, label):
        node = Ui.find(tree, label)
        if node is None: return None
        scope = next(n for n in tree.iter("app") if n.get("appName") == "com.playerlab.vega")
        # Retained editable children use the absolute native ScrollView frame.
        # Keep wrapper lookup available as a hint for ordinary typed navigation.
        visible = Ui._visibility_check(scope, clip_scrollable=True)
        return next((child for child in node.iter("child") if child.find("./traits/editable") is not None and visible(child)), None)

    @staticmethod
    def input_with_keyboard(tree, label):
        node = Ui.editable(tree, label)
        focus = node.find("./traits/focusable") if node is not None else None
        return node if focus is not None and focus.get("focused") == "true" and Ui.keyboard_node(tree, "Done") is not None and Ui.keyboard_node(tree, focused=True) is not None else None

    @staticmethod
    def text_matches(label, text, expected):
        # The real input renders its documented placeholder when its value is
        # empty. Do not trust showingHintText, which can remain set after typing.
        placeholders = {"Source URL": "https://example.com/master.m3u8", "Poster URL": "Optional URL",
            "External WebVTT URL": "Optional URL", "Subtitle language": "en-US", "Start offset (seconds)": "SDK default",
            "Video forward buffer (seconds)": "SDK default", "Audio forward buffer (seconds)": "SDK default",
            "Maximum video bitrate (bits per second)": "No limit", "Filter Vega API operations": "Find an API"}
        return text == expected or (expected == "" and label in placeholders and text == placeholders[label])

    @staticmethod
    def field_matches(tree, label, expected):
        node = Ui.editable(tree, label)
        return node is not None and Ui.text_matches(label, "".join(child.text or "" for child in node.iter("text")), expected)

    def edit(self, label, value):
        if not isinstance(value, str) or len(value) > 512: raise RuntimeError("The requested native text exceeds its bounded shape")
        self.dismiss_keyboard()
        self.reveal_input(label)
        focus_deadline = time.monotonic() + 30
        with self.observation_budget(focus_deadline):
            for attempt in range(3):
                # Resolve by current label after layout settles; an old native
                # ID can have been replaced or reused by a different field.
                time.sleep(min(.2, max(0, focus_deadline - time.monotonic())))
                with self.observation_budget(time.monotonic() + 2) as attempt_deadline:
                    self.reveal_input(label)
                    editable = self.editable(self.tree(), label)
                    if editable is None: raise RuntimeError("The labelled Vega control has no editable native input")
                    if time.monotonic() >= attempt_deadline: raise RuntimeError("The native target input focus deadline expired")
                    self.last_action = "focus-native-input"
                    self.command("POST", "/execute/sync", {"script": "jsonrpc: setFocus", "args": [[{"id": int(editable.get("id"))}]]})
                    if time.monotonic() >= attempt_deadline: raise RuntimeError("The native focus reply arrived after its deadline")
                    try:
                        self.wait(lambda tree: (node := self.editable(tree, label)) is not None and
                            (focus := node.find("./traits/focusable")) is not None and focus.get("focused") == "true",
                            max(0, attempt_deadline - time.monotonic()))
                        if time.monotonic() >= attempt_deadline: raise RuntimeError("The native focus observation arrived after its deadline")
                        break
                    except RuntimeError:
                        if attempt == 2: raise
        self.wait(lambda tree: self.input_with_keyboard(tree, label))
        # End/Backspace is routed to the foreign OS editor while its keyboard
        # is open. Use its normal, visibly focused Clear and Done TV controls.
        self.keyboard_select("Clear", target_label=label)
        self.wait(lambda tree: self.field_matches(tree, label, ""))
        if value:
            editable = self.input_with_keyboard(self.tree(), label)
            if editable is None: raise RuntimeError("The labelled input lost native keyboard focus before typing")
            self.last_action = "type-native-input"
            self.command("POST", "/element/" + editable.get("id") + "/value", {"text": value, "value": list(value)})
            self.wait(lambda tree: self.field_matches(tree, label, value))
        self.keyboard_select("Done", target_label=label)
        self.wait(lambda tree: self.keyboard_node(tree, "Done") is None)
        self.wait(lambda tree: self.field_matches(tree, label, value))
        # Controlled input layout can replace the child. Verify the fresh app
        # native identity and exact committed text after the normal Done action.
        editable = self.editable(self.tree(), label)
        if editable is None or not self.text_matches(label, self.command("GET", "/element/" + editable.get("id") + "/text"), value):
            raise RuntimeError("The exact native text did not survive the normal keyboard Done action")

    def report(self):
        def parse(tree):
            node = next((n for n in tree.iter() if n.get("test_id") == "runtime-report"), None)
            if node is None: return None
            try: return json.loads(node.get("description", ""))
            except ValueError: return None
        before = parse(self.tree())
        self.click("Read runtime report")
        def read(tree):
            value = parse(tree)
            if value is None: return None
            owner = value.get("owner")
            previous = before and before.get("owner")
            if owner is None or previous is None or owner.get("generation") != previous.get("generation"):
                return value
            if owner.get("sourceLoaded") == 0 and owner.get("sample") is None:
                return value  # The outer readiness predicate keeps polling via real header presses.
            sample, old_sample = owner.get("sample"), previous.get("sample")
            if sample and (not old_sample or sample["sequence"] > old_sample["sequence"]): return value
            return None
        return self.wait(read)

    def screenshot(self, path):
        raw = self.command("GET", "/screenshot")
        if not isinstance(raw, str) or len(raw) > 24 * 1024 * 1024:
            raise RuntimeError("Vega screenshot exceeded its size limit")
        path.write_bytes(base64.b64decode(raw, validate=True))

    def close(self):
        if self.session is not None:
            self.command("DELETE", "")
            self.session = None
