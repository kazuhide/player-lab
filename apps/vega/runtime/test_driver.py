import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from driver import Ui


class NativeTextTests(unittest.TestCase):
    def test_plain_caption_does_not_shadow_the_labelled_native_input(self):
        tree = ET.fromstring('''<root><app appName="com.playerlab.vega">
<child x="0" y="0" width="1920" height="1080">
<child role="text" x="20" y="100" width="400" height="24"><text>Source URL</text></child>
<child description="Source URL" x="20" y="140" width="800" height="52">
<child id="input"><traits><editable/></traits></child></child></child></app></root>''')
        self.assertIs(Ui.find(tree, "Source URL"), tree.find("./app/child/child[2]"))

    def test_plain_caption_does_not_shadow_a_button_with_the_same_text(self):
        tree = ET.fromstring('''<root><app appName="com.playerlab.vega">
<child x="0" y="0" width="1920" height="1080">
<child role="text" x="20" y="100" width="400" height="24"><text>Run Vega SDK API</text></child>
<child role="button" x="20" y="140" width="400" height="52"><text>Run Vega SDK API</text></child>
</child></app></root>''')
        self.assertIs(Ui.find(tree, "Run Vega SDK API"), tree.find("./app/child/child[2]"))

    def test_finds_a_native_reason_only_in_the_visible_application_viewport(self):
        tree = ET.fromstring('''<root><app appName="com.playerlab.vega">
<child x="0" y="0" width="1920" height="1080"><child role="text" x="20" y="100" width="800" height="24">
<text>No SGAI ad is active.</text></child></child></app></root>''')
        node = tree.find("./app/child/child")
        self.assertIs(Ui.find_text(tree, "No SGAI ad is active."), node)
        self.assertIsNone(Ui.find(tree, "No SGAI ad is active."))
        node.set("y", "1200")
        self.assertIsNone(Ui.find_text(tree, "No SGAI ad is active."))
        node.set("y", "100")
        ET.SubElement(ET.SubElement(tree.find("./app/child"), "traits"), "visibility", {"alpha": "0"})
        self.assertIsNone(Ui.find_text(tree, "No SGAI ad is active."))

    def test_reveals_the_captured_native_capability_reason_after_normal_navigation(self):
        reason = "This public API cannot be read in the current native SDK state."
        tree = ET.fromstring('''<root><app appName="com.playerlab.vega">
<child x="0" y="0" width="1920" height="1080"><traits><visibility alpha="100"/></traits>
<child role="text" x="24" y="1075" width="449" height="22"><traits><visibility alpha="100"/></traits>
<text>This public API cannot be read in the current native SDK state.</text></child></child></app></root>''')
        node = tree.find("./app/child/child")
        self.assertIsNone(Ui.find_text(tree, reason))
        self.assertIsNone(Ui.find_text(tree, "No SGAI ad is active."))
        ui = object.__new__(Ui)
        ui.tree = lambda: tree
        keys = []
        def key(code):
            keys.append(code)
            node.set("y", "1000")
        ui.key = key
        with patch("driver.time.sleep"):
            self.assertIs(ui.reveal_text(reason), node)
        self.assertEqual(keys, [108])
        tree.find("./app/child/traits/visibility").set("alpha", "0")
        self.assertIsNone(Ui.find_text(tree, reason))


if __name__ == "__main__": unittest.main()
