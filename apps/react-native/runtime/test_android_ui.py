import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("android_gui", Path(__file__).with_name("run-android.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AndroidLocatorTests(unittest.TestCase):
    def test_empty_focused_input_can_be_reported_as_its_placeholder(self):
        tree = ET.fromstring('<hierarchy><node class="android.widget.EditText" content-desc="Source URL" focused="true" '
                            'text="https://example.com/master.m3u8" hint="https://example.com/master.m3u8"/></hierarchy>')
        self.assertTrue(module.Ui.input_acknowledged(tree, "Source URL", ""))
        self.assertFalse(module.Ui.input_acknowledged(tree, "Source URL", "http://127.0.0.1:5198/master.m3u8"))
        node = tree.find("node")
        node.set("text", "http://127.0.0.1:5198/master.m3u8")
        self.assertFalse(module.Ui.input_acknowledged(tree, "Source URL", ""))
        self.assertTrue(module.Ui.input_acknowledged(tree, "Source URL", "http://127.0.0.1:5198/master.m3u8"))

    def test_a_caption_or_unfocused_input_cannot_acknowledge_clear(self):
        tree = ET.fromstring('<hierarchy><node class="android.widget.TextView" content-desc="Source URL" focused="true" text=""/>'
                            '<node class="android.widget.EditText" content-desc="Source URL" focused="false" text=""/></hierarchy>')
        self.assertFalse(module.Ui.input_acknowledged(tree, "Source URL", ""))

    def test_fixed_configuration_actions_reject_missing_and_clipped_buttons(self):
        ui = module.Ui.__new__(module.Ui)
        ui.width, ui.height = 2400, 1080
        tree = ET.fromstring('<hierarchy><node bounds="[0,0][2400,1080]">'
                            '<node resource-id="configuration-fields-scroll" bounds="[960,260][2400,740]"/>'
                            '<node resource-id="configuration-actions" bounds="[960,740][2400,1017]">'
                            '<node resource-id="configuration-reset" bounds="[992,859][1670,985]"/>'
                            '<node resource-id="configuration-apply" bounds="[1691,859][2369,985]"/>'
                            '</node></node></hierarchy>')
        ui.assert_configuration_footer(tree)
        ui.bottom = 900  # An edge-to-edge window can extend behind the keyboard.
        with self.assertRaisesRegex(RuntimeError, "fixed configuration actions"):
            ui.assert_configuration_footer(tree)
        ui.bottom = 1080
        apply = tree.find(".//node[@resource-id='configuration-apply']")
        apply.set("bounds", "[1691,1040][2369,1166]")
        with self.assertRaisesRegex(RuntimeError, "fixed configuration actions"):
            ui.assert_configuration_footer(tree)
        apply.set("bounds", "[1691,859][2369,985]")
        actions = tree.find(".//node[@resource-id='configuration-actions']")
        tree.find('node').remove(actions)
        with self.assertRaisesRegex(RuntimeError, "fixed configuration actions"):
            ui.assert_configuration_footer(tree)
        tree.find(".//node[@resource-id='configuration-fields-scroll']").append(actions)
        with self.assertRaisesRegex(RuntimeError, "fixed configuration actions"):
            ui.assert_configuration_footer(tree)

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
