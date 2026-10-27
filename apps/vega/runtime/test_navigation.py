import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from test_keyboard import NativeKeyboardUi


class KeyboardCapturesNavigation(NativeKeyboardUi):
    def __init__(self, text_target=False):
        super().__init__(current='Unchanged input')
        self.app_steps, self.text_target = 0, text_target

    def tree(self):
        tree = super().tree()
        node = ET.SubElement(tree.find('./app/child'), 'child', {
            'x':'20', 'y':'400' if self.app_steps >= 2 else '2000', 'width':'600','height':'40',
            'role':'text' if self.text_target else 'switch'})
        if self.text_target: ET.SubElement(node, 'text').text = 'No SGAI ad is active.'
        else: node.set('description', 'Autoplay')
        return tree

    def key(self, code):
        if self.open:
            return super().key(code)
        if code == 108:
            self.app_steps += 1
            if self.app_steps == 1:
                self.open, self.focused = True, True
        elif code == 103:
            self.app_steps = max(0, self.app_steps - 1)


class NativeNavigationTests(unittest.TestCase):
    def test_closes_an_intermediate_os_keyboard_before_revealing_a_real_app_control(self):
        ui = KeyboardCapturesNavigation()
        with patch('driver.time.sleep', lambda seconds: None): node = ui.reveal('Autoplay')
        self.assertEqual(node.get('description'), 'Autoplay')
        self.assertFalse(ui.open)
        self.assertEqual(ui.value, 'Unchanged input')
        self.assertEqual(ui.events, ['Done'])

    def test_edit_reveals_the_actual_native_child_of_a_clipped_input_wrapper(self):
        for y, direction in [(100, 103), (1000, 108)]:
            with self.subTest(y=y):
                ui = ClippedNativeInput(y)
                with patch('driver.time.sleep', lambda seconds: None): ui.edit('SDK numeric value', '12')
                self.assertEqual(ui.navigation, [direction])
                self.assertEqual(ui.value, '12')
                self.assertIn('Clear', ui.events)
                self.assertIn('Done', ui.events)

    def test_a_permanently_clipped_input_fails_within_the_existing_navigation_bound(self):
        ui = ClippedNativeInput(100, permanent=True)
        with patch('driver.time.sleep', lambda seconds: None):
            with self.assertRaises(RuntimeError): ui.edit('SDK numeric value', '12')
        self.assertLessEqual(len(ui.navigation), 140)
        self.assertNotIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)

    def test_reveals_again_after_layout_settles_before_acquiring_the_current_input_id(self):
        ui = ClippedNativeInput(100)
        ui.revealed = True
        changed = []
        def layout_settle(seconds):
            if seconds == .2 and not changed:
                changed.append(True)
                ui.revealed = False
        with patch('driver.time.sleep', layout_settle): ui.edit('SDK numeric value', '12')
        self.assertEqual(ui.navigation, [103])
        self.assertEqual(ui.value, '12')

    def test_uses_the_same_normal_navigation_for_a_plain_reason_without_editing_an_input(self):
        ui = KeyboardCapturesNavigation(text_target=True)
        with patch('driver.time.sleep', lambda seconds: None): node = ui.reveal_text('No SGAI ad is active.')
        self.assertEqual(node.get('role'), 'text')
        self.assertEqual(ui.value, 'Unchanged input')
        self.assertEqual(ui.events, ['Done'])


class ClippedNativeInput(NativeKeyboardUi):
    def __init__(self, y, permanent=False):
        super().__init__(label='SDK numeric value')
        self.y, self.permanent, self.revealed, self.navigation = y, permanent, False, []

    def tree(self):
        tree = super().tree()
        field = tree.find('./app/child/child')
        field.set('y', str(self.y))
        if not self.revealed: field.remove(field.find('child'))
        return tree

    def key(self, code):
        if self.open: return super().key(code)
        if code in [103,108]:
            self.navigation.append(code)
            self.revealed = not self.permanent



if __name__ == '__main__': unittest.main()
