"""Unit-only AX boundary for the real remote keyboard edit transaction."""
import time
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

from driver import Ui


class NativeKeyboardUi(Ui):
    def __init__(self, current="old value", keyboard_app="com.amazon.silverstone", hidden=False, correct_focus=True, stale_done=False, placeholder=None, label='Source URL', vanish_before_done=None, replace_focus_once=False, reuse_id_in_other_field=False, late_focus_loss=None, after_focus=None, keyboard_focus_pending_reads=0):
        self.value, self.keyboard_app, self.hidden = current, keyboard_app, hidden
        self.correct_focus, self.stale_done = correct_focus, stale_done
        self.placeholder = placeholder
        self.label = label
        self.vanish_before_done = vanish_before_done
        self.replace_focus_once, self.reuse_id_in_other_field = replace_focus_once, reuse_id_in_other_field
        self.wrong_field_id, self.focus_count = None, 0
        self.late_focus_loss, self.after_focus = late_focus_loss, after_focus
        self.keyboard_focus_pending_reads = keyboard_focus_pending_reads
        self.input_id, self.focused, self.open, self.key_focus = 1, False, False, "Clear"
        self.events, self.last_label, self.last_action = [], None, None
        self.deadline = time.monotonic() + 900

    def tree(self):
        tree = ET.fromstring('<root><app appName="com.playerlab.vega"><child x="0" y="0" width="1920" height="1080">'
            '<child description="Source URL" x="20" y="100" width="800" height="52"><child role="edit"><traits><editable/><focusable/></traits><text/></child></child>'
            '</child></app></root>')
        edit = tree.find('./app/child/child/child')
        tree.find('./app/child/child').set('description', self.label)
        edit.set('id', str(self.input_id))
        edit.find('./traits/focusable').set('focused', str(self.focused).lower())
        edit.find('text').text = self.value or self.placeholder
        if self.wrong_field_id is not None:
            field = ET.SubElement(tree.find('./app/child'), 'child', {'description':'Source title','x':'20','y':'200','width':'800','height':'52'})
            child = ET.SubElement(field, 'child', {'id':str(self.wrong_field_id),'role':'edit'})
            traits = ET.SubElement(child, 'traits')
            ET.SubElement(traits, 'editable')
            ET.SubElement(traits, 'focusable', {'focused':'true'})
            ET.SubElement(child, 'text').text = 'Unchanged source title'
        if self.open:
            app = ET.SubElement(tree, 'app', {'appName': self.keyboard_app})
            window = ET.SubElement(app, 'child', {'x':'0','y':'0','width':'1920','height':'1080'})
            ET.SubElement(ET.SubElement(window, 'traits'), 'visibility', {'alpha':'0' if self.hidden else '1'})
            for key, y in [('Clear', 300), ('Done', 400)]:
                node = ET.SubElement(window, 'child', {'id':key, 'description':key, 'x':'500','y':str(y),'width':'200','height':'50'})
                ET.SubElement(ET.SubElement(node, 'traits'), 'focusable', {'focused':str(self.keyboard_focus_pending_reads == 0 and key == self.key_focus).lower()})
            self.keyboard_focus_pending_reads = max(0, self.keyboard_focus_pending_reads - 1)
        return tree

    def command(self, method, path, value=None):
        if path == '/execute/sync':
            if value['script'] != 'jsonrpc: setFocus': raise AssertionError('Unexpected execution path')
            if value['args'][0][0]['id'] != self.input_id: raise RuntimeError('Stale input focus target')
            self.focus_count += 1
            if (self.replace_focus_once and self.focus_count == 1) or (not self.correct_focus and self.reuse_id_in_other_field):
                previous = self.input_id
                self.input_id += 1
                self.wrong_field_id = previous if self.reuse_id_in_other_field else None
                self.focused, self.open = False, True
                self.events.append('focus')
                return None
            self.wrong_field_id = None
            self.focused, self.open = self.correct_focus, True
            self.events.append('focus')
            if self.after_focus: self.after_focus()
            return None
        if path != '/element/' + str(self.input_id) + ('/text' if method == 'GET' else '/value'):
            raise RuntimeError('Stale native input identity')
        if method == 'GET':
            self.events.append('read-after-done' if not self.open else 'read')
            return self.value or self.placeholder or ''
        if not self.open: raise RuntimeError('Typing requires the real keyboard transaction')
        self.value += value['text']; self.input_id += 1
        self.events.append('type')
        if self.vanish_before_done == 'after-type': self.open = False

    def key(self, code):
        if not self.open: raise RuntimeError('No active native keyboard')
        if code == 28:
            if self.key_focus == 'Clear':
                self.value = ''; self.input_id += 1; self.events.append('Clear')
                if self.vanish_before_done == 'after-clear': self.open = False
            else:
                self.open = False; self.input_id += 1; self.events.append('Done')
                if self.stale_done: self.value = 'uncommitted value'
        elif code == 108: self.key_focus = 'Done'
        elif code == 103: self.key_focus = 'Clear'
        else: self.events.append('unhandled-key')

    def wait(self, predicate, seconds=30):
        value = predicate(self.tree())
        if value is None or value is False: raise RuntimeError('Native acknowledgment did not arrive')
        retarget = (self.late_focus_loss == 'before-clear' and isinstance(value, ET.Element) and (value.get('description') == 'Done' or value.get('role') == 'edit')) or \
            (self.late_focus_loss == 'before-type' and self.events[-1:] == ['Clear']) or \
            (self.late_focus_loss == 'before-done' and self.events[-1:] == ['type'])
        if retarget:
            self.focused, self.wrong_field_id = False, self.input_id + 100
        return value


