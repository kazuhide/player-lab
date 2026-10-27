import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from test_keyboard import NativeKeyboardUi
from driver import Ui


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
    def test_typed_reveal_preserves_the_already_focused_target_and_its_keyboard(self):
        ui = NativeKeyboardUi(label='SDK numeric value')
        ui.open, ui.focused = True, True
        with patch('driver.time.sleep', lambda seconds: None): node = ui.reveal_input('SDK numeric value')
        self.assertEqual(node.get('description'), 'SDK numeric value')
        self.assertTrue(ui.open)
        self.assertEqual(ui.events, [])
        self.assertEqual(ui.key_codes, [])

    def test_typed_reveal_preserves_own_target_while_keyboard_key_focus_is_pending(self):
        ui = NativeKeyboardUi(label='SDK numeric value', keyboard_focus_pending_reads=100)
        ui.open, ui.focused = True, True
        node = ui.reveal_input('SDK numeric value')
        self.assertEqual(node.get('description'), 'SDK numeric value')
        self.assertTrue(ui.open)
        self.assertEqual(ui.events, [])
        self.assertEqual(ui.key_codes, [])

    def test_typed_reveal_still_dismisses_a_keyboard_when_another_field_has_focus(self):
        ui = NativeKeyboardUi(label='SDK numeric value')
        ui.open, ui.focused, ui.wrong_field_id = True, False, 100
        with patch('driver.time.sleep', lambda seconds: None): ui.reveal_input('SDK numeric value')
        self.assertFalse(ui.open)
        self.assertEqual(ui.events, ['Done'])
        self.assertEqual(ui.value, 'old value')

    def test_ordinary_reveal_still_dismisses_the_keyboard(self):
        ui = NativeKeyboardUi(label='SDK numeric value')
        ui.open, ui.focused = True, True
        with patch('driver.time.sleep', lambda seconds: None): ui.reveal('SDK numeric value')
        self.assertFalse(ui.open)
        self.assertEqual(ui.events, ['Done'])

    def test_navigation_accepts_keyboard_app_closure_during_normal_done_traversal(self):
        ui = KeyboardCapturesNavigation()
        ui.keyboard_closes_after_reads = 5
        with patch('driver.time.sleep', lambda seconds: None): node = ui.reveal('Autoplay')
        self.assertEqual(node.get('description'), 'Autoplay')
        self.assertFalse(ui.open)
        self.assertEqual(ui.value, 'Unchanged input')
        self.assertEqual(ui.key_codes, [108])
        self.assertEqual(ui.events, [])

    def test_navigation_accepts_the_intermediate_keyboard_app_closing_while_focus_is_pending(self):
        class PendingKeyboard(KeyboardCapturesNavigation):
            def wait(self, predicate, seconds=30): return Ui.wait(self, predicate, seconds)
        ui = PendingKeyboard()
        ui.keyboard_focus_pending_reads, ui.keyboard_closes_after_reads = 100, 3
        clock = [100.0]
        with patch('driver.time.monotonic', lambda: clock[0]), patch('driver.time.sleep', lambda seconds: clock.__setitem__(0, clock[0] + seconds)):
            node = ui.reveal('Autoplay')
        self.assertEqual(node.get('description'), 'Autoplay')
        self.assertEqual(ui.value, 'Unchanged input')
        self.assertEqual(ui.events, [])
        self.assertFalse(ui.open)

    def test_navigation_waits_for_a_focused_key_when_the_intermediate_done_appears_first(self):
        class PendingKeyboard(KeyboardCapturesNavigation):
            def wait(self, predicate, seconds=30): return Ui.wait(self, predicate, seconds)
        ui = PendingKeyboard()
        ui.keyboard_focus_pending_reads = 3
        with patch('driver.time.sleep', lambda seconds: None): node = ui.reveal('Autoplay')
        self.assertEqual(node.get('description'), 'Autoplay')
        self.assertEqual(ui.value, 'Unchanged input')
        self.assertEqual(ui.events, ['Done'])
        self.assertFalse(ui.open)

    def test_closes_an_intermediate_os_keyboard_before_revealing_a_real_app_control(self):
        ui = KeyboardCapturesNavigation()
        with patch('driver.time.sleep', lambda seconds: None): node = ui.reveal('Autoplay')
        self.assertEqual(node.get('description'), 'Autoplay')
        self.assertFalse(ui.open)
        self.assertEqual(ui.value, 'Unchanged input')
        self.assertEqual(ui.events, ['Done'])

    def test_edit_reveals_the_actual_native_child_of_a_clipped_input_wrapper(self):
        for mode in ['missing', 'hidden', 'outside']:
            for y, direction in [(100, 103), (1000, 108)]:
                with self.subTest(y=y, mode=mode):
                    ui = ClippedNativeInput(y, mode=mode)
                    with patch('driver.time.sleep', lambda seconds: None): ui.edit('SDK numeric value', '12')
                    self.assertEqual(ui.navigation, [direction])
                    self.assertEqual(ui.value, '12')
                    self.assertIn('Clear', ui.events)
                    self.assertIn('Done', ui.events)

    def test_a_permanently_clipped_input_fails_within_the_existing_navigation_bound(self):
        for mode in ['missing', 'hidden', 'outside']:
            with self.subTest(mode=mode):
                ui = ClippedNativeInput(100, permanent=True, mode=mode)
                with patch('driver.time.sleep', lambda seconds: None):
                    with self.assertRaises(RuntimeError): ui.edit('SDK numeric value', '12')
                self.assertLessEqual(len(ui.navigation), 140)
                self.assertNotIn('Clear', ui.events)
                self.assertNotIn('type', ui.events)

    def test_reveals_the_captured_input_above_its_scrollable_viewport_before_editing(self):
        ui = ClippedNativeInput(534, mode='scroll-ancestor')
        ui.label = 'Subtitle label'
        with patch('driver.time.sleep', lambda seconds: None): ui.edit('Subtitle label', 'Unapplied subtitle')
        self.assertEqual(ui.navigation, [103])
        self.assertEqual(ui.value, 'Unapplied subtitle')
        self.assertIn('Clear', ui.events)
        self.assertIn('Done', ui.events)

    def test_never_clears_or_types_into_an_input_permanently_clipped_by_its_ancestor(self):
        ui = ClippedNativeInput(534, permanent=True, mode='scroll-ancestor')
        ui.label = 'Subtitle label'
        with patch('driver.time.sleep', lambda seconds: None):
            with self.assertRaises(RuntimeError): ui.edit('Subtitle label', 'Unapplied subtitle')
        self.assertLessEqual(len(ui.navigation), 140)
        self.assertNotIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)
        self.assertEqual(ui.value, 'old value')

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

    def test_up_first_reaches_an_earlier_input_without_the_blind_down_leg(self):
        ui = OrderedInputReturn()
        with patch('driver.time.sleep', lambda seconds: None):
            ui.edit('Subtitle label', 'Unapplied subtitle', up_first=True)
        self.assertEqual(ui.navigation, [103] * 60)
        self.assertEqual(ui.value, 'Unapplied subtitle')
        self.assertTrue(ui.destructive_positions)
        self.assertEqual(set(ui.destructive_positions), {20})

    def test_default_direction_order_stays_down_then_up_with_the_same_limit(self):
        ui = OrderedInputReturn()
        with patch('driver.time.sleep', lambda seconds: None):
            with self.assertRaises(RuntimeError): ui.edit('Subtitle label', 'Unapplied subtitle')
        self.assertEqual(ui.navigation, [108] * 70 + [103] * 70)
        self.assertEqual(ui.value, 'old value')
        self.assertNotIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)

    def test_up_first_keeps_the_bounded_reverse_fallback_for_a_lower_input(self):
        ui = OrderedInputReturn(position=10, target=25, maximum=50)
        with patch('driver.time.sleep', lambda seconds: None): ui.reveal_input('Subtitle label', up_first=True)
        self.assertEqual(ui.navigation[:70], [103] * 70)
        self.assertIn(108, ui.navigation[70:])
        self.assertLessEqual(len(ui.navigation), 140)
        self.assertEqual(ui.events, [])

    def test_up_first_dismisses_an_incidental_keyboard_without_early_editing(self):
        ui = OrderedInputReturn(incidental_at=70)
        with patch('driver.time.sleep', lambda seconds: None):
            ui.edit('Subtitle label', 'Unapplied subtitle', up_first=True)
        self.assertEqual(ui.navigation, [103] * 60)
        self.assertEqual(ui.events.count('Done'), 2)
        self.assertEqual(set(ui.destructive_positions), {20})
        self.assertEqual(ui.value, 'Unapplied subtitle')

    def test_up_first_rejects_a_permanently_missing_input_without_destructive_work(self):
        ui = OrderedInputReturn(permanent=True)
        with patch('driver.time.sleep', lambda seconds: None):
            with self.assertRaises(RuntimeError): ui.edit('Subtitle label', 'Unapplied subtitle', up_first=True)
        self.assertEqual(ui.navigation, [103] * 70 + [108] * 70)
        self.assertNotIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)
        self.assertEqual(ui.value, 'old value')


