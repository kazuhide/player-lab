import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("android_gui", Path(__file__).with_name("run-android.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AndroidLocatorTests(unittest.TestCase):
    def test_visible_caption_never_substitutes_for_a_clipped_input(self):
        ui = module.Ui.__new__(module.Ui)
        ui.width, ui.height, ui.scroll_top, ui.bottom = 1080, 2400, 381, 2337
        tree = ET.fromstring('<hierarchy><node class="android.widget.TextView" text="Subtitle language" bounds="[32,2280][1049,2320]"/>'
                            '<node class="android.widget.EditText" content-desc="Subtitle language" text="" bounds="[32,2323][1049,2337]"/></hierarchy>')
        self.assertIsNone(ui.find(tree, "Subtitle language"))
        field = tree.find("node[@class='android.widget.EditText']")
        field.set("bounds", "[32,2100][1049,2217]")
        self.assertIs(ui.find(tree, "Subtitle language"), field)


if __name__ == "__main__": unittest.main()
