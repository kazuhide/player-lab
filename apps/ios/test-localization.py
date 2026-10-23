#!/usr/bin/env python3
"""Check shipped Apple translations without changing SDK identifiers or code."""
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parent
RESOURCE = ROOT / 'Showcase'


def translations(language):
    text = (RESOURCE / f'{language}.lproj/Localizable.strings').read_text()
    pairs = re.findall(r'^("(?:[^"\\]|\\.)*")\s*=\s*("(?:[^"\\]|\\.)*");$', text, re.M)
    values = [(json.loads(key), json.loads(value)) for key, value in pairs]
    if len(values) != len(dict(values)):
        raise ValueError('Duplicate translation keys')
    return dict(values)


class AppleLocalizationTests(unittest.TestCase):
    def test_both_editions_cover_the_same_messages_and_format_arguments(self):
        english, japanese = translations('en'), translations('ja')
        self.assertEqual(english.keys(), japanese.keys())
        self.assertGreater(len(english), 100)
        for key in english:
            with self.subTest(key=key):
                self.assertEqual(english[key], key)
                self.assertTrue(japanese[key].strip())
                self.assertEqual(sorted(re.findall(r'%(?:\d+\$)?(?:\.\d+)?(?:ll|l)?[@diufgs]', key)),
                                 sorted(re.findall(r'%(?:\d+\$)?(?:\.\d+)?(?:ll|l)?[@diufgs]', japanese[key])))

    def test_navigation_and_settings_have_real_japanese_translations(self):
        values = translations('ja')
        for key in ('Settings', 'Code', 'More', 'Source', 'Initial audio language',
                    'Initial subtitles', 'Video scaling', 'Apply', 'Reset to applied',
                    'Run API', 'Related SDK state', 'Receiver settings', 'Download settings'):
            with self.subTest(key=key):
                self.assertRegex(values[key], r'[ぁ-んァ-ヶ一-龠]')

    def test_sdk_and_configuration_tokens_stay_literal(self):
        values = translations('ja')
        for key in ('Player.volume', 'SourceConfig.tracks', 'LabelingConfig.audioLabel',
                    'BitmovinCastManager.isInitialized()', 'HLS', 'Progressive MP4'):
            self.assertNotIn(key, values, 'SDK/configuration tokens must remain verbatim')


if __name__ == '__main__':
    unittest.main()