class ClippedNativeInput(NativeKeyboardUi):
    def __init__(self, y, permanent=False, mode='missing'):
        super().__init__(label='SDK numeric value')
        self.y, self.permanent, self.revealed, self.navigation = y, permanent, False, []
        self.mode = mode

    def tree(self):
        tree = super().tree()
        field = tree.find('./app/child/child')
        field.set('y', str(self.y))
        child = field.find('child')
        child.set('y', str(self.y + 14))
        if not self.revealed:
            if self.mode == 'missing': field.remove(child)
            elif self.mode == 'hidden': child.find('./traits/visibility').set('alpha', '0')
            elif self.mode == 'outside': child.set('y', '1200')
        if self.mode == 'scroll-ancestor':
            viewport = tree.find('./app/child')
            viewport.remove(field)
            frame = ET.SubElement(viewport, 'child', {'x':'0','y':'565','width':'1920','height':'515'})
            ET.SubElement(ET.SubElement(frame, 'traits'), 'scrollable')
            frame.append(field)
            field.set('y', '600' if self.revealed else '534')
            child.attrib.update({'x':'37','y':'613' if self.revealed else '547','width':'1846','height':'26'})
        return tree

    def key(self, code):
        if self.open: return super().key(code)
        if code in [103,108]:
            self.navigation.append(code)
            self.revealed = not self.permanent