class KeyboardEditTests(unittest.TestCase):
    def test_waits_for_coupled_input_and_keyboard_focus_when_done_appears_first(self):
        class PendingKeyboard(NativeKeyboardUi):
            def wait(self, predicate, seconds=30): return Ui.wait(self, predicate, seconds)
        ui = PendingKeyboard(keyboard_focus_pending_reads=3)
        ui.edit('Source URL', 'new value')
        self.assertEqual(ui.value, 'new value')
        self.assertIn('Clear', ui.events)
        self.assertIn('Done', ui.events)
        self.assertFalse(ui.open)

    def test_commits_exact_native_text_through_clear_type_done_and_reacquires_the_input(self):
        ui = NativeKeyboardUi()
        ui.edit('Source URL', 'new value')
        self.assertEqual(ui.value, 'new value')
        self.assertFalse(ui.open)
        self.assertEqual([e for e in ui.events if e in ['Clear','type','Done']], ['Clear','type','Done'])
        self.assertIn('read-after-done', ui.events)
        self.assertNotIn('unhandled-key', ui.events)

    def test_commits_an_empty_value_without_waiting_for_an_empty_xml_text_node(self):
        ui = NativeKeyboardUi()
        ui.edit('Source URL', '')
        self.assertEqual(ui.value, '')
        self.assertFalse(ui.open)
        self.assertIn('Done', ui.events)
        self.assertIn('read-after-done', ui.events)

    def test_rejects_a_keyboard_from_a_different_os_app(self):
        ui = NativeKeyboardUi(keyboard_app='com.other.keyboard')
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertNotIn('Clear', ui.events)

    def test_acknowledges_the_documented_empty_field_placeholder_after_done(self):
        ui = NativeKeyboardUi(placeholder='https://example.com/master.m3u8')
        ui.edit('Source URL', '')
        self.assertEqual(ui.value, '')
        self.assertFalse(ui.open)
        self.assertIn('read-after-done', ui.events)

    def test_rejects_an_unknown_rendered_value_instead_of_treating_it_as_empty(self):
        ui = NativeKeyboardUi(placeholder='unexpected field value')
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertNotIn('type', ui.events)

    def test_rejects_a_hidden_keyboard(self):
        ui = NativeKeyboardUi(hidden=True)
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertNotIn('Clear', ui.events)

    def test_requires_the_actual_target_app_input_to_have_focus(self):
        ui = NativeKeyboardUi(correct_focus=False)
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertNotIn('Clear', ui.events)

    def test_reacquires_the_current_labelled_input_after_focus_replaces_or_reuses_its_id(self):
        for reused in [False, True]:
            with self.subTest(reused=reused):
                ui = NativeKeyboardUi(replace_focus_once=True, reuse_id_in_other_field=reused)
                ui.edit('Source URL', 'new value')
                self.assertEqual(ui.value, 'new value')
                self.assertEqual(ui.focus_count, 2)
                self.assertEqual(ui.events.count('Clear'), 1)

    def test_never_clears_a_permanently_wrong_field_even_if_the_previous_id_is_focused(self):
        ui = NativeKeyboardUi(correct_focus=False, reuse_id_in_other_field=True)
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertEqual(ui.value, 'old value')
        self.assertNotIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)

    def test_rejects_a_late_focus_response_without_clearing(self):
        clock = [100.0]
        def delayed_response(): clock[0] += 31
        ui = NativeKeyboardUi(after_focus=delayed_response)
        with patch('driver.time.monotonic', lambda: clock[0]), patch('driver.time.sleep', lambda seconds: None):
            with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertNotIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)

    def test_rechecks_the_target_with_the_keyboard_before_clear_even_when_already_empty(self):
        ui = NativeKeyboardUi(current='', late_focus_loss='before-clear')
        with self.assertRaises(RuntimeError): ui.edit('Source URL', '')
        self.assertNotIn('Clear', ui.events)

    def test_rechecks_the_target_with_the_keyboard_immediately_before_typing(self):
        ui = NativeKeyboardUi(late_focus_loss='before-type')
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertIn('Clear', ui.events)
        self.assertNotIn('type', ui.events)

    def test_rechecks_the_target_keyboard_association_before_committing_done(self):
        ui = NativeKeyboardUi(late_focus_loss='before-done')
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertIn('type', ui.events)
        self.assertNotIn('Done', ui.events)

    def test_rejects_a_value_that_did_not_survive_normal_done(self):
        ui = NativeKeyboardUi(stale_done=True)
        with self.assertRaises(RuntimeError): ui.edit('Source URL', 'new value')
        self.assertIn('Done', ui.events)

    def test_requires_normal_done_even_if_matching_app_text_is_already_visible(self):
        for vanish, requested in [('after-clear', ''), ('after-type', 'new value')]:
            with self.subTest(vanish=vanish):
                ui = NativeKeyboardUi(vanish_before_done=vanish)
                with self.assertRaises(RuntimeError): ui.edit('Source URL', requested)
                self.assertEqual(ui.value, requested)
                self.assertNotIn('Done', ui.events)


if __name__ == '__main__': unittest.main()
