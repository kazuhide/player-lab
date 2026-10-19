#!/usr/bin/env python3
"""Check complete bilingual content, safe rendering, and navigation contracts."""
import copy
import json
from html.parser import HTMLParser
from pathlib import Path
import posixpath
import unittest
from urllib.parse import unquote, urlsplit

from guide_routes import GUIDE_ASSETS, GUIDE_FILES, route_file
from user_guide import build, load_content, render_block, source_url

ROOT = Path(__file__).resolve().parents[1]


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.ids = [], set()
        self.language = None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'html':
            self.language = values.get('lang')
        if 'id' in values:
            if values['id'] in self.ids:
                raise AssertionError('Duplicate HTML id')
            self.ids.add(values['id'])
        for attribute in ('href', 'src'):
            if attribute in values:
                self.links.append(values[attribute])


class GuideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = load_content(ROOT / 'docs/guide')
        cls.pages = build(cls.content)

    def test_all_chapters_and_reference_groups_are_public_in_both_languages(self):
        self.assertEqual(set(self.pages), GUIDE_FILES)
        self.assertEqual(sum(path.endswith('.html') for path in self.pages), 76)
        for language in ('en', 'ja'):
            fields = [field for group in self.content[language]['settings']['groups'] for field in group['fields']]
            self.assertEqual(len(fields), 134)
            self.assertEqual(len(self.content[language]['controls']['controls']), 35)
            self.assertEqual(len(self.content[language]['themes']['themes']), 14)

    def test_every_local_link_and_fragment_resolves_under_the_project(self):
        parsed = {}
        for name, data in self.pages.items():
            if name.endswith('.html'):
                parser = Links()
                parser.feed(data.decode())
                self.assertEqual(parser.language, 'ja' if name.startswith('ja/') else 'en')
                parsed[name] = parser
        known = set(self.pages) | GUIDE_ASSETS | {
            'index.html', 'ja/index.html', 'styles.css', 'assets/favicon.svg',
            'web/index.html', 'web/guide.html', 'web/media/ATTRIBUTION.txt',
            'web/notices/BITMOVIN-PLAYER-NOTICE.txt',
        }
        for name, parser in parsed.items():
            for value in parser.links:
                uri = urlsplit(value)
                if uri.scheme:
                    self.assertEqual(uri.scheme, 'https')
                    continue
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), uri.path)) if uri.path else name
                if value.split('#')[0].endswith('/'):
                    target += '/index.html'
                target = posixpath.normpath(target)
                if target == '.':
                    target = 'index.html'
                self.assertIn(target, known, (name, value, target))
                if uri.fragment and target in parsed:
                    self.assertIn(unquote(uri.fragment), parsed[target].ids, (name, value))

    def test_translation_keeps_the_same_section_and_setting_anchors(self):
        for english, data in self.pages.items():
            if not english.startswith('guide/') or not english.endswith('.html'):
                continue
            first, second = Links(), Links()
            first.feed(data.decode())
            second.feed(self.pages['ja/' + english].decode())
            self.assertEqual(first.ids, second.ids, english)

    def test_search_contains_every_setting_and_has_only_existing_targets(self):
        for language in ('en', 'ja'):
            name = 'ja/guide/search-index.json' if language == 'ja' else 'guide/search-index.json'
            index = json.loads(self.pages[name])
            self.assertEqual(len([entry for entry in index if entry['kind'] == 'setting']), 134)
            for entry in index:
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), entry['url'].split('#')[0]))
                if entry['url'].split('#')[0].endswith('/'):
                    target += '/index.html'
                self.assertIn(target, self.pages)
                self.assertTrue(entry['title'])
                self.assertTrue(entry['text'])

    def test_literal_markup_in_user_documentation_is_escaped(self):
        result = render_block({'type': 'p', 'text': '<script>alert("example")</script>'}, 'en', 'guide/start/index.html', 'section')
        self.assertIn('&lt;script&gt;', result)
        self.assertNotIn('<script>', result)
        result = render_block({'type': 'code', 'text': '<video autoplay>'}, 'en', 'guide/start/index.html', 'section')
        self.assertIn('&lt;video autoplay&gt;', result)

    def test_sources_reject_script_urls_and_private_or_traversing_paths(self):
        for source in [{'url': 'javascript:alert(1)'}, {'url': 'https://name:password@example.test/doc'},
                       {'path': '../private.md'}, {'path': '/tmp/local.md'}, {'path': 'docs/a.md', 'line': -1}]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                source_url(source)

    def test_build_is_reproducible_and_does_not_embed_authoring_metadata(self):
        self.assertEqual(self.pages, build(self.content))
        for name, data in self.pages.items():
            self.assertNotIn(b'fallback_initial', data, name)
            self.assertNotIn(b'source_hint', data, name)
            self.assertNotIn(b'/Users/', data, name)

    def test_missing_translation_fails_instead_of_silently_using_another_language(self):
        changed = copy.deepcopy(self.content)
        del changed['ja']['start']
        with self.assertRaises(ValueError):
            build(changed)

    def test_translation_cannot_change_executable_examples_or_reference_targets(self):
        for name in ['local-setup', 'controls', 'themes']:
            changed = copy.deepcopy(self.content)
            if name == 'local-setup':
                next(block for block in changed['ja'][name]['blocks'] if block['type'] == 'code')['text'] = 'different command'
            else:
                changed['ja'][name][name][0]['id'] = 'different-reference'
            with self.subTest(document=name), self.assertRaises(ValueError):
                build(changed)


if __name__ == '__main__':
    unittest.main()
