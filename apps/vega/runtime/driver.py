"""Small W3C Appium client for Vega's public native automation toolkit."""
import base64
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
        if time.monotonic() >= self.deadline:
            raise RuntimeError("The dedicated Vega check exceeded its total deadline")
        data = None if value is None else json.dumps(value).encode()
        request = urllib.request.Request(self.server + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=min(30, self.deadline - time.monotonic())) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
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
    def _find(tree, label, plain_text):
        scope = next((n for n in tree.iter("app") if n.get("appName") == "com.playerlab.vega"), None)
        if scope is None:
            return None
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
            while node is not None:
                visibility = node.find("./traits/visibility")
                if visibility is not None and visibility.get("alpha") == "0": return False
                node = parents.get(node)
            return True
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
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = predicate(self.tree())
            if value is not None and value is not False:
                return value
            time.sleep(.15)
        raise RuntimeError("Normal Vega GUI observation deadline exceeded")

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

    def _reveal(self, label, lookup):
        self.last_label, self.last_action = label, "reveal"
        # Focus follows the normal TV hierarchy and scrolls its controls into view.
        for direction in [108, 103]:
            for _ in range(70):
                tree = self.tree()
                node = lookup(tree, label)
                if node is not None:
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

    def edit(self, label, value):
        node = self.reveal(label)
        editable = next((child for child in node.iter("child") if child.find("./traits/editable") is not None), None)
        if editable is None:
            raise RuntimeError("The labelled Vega control has no editable native input")
        self.focus(editable)
        self.last_action = "read-input"
        current = self.command("GET", "/element/" + editable.get("id") + "/text")
        if not isinstance(current, str) or len(current) > 512:
            raise RuntimeError("The editable Vega value exceeded its limit")
        # The toolkit's setText appends at the caret. Real End/Backspace key events
        # clear the current value before typing, with controlled-input acknowledgement.
        if current:
            self.last_action = "clear-input"
            self.key(107)
            for _ in current:
                self.key(14)
            self.wait(lambda tree: (node := self.find(tree, label)) is not None and not any(child.text for child in node.iter("text")))
        # Controlled text/layout updates can replace the native editable child.
        # Resolve and focus its current public automation identity before typing.
        node = self.reveal(label)
        editable = next((child for child in node.iter("child") if child.find("./traits/editable") is not None), None)
        if editable is None: raise RuntimeError("The current Vega input was not editable")
        self.focus(editable)
        self.last_action = "type-input"
        self.command("POST", "/element/" + editable.get("id") + "/value", {"text": value, "value": list(value)})
        self.wait(lambda tree: (node := self.find(tree, label)) is not None and any(child.text == value for child in node.iter("text")))

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