class OrderedInputReturn(NativeKeyboardUi):
    """Unit-only linear focus graph with an absolute clipped input frame."""
    def __init__(self, position=80, target=20, maximum=150, permanent=False, incidental_at=None):
        super().__init__(label='Subtitle label')
        self.position, self.target, self.maximum = position, target, maximum
        self.permanent, self.incidental_at = permanent, incidental_at
        self.navigation, self.destructive_positions = [], []

    def tree(self):
        tree = super().tree()
        viewport = tree.find('./app/child')
        field = viewport.find('child')
        viewport.remove(field)
        frame = ET.SubElement(viewport, 'child', {'x':'0','y':'565','width':'1920','height':'515'})
        ET.SubElement(ET.SubElement(frame, 'traits'), 'scrollable')
        frame.append(field)
        y = 2000 if self.permanent else 600 + (self.target - self.position) * 80
        field.set('y', str(y))
        field.find('child').set('y', str(y + 14))
        return tree

    def key(self, code):
        if self.open:
            if code == 28 and self.key_focus == 'Clear': self.destructive_positions.append(self.position)
            return super().key(code)
        if code in [103,108]:
            self.navigation.append(code)
            self.position = max(0, min(self.maximum, self.position + (1 if code == 108 else -1)))
            if self.position == self.incidental_at:
                self.incidental_at = None
                self.open, self.focused = True, False

    def command(self, method, path, value=None):
        if method == 'POST' and path.endswith('/value'): self.destructive_positions.append(self.position)
        return super().command(method, path, value)



if __name__ == '__main__': unittest.main()
