import unittest
import xml.etree.ElementTree as ET

from driver import Ui


class NativeTextTests(unittest.TestCase):
    def test_finds_a_native_reason_only_in_the_visible_application_viewport(self):
        tree = ET.fromstring('''<root><app appName="com.playerlab.vega">
<child x="0" y="0" width="1920" height="1080"><child role="text" x="20" y="100" width="800" height="24">
<text>No SGAI ad is active.</text></child></child></app></root>''')
        node = tree.find("./app/child/child")
        self.assertIs(Ui.find(tree, "No SGAI ad is active."), node)
        node.set("y", "1200")
        self.assertIsNone(Ui.find(tree, "No SGAI ad is active."))
        node.set("y", "100")
        ET.SubElement(ET.SubElement(tree.find("./app/child"), "traits"), "visibility", {"alpha": "0"})
        self.assertIsNone(Ui.find(tree, "No SGAI ad is active."))


if __name__ == "__main__": unittest.main()
