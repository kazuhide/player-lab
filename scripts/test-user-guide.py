#!/usr/bin/env python3
"""Check complete bilingual content, safe rendering, and navigation contracts."""
import copy
import hashlib
import json
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import posixpath
import re
import subprocess
import tempfile
import unittest
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

from coverage_report import summarize
from guide_coverage import api_anchor, category_metrics
from guide_routes import (CHAPTERS, CHILD_CHAPTERS, COVERAGE_APPS, GUIDE_ASSETS, GUIDE_FILES, IMPLEMENTATION_GUIDES,
                          IMPLEMENTATION_SECTIONS, LOCALIZED_FIGURES, NATIVE_FIGURES, PUBLIC_BASE,
                          SOURCE_REVISION, figure_capture_profile, figure_path, route_file)
from user_guide import build, load_content, render_block, search_text, section_ids, source_url

ROOT = Path(__file__).resolve().parents[1]


def sidebar(page):
    markup = re.search(r'<nav class="guide-nav"[^>]*>.*?</nav>', page.decode(), re.S).group()
    return ElementTree.fromstring(markup)


def coverage_fixture():
    data = {'schemaVersion':1, 'checkedAt':'2026-10-20', 'sourceRevision':'1' * 40,
            'sdks':[], 'applications':[]}
    examples = [('config', 'configuration', 'direct'), ('preset', 'configuration', 'preset'),
                ('read-config', 'configuration', 'observed'), ('play', 'command', 'direct'),
                ('load', 'command', 'preset'), ('seek', 'command', 'missing'),
                ('time', 'observation', 'observed'), ('playing', 'event', 'observed'),
                ('lifecycle', 'command', 'internal'), ('helper', 'command', 'code-only'),
                ('native-ui', 'command', 'sdk-ui-unverified')]
    for app in COVERAGE_APPS:
        data['sdks'].append({'id':app, 'name':app + ' SDK', 'version':'1.2.3', 'channel':'stable',
            'latestVersion':'1.2.4', 'latestCheckedAt':'2026-10-20',
            'sources':[{'url':'https://cdn.bitmovin.com/player/web/8/docs/', 'sha256':'a' * 64}]})
        rows = [{'id':app + ':Fixture.' + name, 'category':category, 'scope':'Fixture',
                 'deprecated':name == 'read-config', 'status':status,
                 'officialReference':'https://cdn.bitmovin.com/player/web/8/docs/',
                 'evidence':[{'kind':'app', 'file':'app/player.ts', 'sha256':'b' * 64,
                              'line':2, 'symbol':'player'}] if status != 'missing' else []}
                for name, category, status in examples]
        data['applications'].append({'id':app, 'sdkId':app, 'platform':app,
            'rows':rows, 'excluded':[{'id':app + ':Fixture.constructor', 'reason':'Constructor alias.'}],
            'scopeNotes':['Public fixture scope 1.']})
    return data, summarize(data)


def gap_fixture(report):
    from coverage_gaps import needs_gui_route
    return {'schemaVersion': 1, 'checkedAt': report['checkedAt'],
            'reportInputSha256': summarize(report)['inputSha256'],
            'reasons': {'fixture-gap': {'kind': 'implementation',
                'en': {'reason': 'The app has no editable or visible route.', 'action': 'Add a typed app control.'},
                'ja': {'reason': '編集・表示の経路がありません。', 'action': '型に合う操作を追加します。'},
                'references': []}},
            'applications': [{'id': app['id'], 'groups': [{'reason': 'fixture-gap',
                'apis': [row['id'] for row in app['rows'] if needs_gui_route(row)]}]}
                for app in report['applications']]}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.ids = [], set()
        self.images = []
        self.figures = []
        self.language = None
        self.refresh = None
        self.canonical = None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'img':
            self.images.append(values)
        if tag == 'figure':
            self.figures.append(values)
        if tag == 'html':
            self.language = values.get('lang')
        if tag == 'meta' and values.get('http-equiv', '').lower() == 'refresh':
            self.refresh = values.get('content')
        if tag == 'link' and values.get('rel') == 'canonical':
            self.canonical = values.get('href')
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
        cls.report, cls.summary = coverage_fixture()
        cls.content = load_content(ROOT / 'docs/guide', coverage=(cls.report, cls.summary))
        cls.content['ja']['api-coverage']['noteTranslations'] = {
            app:[{'source':'Public fixture scope 1.', 'text':'公開テスト用の対象範囲1。'}] for app in COVERAGE_APPS}
        cls.content['ja']['api-coverage']['reasonTranslations'] = {'Constructor alias.':'コンストラクターの別名。'}
        cls.content['ja']['api-coverage']['appLabels'] = {
            a['id']:{'source':a['platform'], 'text':a['platform']} for a in cls.report['applications']}
        cls.content['ja']['api-coverage']['sdkLabels'] = {
            s['id']:{'source':s['name'], 'text':s['name']} for s in cls.report['sdks']}
        cls.content['ja']['api-coverage']['channelLabels'] = {'stable':'安定版'}
        cls.pages = build(cls.content)

    def test_all_chapters_and_reference_groups_are_public_in_both_languages(self):
        self.assertEqual(set(self.pages), GUIDE_FILES)
        self.assertEqual(sum(path.endswith('.html') for path in self.pages), 182)
        for language in ('en', 'ja'):
            fields = [field for group in self.content[language]['settings']['groups'] for field in group['fields']]
            self.assertEqual(len(fields), 144)
            self.assertEqual(len(self.content[language]['controls']['controls']), 41)
            self.assertEqual(len(self.content[language]['themes']['themes']), 14)

    def test_app_screenshots_use_the_page_language_without_shared_fallback(self):
        external_dashboard = {
            'analytics-dashboard-overview.png',
            'analytics-dashboard-errors.png',
            'analytics-session-errors.png',
        }
        for path, data in self.pages.items():
            if not path.endswith('.html') or b'<img ' not in data:
                continue
            parser = Links()
            parser.feed(data.decode())
            language = 'ja' if path.startswith('ja/') else 'en'
            for image in parser.images:
                name = posixpath.basename(image['src'])
                if name in external_dashboard:
                    continue
                with self.subTest(page=path, image=name):
                    self.assertRegex(name, rf'-{language}\.(?:jpg|png)$')
                    self.assertTrue(image.get('alt', '').strip())
                    self.assertGreater(int(image['width']), 0)
                    self.assertGreater(int(image['height']), 0)

    def test_published_content_builds_with_the_actual_api_report(self):
        pages = build(load_content(ROOT / 'docs/guide'))
        self.assertEqual(set(pages), GUIDE_FILES)

    def test_every_incomplete_api_route_has_a_static_bilingual_reason_and_action(self):
        from coverage_gaps import validate_gaps
        content = load_content(ROOT / 'docs/guide')
        report, _ = content.coverage
        gaps = json.loads((ROOT / 'docs/api-coverage/gaps.json').read_text())
        assessments = validate_gaps(gaps, report)
        pages = build(content)
        for language in ('en', 'ja'):
            search = json.loads(pages[f'{"ja/" if language == "ja" else ""}guide/search-index.json'])
            api_search = {item['url']: item for item in search if item['kind'] == 'api'}
            for app in report['applications']:
                page = pages[route_file(language, 'api-coverage/' + app['id'])].decode()
                self.assertEqual(page.count('data-api-gap='), len(assessments[app['id']]))
                self.assertEqual(page.count('data-api-id='), len(app['rows']))
                for api, reason in assessments[app['id']].items():
                    self.assertIn(escape(reason[language]['reason']), page)
                    self.assertIn(escape(reason[language]['action']), page)
                    target = 'api-coverage/' + app['id'] + '/#' + api_anchor(api)
                    self.assertIn(reason[language]['reason'], api_search[target]['text'])
                    self.assertIn(reason[language]['action'], api_search[target]['text'])

    def test_reworded_player_headings_keep_their_published_bookmarks(self):
        bookmarks = {
            'web-player-config': ['three-application-modes'],
            'web-screen-themes': ['three-customization-methods'],
            'web-sources-tracks': ['seven-sources'],
            'web-ui-settings': ['sixteen-ui-settings'],
            'web-ui-customization': ['fourteen-guide-sections', 'six-common-modifications'],
        }
        for language in ('en', 'ja'):
            for chapter, identifiers in bookmarks.items():
                parser = Links()
                parser.feed(self.pages[route_file(language, chapter)].decode())
                for identifier in identifiers:
                    self.assertIn(identifier, parser.ids, (language, chapter))

    def test_dashboard_capture_uses_the_original_local_png(self):
        html = render_block({'type': 'figure', 'file': 'analytics-dashboard-overview',
                             'caption': 'Bitmovin Dashboard demo screen.'}, 'en',
                            route_file('en', 'web-qoe-analytics'), None)
        self.assertIn('assets/guide/analytics-dashboard-overview.png', html)
        self.assertIn('width="2864" height="1270"', html)
        self.assertIn('assets/guide/analytics-dashboard-overview.png', GUIDE_ASSETS)

    def test_each_app_figure_has_distinct_english_and_japanese_captures(self):
        for name in LOCALIZED_FIGURES:
            with self.subTest(figure=name):
                english = ROOT / 'site' / figure_path(name, 'en')
                japanese = ROOT / 'site' / figure_path(name, 'ja')
                self.assertTrue(english.is_file(), english)
                self.assertTrue(japanese.is_file(), japanese)
                self.assertNotEqual(hashlib.sha256(english.read_bytes()).digest(),
                                    hashlib.sha256(japanese.read_bytes()).digest())

    def test_player_chapters_precede_dashboard_analytics_in_both_languages(self):
        for language in ('en', 'ja'):
            html = self.pages[route_file(language)].decode()
            for chapter in (*IMPLEMENTATION_GUIDES, 'native-apple', 'native-android',
                            'native-react-native', 'native-vega'):
                self.assertLess(html.index(chapter + '/'), html.index('web-qoe-analytics/'))
            self.assertLess(html.index('test-results/'), html.index('web-qoe-analytics/'))
            self.assertLess(html.index('analytics-visualization/'), html.index('analytics-queries/'))

    def test_every_platform_has_two_unnumbered_screen_and_implementation_chapters(self):
        from guide_html import TEXT
        platforms = {
            'web_group': ('web-screen-controls', 'web-implementation'),
            'apple': ('native-apple', 'apple-implementation'),
            'android': ('native-android', 'android-implementation'),
            'react-native': ('native-react-native', 'react-native-implementation'),
            'vega': ('native-vega', 'vega-implementation'),
        }
        for language in ('en', 'ja'):
            nav = sidebar(self.pages[route_file(language)])
            groups = {section.find('h3').text: section for section in nav.findall('section')}
            for category, chapters in platforms.items():
                group = groups[TEXT[language][category]]
                self.assertIsNone(group.find('ol'))
                links = group.findall('./ul/li/a')
                self.assertEqual([a.get('href') for a in links], [name + '/' for name in chapters])
                self.assertEqual([a.text for a in links], [TEXT[language]['operation_guide'],
                                                         TEXT[language]['implementation']])
                self.assertFalse(group.findall('./ul/li/ul'))
                self.assertEqual([d.get('data-guide-chapter') for d in group.findall('./ul/li/details')],
                                 list(chapters))
            top_paths = [a.get('href') for a in nav.findall('./section/ul/li/a')]
            for retired in ('implementation', 'native-integrations', 'web-screen-themes',
                            'web-sources-tracks', 'web-ui-settings'):
                self.assertNotIn(retired + '/', top_paths)
                self.assertIn(route_file(language, retired), self.pages)

    def test_authored_chapter_sections_are_available_before_navigation(self):
        for language in ('en', 'ja'):
            nav = sidebar(self.pages[route_file(language)])
            self.assertFalse(nav.findall('.//details[@open]'))
            for chapter, category in CHAPTERS.items():
                if category is None or chapter in CHILD_CHAPTERS or chapter in IMPLEMENTATION_GUIDES:
                    continue
                headings = [(index, block) for index, block in enumerate(self.content[language][chapter]['blocks'])
                            if block['type'] == 'h2']
                menus = nav.findall(f'.//details[@data-guide-chapter="{chapter}"]')
                with self.subTest(language=language, chapter=chapter):
                    if not headings:
                        self.assertEqual(menus, [])
                        continue
                    self.assertEqual(len(menus), 1)
                    menu = menus[0]
                    summary = menu.find('summary')
                    self.assertTrue(summary.get('aria-label'))
                    self.assertFalse(summary.findall('.//a'))
                    links = menu.findall('./ul/li/a')
                    identifiers = section_ids(self.content['en'][chapter])
                    self.assertEqual([a.text for a in links], [block['text'] for _, block in headings])
                    self.assertEqual([a.get('href') for a in links],
                                     [chapter + '/#' + identifiers[index] for index, _ in headings])
                    target = self.pages[route_file(language, chapter)].decode()
                    for index, block in headings:
                        self.assertIn(f'<h2 id="{identifiers[index]}">{escape(block["text"])}</h2>', target)
                    active_menu = sidebar(self.pages[route_file(language, chapter)]).findall('.//details[@open]')
                    self.assertEqual([d.get('data-guide-chapter') for d in active_menu], [chapter])

    def test_implementation_and_reference_menus_expose_child_routes_on_the_overview(self):
        from guide_html import TEXT
        for language in ('en', 'ja'):
            nav = sidebar(self.pages[route_file(language)])
            expected = {
                **{guide: [(TEXT[language][label], f'{guide}/{section}/')
                           for section, label in IMPLEMENTATION_SECTIONS.items()]
                   for guide in IMPLEMENTATION_GUIDES},
                'settings': [(group['title'], 'settings/' + group['id'] + '/')
                             for group in self.content[language]['settings']['groups']],
                'controls': [(TEXT[language]['control_' + group], 'controls/#controls-' + group)
                             for group in dict.fromkeys(c['group'] for c in self.content[language]['controls']['controls'])],
                'themes': [(theme['label'], 'themes/#' + theme['id'])
                           for theme in self.content[language]['themes']['themes']],
                'api-coverage': [(app, 'api-coverage/' + app + '/') for app in COVERAGE_APPS],
            }
            for chapter, entries in expected.items():
                menu = nav.find(f'.//details[@data-guide-chapter="{chapter}"]')
                self.assertIsNotNone(menu, (language, chapter))
                self.assertNotIn('open', menu.attrib)
                self.assertEqual([(a.text, a.get('href')) for a in menu.findall('./ul/li/a')], entries)
                for _, href in entries:
                    if not href.endswith('/'):
                        continue
                    active_menu = sidebar(self.pages[route_file(language, href.rstrip('/'))]).findall('.//details[@open]')
                    self.assertEqual([d.get('data-guide-chapter') for d in active_menu], [chapter])

    def test_navigation_preparation_keeps_authored_content_unchanged(self):
        before = copy.deepcopy(dict(self.content))
        report = copy.deepcopy(self.report)
        self.assertEqual(build(self.content), self.pages)
        self.assertEqual(dict(self.content), before)
        self.assertEqual(self.report, report)

    def test_sidebar_bookmarks_resolve_duplicate_subheadings_and_reserved_ids(self):
        content = copy.deepcopy(self.content)
        for language, text in [('en', 'Repeated'), ('ja', '同じ見出し')]:
            content[language]['start']['blocks'] = [
                {'type': 'h2', 'text': text}, {'type': 'h3', 'text': text}, {'type': 'h2', 'text': text},
                {'type': 'h2', 'text': text, 'id': 'main'}, {'type': 'h2', 'text': text, 'id': 'sources'},
            ]
        pages = build(content)
        for language in ('en', 'ja'):
            nav = sidebar(pages[route_file(language)])
            links = nav.findall('.//details[@data-guide-chapter="start"]/ul/li/a')
            self.assertEqual([a.get('data-guide-fragment') for a in links],
                             ['repeated', 'repeated-3', 'main-2', 'sources-2'])
            parser = Links()
            parser.feed(pages[route_file(language, 'start')].decode())
            self.assertTrue({'repeated', 'repeated-2', 'repeated-3', 'main-2', 'sources-2'}.issubset(parser.ids))

    def test_operation_guides_have_local_contents_and_web_screens_explain_the_workflow(self):
        for language in ('en', 'ja'):
            for chapter in ('web-screen-controls', 'native-apple', 'native-android',
                            'native-react-native', 'native-vega'):
                self.assertIn('<nav class="guide-onpage"', self.pages[route_file(language, chapter)].decode())
            web = self.content[language]['web-screen-controls']
            self.assertEqual([b['id'] for b in web['blocks'] if b['type'] == 'h2'], [
                'screen', 'themes', 'sources-tracks', 'player-source-settings', 'sdk-settings',
                'applied-code', 'ui-settings', 'external-displays'])
            figures = {b['file'] for b in web['blocks'] if b['type'] == 'figure'}
            self.assertTrue({'overview', 'custom-premiere', 'source-controls', 'config',
                             'sdk-configuration', 'sdk-callback'}.issubset(figures))
            self.assertTrue(any(b['type'] == 'h3' for b in web['blocks']))

    def test_subheadings_are_escaped_and_keep_their_section_bookmarks(self):
        self.assertEqual(render_block({'type': 'h3', 'text': 'API <value>'}, 'en',
                                      route_file('en', 'web-screen-controls'), 'api-detail'),
                         '<h3 id="api-detail">API &lt;value&gt;</h3>')

    def test_platform_implementation_guides_have_local_contents_source_examples_and_search(self):
        sections = ['integration', 'player-source-config', 'ui-customization',
                    'useful-features', 'faq', 'analytics-observability']
        for language in ('en', 'ja'):
            search = json.loads(self.pages[f'{"ja/" if language == "ja" else ""}guide/search-index.json'])
            for chapter in IMPLEMENTATION_GUIDES:
                document = self.content[language][chapter]
                self.assertEqual([b['id'] for b in document['blocks'] if b['type'] == 'h2'], sections)
                html = self.pages[route_file(language, chapter)].decode()
                self.assertIn('class="guide-implementation-contents"', html)
                self.assertNotIn('class="guide-code"', html)
                for section in sections:
                    self.assertIn('id="' + section + '"', html)
                    self.assertIn('href="' + section + '/"', html)
                    self.assertTrue(any(item['url'] == chapter + '/' + section + '/' for item in search))
                self.assertTrue(any(b['type'] == 'code' and 'source' in b for b in document['blocks']))
                self.assertTrue(any(b['type'] == 'figure' for b in document['blocks']))
            for chapter in ('web-player-config', 'web-ui-customization'):
                self.assertIn('<nav class="guide-onpage"', self.pages[route_file(language, chapter)].decode())

    def test_implementation_sections_keep_code_images_bookmarks_and_platform_context(self):
        for language in ('en', 'ja'):
            for guide in IMPLEMENTATION_GUIDES:
                document = self.content[language][guide]
                starts = [i for i, block in enumerate(document['blocks']) if block['type'] == 'h2']
                for start, end in zip(starts, [*starts[1:], len(document['blocks'])]):
                    heading = document['blocks'][start]
                    slug = guide + '/' + heading['id']
                    html = self.pages[route_file(language, slug)].decode()
                    parser = Links()
                    parser.feed(html)
                    self.assertIn(escape(heading['summary']), html)
                    self.assertIn(heading['id'], parser.ids)
                    self.assertIn('../', parser.links)
                    self.assertIn('guide-breadcrumb', html)
                    self.assertIn(escape(document['title']), html)
                    blocks = document['blocks'][start + 1:end]
                    self.assertEqual(html.count('class="guide-code"'), sum(b['type'] == 'code' for b in blocks))
                    self.assertEqual(sum('guide-figure' in figure.get('class', '').split() for figure in parser.figures),
                                     sum(b['type'] == 'figure' for b in blocks))
                    for block in blocks:
                        if block['type'] == 'code':
                            self.assertIn(escape(block['text']), html)
                        elif block['type'] == 'h3':
                            self.assertIn(block['id'], parser.ids)
                            self.assertIn('id="' + block['id'] + '" href="' + heading['id'] + '/#' + block['id'] + '"',
                                          self.pages[route_file(language, guide)].decode())

    def test_implementation_child_navigation_marks_only_the_actual_page(self):
        for language in ('en', 'ja'):
            for guide in IMPLEMENTATION_GUIDES:
                for section in IMPLEMENTATION_SECTIONS:
                    nav = sidebar(self.pages[route_file(language, guide + '/' + section)])
                    active = nav.findall('.//a[@aria-current="page"]')
                    self.assertEqual(len(active), 1)
                    self.assertEqual(active[0].get('href'), './')
                    menus = nav.findall('.//details[@open]')
                    self.assertEqual([menu.get('data-guide-chapter') for menu in menus], [guide])
                    self.assertEqual(len(menus[0].findall('./ul[@class="guide-section-links"]/li')), 6)

    def test_old_combined_chapter_bookmarks_link_to_independent_platform_guides(self):
        bookmarks = {
            'implementation': ['web-player', 'web-settings', 'web-ui-events', 'apple-player',
                'android-player', 'react-native-player', 'vega-player', 'analytics-observability', 'sources'],
            'native-integrations': ['react-native-and-expo', 'react-native-additional-configuration-and-lists',
                'react-native-callbacks-and-native-ui-handlers', 'react-native-operations-state-and-events',
                'react-native-cast-startup-settings', 'vega-os-and-kepler', 'vega-typed-configuration-and-callbacks',
                'vega-operations-state-and-events', 'vega-hls-interstitials', 'applied-configuration-code', 'sources'],
        }
        for language in ('en', 'ja'):
            search = json.loads(self.pages[f'{"ja/" if language == "ja" else ""}guide/search-index.json'])
            for chapter, sections in bookmarks.items():
                parser = Links()
                parser.feed(self.pages[route_file(language, chapter)].decode())
                self.assertTrue(set(sections).issubset(parser.ids))
                self.assertFalse(any(item['url'].split('/')[0] == chapter for item in search))
            prefix = 'https://kazuhide.github.io/player-lab/' + ('ja/' if language == 'ja' else '') + 'guide/'
            combined = Links()
            combined.feed(self.pages[route_file(language, 'implementation')].decode())
            for chapter in IMPLEMENTATION_GUIDES:
                self.assertIn(prefix + chapter + '/', combined.links)
            operations = Links()
            operations.feed(self.pages[route_file(language, 'native-integrations')].decode())
            for chapter in ('native-react-native', 'native-vega'):
                self.assertIn(prefix + chapter + '/', operations.links)

    def test_grouped_controls_keep_every_existing_search_target_and_description(self):
        groups = ('source', 'seek', 'playback', 'ui', 'casting')
        for language in ('en', 'ja'):
            html = self.pages[route_file(language, 'controls')].decode()
            parser = Links()
            parser.feed(html)
            headings = []
            for group in groups:
                identity = 'controls-' + group
                self.assertIn(identity, parser.ids)
                self.assertIn('#' + identity, parser.links)
                headings.append(html.index('id="' + identity + '"'))
            self.assertEqual(headings, sorted(headings))
            for control in self.content[language]['controls']['controls']:
                identity = 'id="' + control['id'] + '"'
                self.assertEqual(html.count(identity), 1)
                start = html.index(identity)
                row = html[start:html.index('</div>', start)]
                self.assertIn(escape(control['label'], quote=True), row)
                self.assertIn(escape(control['description'], quote=True), row)
                group = groups.index(control['group'])
                self.assertGreater(start, headings[group])
                if group + 1 < len(groups):
                    self.assertLess(start, headings[group + 1])

    def test_old_internal_workflow_urls_redirect_to_relevant_same_language_help(self):
        destinations = {'measurement': 'test-results', 'media': 'web-sources-tracks',
                        'cloud-encoding': 'web-sources-tracks', 'live-finalization': 'troubleshooting'}
        for language in ('en', 'ja'):
            for old, destination in destinations.items():
                with self.subTest(language=language, old=old):
                    name = route_file(language, old)
                    parser = Links()
                    parser.feed(self.pages[name].decode())
                    self.assertEqual(parser.refresh, '0; url=../' + destination + '/')
                    self.assertEqual(parser.language, language)
                    prefix = 'ja/' if language == 'ja' else ''
                    self.assertEqual(parser.canonical, 'https://kazuhide.github.io/player-lab/' + prefix + 'guide/' + destination + '/')
                    self.assertIn('../' + destination + '/', parser.links)
                    self.assertNotIn('ffmpeg', self.pages[name].decode().lower())
                    self.assertNotIn('guide-nav', self.pages[name].decode())
            search = json.loads(self.pages[('ja/' if language == 'ja' else '') + 'guide/search-index.json'])
            self.assertFalse(any(entry['url'].split('/')[0] in destinations for entry in search))
            overview = Links()
            overview.feed(self.pages[route_file(language)].decode())
            for old in destinations:
                self.assertNotIn(old + '/', overview.links)
            for chapter in ('web-qoe-analytics', 'analytics-metrics', 'analytics-queries',
                            'analytics-visualization', 'analytics-ai', 'test-results'):
                self.assertIn(chapter + '/', overview.links)
                self.assertTrue(any(entry['url'] == chapter + '/' for entry in search))

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
                    if not value.startswith(PUBLIC_BASE):
                        continue
                    target = uri.path.removeprefix(urlsplit(PUBLIC_BASE).path)
                else:
                    target = posixpath.normpath(posixpath.join(posixpath.dirname(name), uri.path)) if uri.path else name
                if uri.path.endswith('/'):
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
            self.assertEqual(len([entry for entry in index if entry['kind'] == 'setting']), 144)
            self.assertEqual(len([entry for entry in index if entry['kind'] == 'api']),
                             sum(len(app['rows']) for app in self.report['applications']))
            for entry in index:
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), entry['url'].split('#')[0]))
                if entry['url'].split('#')[0].endswith('/'):
                    target += '/index.html'
                self.assertIn(target, self.pages)
                self.assertTrue(entry['title'])
                self.assertTrue(entry['text'])
                if '#' in entry['url']:
                    parsed = Links()
                    parsed.feed(self.pages[target].decode())
                    self.assertIn(entry['url'].split('#')[1], parsed.ids)
                if entry['kind'] == 'api':
                    self.assertNotIn('Public fixture scope', entry['text'])
                    self.assertLess(len(entry['text']), 200)

    def test_literal_markup_in_user_documentation_is_escaped(self):
        result = render_block({'type': 'p', 'text': '<script>alert("example")</script>'}, 'en', 'guide/start/index.html', 'section')
        self.assertIn('&lt;script&gt;', result)
        self.assertNotIn('<script>', result)
        result = render_block({'type': 'code', 'text': '<video autoplay>'}, 'en', 'guide/start/index.html', 'section')
        self.assertIn('&lt;video autoplay&gt;', result)

    def test_related_guide_links_are_readable_and_use_the_same_safe_url_rules(self):
        block = {'type': 'links', 'items': [{'url': 'https://example.test/guide/',
                                            'label': 'Open <guide>'}]}
        result = render_block(block, 'en', route_file('en', 'start'), None)
        self.assertIn('<a href="https://example.test/guide/">Open &lt;guide&gt;</a>', result)
        block['items'][0]['url'] = 'javascript:alert(1)'
        with self.assertRaises(ValueError):
            render_block(block, 'en', route_file('en', 'start'), None)

    def test_code_excerpt_links_to_its_public_source_with_escaped_text(self):
        block = {'type': 'code', 'title': 'Create <Player>', 'text': '<PlayerView />',
                 'source': {'path': 'apps/web/src/main.ts', 'line': 803,
                            'label': 'View <source>'}, 'endLine': 803}
        result = render_block(block, 'en', route_file('en', 'start'), None)
        self.assertIn('Create &lt;Player&gt;', result)
        self.assertIn('View &lt;source&gt;</a>', result)
        self.assertIn('href="' + source_url(block['source']) + '"', result)
        self.assertIn('&lt;PlayerView /&gt;', result)
        block['source'] = {'url': 'javascript:alert(1)', 'label': 'Source'}
        with self.assertRaises(ValueError):
            render_block(block, 'en', route_file('en', 'start'), None)

    def test_code_excerpt_translation_preserves_source_and_line_range(self):
        for mutation in ('line', 'endLine', 'missing'):
            changed = copy.deepcopy(self.content)
            for language in ('en', 'ja'):
                block = next(b for b in changed[language]['local-setup']['blocks'] if b['type'] == 'code')
                block['source'] = {'path': 'README.md', 'line': 1, 'label': language}
                block['endLine'] = 1
                block['text'] = 'One line'
            translated = next(b for b in changed['ja']['local-setup']['blocks'] if b['type'] == 'code')
            if mutation == 'line':
                translated['source']['line'] = 2
                translated['endLine'] = 2
            elif mutation == 'endLine':
                translated['endLine'] = 2
            else:
                del translated['source']
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                build(changed)

    def test_code_excerpts_match_the_referenced_repository_lines(self):
        for chapter, document in self.content['en'].items():
            for block in document.get('blocks', []):
                if block['type'] != 'code' or 'source' not in block:
                    continue
                source = block['source']
                with self.subTest(chapter=chapter, source=source):
                    lines = (ROOT / source['path']).read_text().splitlines()
                    self.assertEqual(block['text'], '\n'.join(lines[source['line'] - 1:block['endLine']]))
                    published = subprocess.check_output([
                        'git', '-C', str(ROOT), 'show', SOURCE_REVISION + ':' + source['path'],
                    ]).decode().splitlines()
                    self.assertEqual(block['text'], '\n'.join(published[source['line'] - 1:block['endLine']]))

    def test_web_event_references_target_the_named_operations(self):
        path = 'apps/web/src/api/explorer.ts'
        anchors = {
            'Event counts and recent-payload history': 'private record(',
            'イベント回数と直近の内容': 'private record(',
            'Record reset on Player replacement': 'this.contexts.clear(); this.resources.clear(); this.counts.clear();',
            'Playerの入れ替え時の記録消去': 'this.contexts.clear(); this.resources.clear(); this.counts.clear();',
            'Explicit event-history reset': 'en: "Clear event history"',
            'イベント履歴の消去操作': 'en: "Clear event history"',
        }
        published = subprocess.check_output([
            'git', '-C', str(ROOT), 'show', SOURCE_REVISION + ':' + path,
        ]).decode().splitlines()
        current = (ROOT / path).read_text().splitlines()
        for language in ('en', 'ja'):
            for chapter in ('web-implementation', 'web-player-config', 'web-screen-controls'):
                matched = set()
                for source in self.content[language][chapter]['sources']:
                    if source.get('path') != path or 'line' not in source:
                        continue
                    expected = anchors.get(source.get('label'))
                    if expected is None and chapter == 'web-screen-controls' and 'label' not in source:
                        expected = 'category.append('
                    if expected is None:
                        continue
                    matched.add(expected)
                    for revision, lines in [('working tree', current), (SOURCE_REVISION, published)]:
                        with self.subTest(language=language, chapter=chapter, source=source, revision=revision):
                            self.assertIn(expected, lines[source['line'] - 1])
                required = set(anchors.values())
                if chapter == 'web-screen-controls':
                    required.add('category.append(')
                self.assertEqual(matched, required)

    def test_footer_source_line_anchors_exist_in_current_and_published_files(self):
        current, published = {}, {}
        for language, chapters in self.content.items():
            for chapter, document in chapters.items():
                for source in document.get('sources', []):
                    if 'path' not in source or 'line' not in source:
                        continue
                    path = source['path']
                    if path not in current:
                        current[path] = (ROOT / path).read_text().splitlines()
                        published[path] = subprocess.check_output([
                            'git', '-C', str(ROOT), 'show', SOURCE_REVISION + ':' + path,
                        ]).decode().splitlines()
                    for revision, lines in [('working tree', current[path]), (SOURCE_REVISION, published[path])]:
                        with self.subTest(language=language, chapter=chapter, source=source, revision=revision):
                            self.assertIs(type(source['line']), int)
                            self.assertGreaterEqual(source['line'], 1)
                            self.assertLessEqual(source['line'], len(lines),
                                                 f"{path}:{source['line']} exceeds {len(lines)} lines at {revision}")

    def test_code_excerpt_rejects_incomplete_or_ambiguous_line_ranges(self):
        for mutation in ('missing-end', 'reversed', 'boolean-end', 'wrong-length', 'external-url'):
            changed = copy.deepcopy(self.content)
            for language in ('en', 'ja'):
                block = next(b for b in changed[language]['local-setup']['blocks'] if b['type'] == 'code')
                block.update(text='One line', source={'path': 'README.md', 'line': 2}, endLine=2)
                if mutation == 'missing-end':
                    del block['endLine']
                elif mutation == 'reversed':
                    block['endLine'] = 1
                elif mutation == 'boolean-end':
                    block['endLine'] = True
                elif mutation == 'wrong-length':
                    block['endLine'] = 3
                else:
                    block['source']['url'] = 'https://example.test/unrelated'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                build(changed)

    def test_sources_reject_script_urls_and_private_or_traversing_paths(self):
        for source in [{'url': 'javascript:alert(1)'}, {'url': 'https://name:password@example.test/doc'},
                       {'path': '../private.md'}, {'path': '/tmp/local.md'}, {'path': 'docs/a.md', 'line': -1}]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                source_url(source)

    def test_current_repository_source_urls_use_the_published_revision(self):
        repository = 'https://github.com/kazuhide/player-lab/blob/'

        for language, chapters in self.content.items():
            for chapter, document in chapters.items():
                with self.subTest(language=language, chapter=chapter):
                    references = list(document.get('sources', []))
                    references.extend(item for block in document.get('blocks', []) if block['type'] == 'links'
                                      for item in block['items'])
                    urls = (source.get('url', '') for source in references)
                    stale = [url for url in urls if url.startswith(repository)
                             and not url.startswith(repository + SOURCE_REVISION + '/')]
                    self.assertEqual(stale, [], 'Current guide source URLs must use SOURCE_REVISION.')

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

    def test_translation_cannot_change_explicit_section_bookmarks(self):
        changed = copy.deepcopy(self.content)
        next(b for b in changed['ja']['apple-implementation']['blocks']
             if b['type'] == 'h2')['id'] = 'different-section'
        with self.assertRaises(ValueError):
            build(changed)

    def test_every_available_api_id_is_static_once_with_a_stable_bilingual_anchor(self):
        for app in self.report['applications']:
            for language in ('en', 'ja'):
                page = self.pages[route_file(language, 'api-coverage/' + app['id'])].decode()
                self.assertEqual(page.count('data-api-id='), len(app['rows']))
                for row in app['rows']:
                    self.assertEqual(page.count('id="' + api_anchor(row['id']) + '"'), 1)
                self.assertIn('https://github.com/kazuhide/player-lab/blob/' + self.report['sourceRevision'], page)
                self.assertIn('b' * 64, page)
                self.assertIn('<details class="guide-api-group" open>', page)
                self.assertIn('role="region"', page)
        self.assertNotEqual(api_anchor('DocC:a/b'), api_anchor('DocC:a.b'))

    def test_metrics_are_derived_and_observations_do_not_earn_action_credit(self):
        overview = self.pages[route_file('en', 'api-coverage')].decode()
        self.assertIn('<td>3</td><td>2 / 3 · 66.67%</td><td>1</td><td>1</td><td>0</td>', overview)
        self.assertNotIn('Overall coverage', overview)
        changed = copy.deepcopy(self.report)
        row = copy.deepcopy(changed['applications'][0]['rows'][0])
        row['id'] += '-added'; row['status'] = 'preset'
        changed['applications'][0]['rows'].append(row)
        pages = build(self.content, coverage=(changed, summarize(changed)))
        updated = pages[route_file('en', 'api-coverage')].decode()
        self.assertIn('<td>4</td><td>3 / 4 · 75.00%</td><td>1</td><td>2</td><td>0</td>', updated)

    def test_code_configuration_is_counted_without_claiming_a_gui_editor(self):
        report = copy.deepcopy(self.report)
        app = next(a for a in report['applications'] if a['id'] == 'ios')
        app['rows'][0]['status'] = 'code-only'
        for status in ('internal', 'sdk-ui-unverified', 'missing'):
            row = copy.deepcopy(app['rows'][0])
            row.update(id='ios:Fixture.' + status, status=status)
            app['rows'].append(row)
        pages = build(self.content, coverage=(report, summarize(report)))
        for language, labels in [('en', ('Configuration APIs used', 'Individual GUI edit', 'GUI preset', 'Code only')),
                                 ('ja', ('設定APIの使用数', 'GUIで個別変更', 'GUIで候補選択', 'コード内のみ'))]:
            table = category_metrics([app], 'configuration', language, route_file(language, 'api-coverage'),
                                     self.content[language]['api-coverage'])
            for label in labels:
                self.assertIn('<th scope="col">' + label + '</th>', table)
            cells = '<td>6</td><td>2 / 6 · 33.33%</td><td>0</td><td>1</td><td>1</td>'
            self.assertIn(cells, table)
            for slug in ('api-coverage', 'api-coverage/ios'):
                self.assertIn(cells, pages[route_file(language, slug)].decode())

    def test_native_configuration_totals_include_audited_code_only_entries(self):
        report = json.loads((ROOT / 'docs/api-coverage/coverage.json').read_text())
        expected = {'ios': (209, '203 / 209 · 97.13%', 203, 0, 0),
                    'tvos': (180, '170 / 180 · 94.44%', 170, 0, 0),
                    'android': (294, '267 / 294 · 90.82%', 267, 0, 0),
                    'react-native': (267, '267 / 267 · 100.00%', 267, 0, 0),
                    'vega': (653, '650 / 653 · 99.54%', 595, 1, 54)}
        for app in report['applications']:
            if app['id'] not in expected:
                continue
            total, used, direct, preset, code = expected[app['id']]
            for language in ('en', 'ja'):
                with self.subTest(app=app['id'], language=language):
                    table = category_metrics([app], 'configuration', language, route_file(language, 'api-coverage'),
                                             self.content[language]['api-coverage'])
                    self.assertIn(f'<td>{total}</td><td>{used}</td><td>{direct}</td><td>{preset}</td><td>{code}</td>', table)

    def test_zero_denominators_have_no_invented_percentage(self):
        changed = copy.deepcopy(self.report)
        for app in changed['applications']:
            app['rows'] = []
        pages = build(self.content, coverage=(changed, summarize(changed)))
        page = pages[route_file('en', 'api-coverage')].decode()
        self.assertIn('0 / 0 · Not applicable', page)
        self.assertNotIn('0.00%', page)

    def test_scope_explanations_and_exclusion_reasons_are_japanese(self):
        for app in COVERAGE_APPS:
            page = self.pages[route_file('ja', 'api-coverage/' + app)].decode()
            self.assertIn('公開テスト用の対象範囲1。', page)
            self.assertIn('コンストラクターの別名。', page)
            self.assertNotIn('Public fixture scope', page)
            self.assertNotIn('Constructor alias.', page)

    def test_missing_or_changed_translation_fails_without_english_fallback(self):
        for mutation in ('missing-note', 'stale-note', 'wrong-number', 'missing-reason',
                         'missing-app-label', 'stale-sdk-label', 'missing-channel'):
            changed = copy.deepcopy(self.content)
            doc = changed['ja']['api-coverage']
            if mutation == 'missing-note':
                doc['noteTranslations']['web'] = []
            elif mutation == 'stale-note':
                doc['noteTranslations']['web'][0]['source'] = 'Changed scope.'
            elif mutation == 'wrong-number':
                doc['noteTranslations']['web'][0]['text'] = '公開テスト用の対象範囲2。'
            elif mutation == 'missing-reason':
                doc['reasonTranslations'] = {}
            elif mutation == 'missing-app-label':
                del doc['appLabels']['web']
            elif mutation == 'stale-sdk-label':
                doc['sdkLabels']['web']['source'] = 'Different SDK'
            else:
                doc['channelLabels'] = {}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                build(changed)
        changed, report = copy.deepcopy(self.content), copy.deepcopy(self.report)
        note = changed['ja']['api-coverage']['noteTranslations']['web'][0]
        note['source'] += ' Player.seek.'; note['text'] += ' Player.pause。'
        report['applications'][0]['scopeNotes'][0] = note['source']
        with self.assertRaises(ValueError):
            build(changed, coverage=(report, summarize(report)))

    def test_renderer_rejects_unsafe_report_urls_paths_and_revisions(self):
        cases = [('reference', 'javascript:alert(1)'), ('reference', 'https://user:pass@cdn.bitmovin.com/player/'),
                 ('reference', 'https://example.org/'), ('reference', 'https://github.com/bitmovin/player-ios/%2e%2e/private'),
                 ('file', '../private.ts'), ('file', '/tmp/player.ts'), ('file', 'app/.env'),
                 ('file', 'app/player.ts#fragment'), ('revision', 'main')]
        for kind, value in cases:
            changed = copy.deepcopy(self.report)
            if kind == 'reference':
                changed['applications'][0]['rows'][0]['officialReference'] = value
            elif kind == 'file':
                changed['applications'][0]['rows'][0]['evidence'][0]['file'] = value
            else:
                changed['sourceRevision'] = value
            with self.subTest(kind=kind, value=value), self.assertRaises(ValueError):
                build(self.content, coverage=(changed, summarize(changed)))

    def test_stale_summary_missing_data_and_duplicate_ids_fail_closed(self):
        with self.assertRaises(ValueError):
            build(dict(self.content))
        summary = copy.deepcopy(self.summary)
        summary['applications'][0]['categories']['configuration']['denominator'] += 1
        with self.assertRaises(ValueError):
            build(self.content, coverage=(self.report, summary))
        for mutation in ('missing-app', 'duplicate-id', 'missing-evidence'):
            changed = copy.deepcopy(self.report)
            if mutation == 'missing-app':
                changed['applications'].pop()
            elif mutation == 'duplicate-id':
                changed['applications'][0]['rows'].append(copy.deepcopy(changed['applications'][0]['rows'][0]))
            else:
                changed['applications'][0]['rows'][0]['evidence'] = []
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                build(self.content, coverage=(changed, summarize(changed)))

    def test_api_markup_is_literal_and_docc_argument_filenames_are_data_only(self):
        changed = copy.deepcopy(self.report)
        row = changed['applications'][0]['rows'][0]
        row['id'] = 'DocC:Fixture.<script>example</script>'
        row['evidence'].append({'kind':'sdk', 'package':'player-ios', 'version':'1.2.3',
            'file':'data/documentation/player/seek(time%3A).json', 'sha256':'c' * 64})
        pages = build(self.content, coverage=(changed, summarize(changed)))
        page = pages[route_file('en', 'api-coverage/web')].decode()
        self.assertIn('&lt;script&gt;example&lt;/script&gt;', page)
        self.assertNotIn('<script>example</script>', page)
        self.assertIn('seek(time%3A).json', page)
        self.assertNotIn('href="data/documentation/', page)
        row['evidence'][-1]['file'] = 'data/%2e%2e/private.json'
        with self.assertRaises(ValueError):
            build(self.content, coverage=(changed, summarize(changed)))

    def test_default_loader_requires_report_summary_and_gap_reasons(self):
        with tempfile.TemporaryDirectory() as directory:
            docs = Path(directory) / 'docs'
            for language in ('en', 'ja'):
                folder = docs / 'guide' / language
                folder.mkdir(parents=True)
                for name, document in self.content[language].items():
                    (folder / (name + '.json')).write_text(json.dumps(document))
            with self.assertRaises(ValueError):
                load_content(docs / 'guide')
            folder = docs / 'api-coverage'
            folder.mkdir()
            (folder / 'coverage.json').write_text(json.dumps(self.report))
            with self.assertRaises(FileNotFoundError):
                load_content(docs / 'guide')
            (folder / 'summary.json').write_text(json.dumps(self.summary))
            with self.assertRaises(FileNotFoundError):
                load_content(docs / 'guide')
            gaps = gap_fixture(self.report)
            (folder / 'gaps.json').write_text(json.dumps(gaps))
            expected = build(self.content, gaps=gaps)
            self.assertEqual(build(load_content(docs / 'guide')), expected)
            gaps['reportInputSha256'] = '0' * 64
            (folder / 'gaps.json').write_text(json.dumps(gaps))
            with self.assertRaises(ValueError):
                build(load_content(docs / 'guide'))


class GuideRenderingTests(unittest.TestCase):
    def test_native_capture_viewports_preserve_localized_images_and_original_dimensions(self):
        expected_profiles = {(1206, 2622): 'ios-phone', (1134, 472): 'ios-detail',
                             (1080, 2400): 'android-phone',
                             (1640, 2360): 'ipad', (1920, 1080): 'tv'}
        caption = 'Player settings <preview> & controls'
        for name, (width, height) in NATIVE_FIGURES.items():
            expected = expected_profiles[(width, height)]
            if name.startswith(('tvos-', 'vega-')):
                expected = 'tv-dense'
            for language in ('en', 'ja'):
                with self.subTest(capture=name, language=language):
                    html = render_block({'type': 'figure', 'file': name, 'caption': caption}, language,
                                        route_file(language, 'native-overview'), '')
                    self.assertEqual(figure_capture_profile(name), expected)
                    self.assertIn(f'data-guide-capture="{expected}"', html)
                    self.assertEqual(html.count('class="guide-capture-link"'), 1)
                    self.assertEqual(html.count('<span class="guide-capture-viewport"><img '), 1)
                    self.assertNotIn('style=', html)
                    self.assertIn('<figcaption>' + escape(caption) + '</figcaption>', html)
                    parser = Links()
                    parser.feed(html)
                    self.assertEqual(len(parser.images), 1)
                    image = parser.images[0]
                    self.assertEqual((image['width'], image['height']), (str(width), str(height)))
                    self.assertEqual(image['alt'], caption)
                    self.assertEqual((image['loading'], image['decoding']), ('lazy', 'async'))
                    self.assertEqual(parser.links, [image['src'], image['src']])
                    self.assertTrue(image['src'].endswith('/' + name + '-' + language + '.png'))

    def test_web_and_dashboard_captures_keep_their_existing_presentation(self):
        for name in ('overview', 'sdk-configuration', 'analytics-dashboard-overview'):
            for language in ('en', 'ja'):
                html = render_block({'type': 'figure', 'file': name, 'caption': 'Screen'}, language,
                                    route_file(language, 'start'), '')
                self.assertIsNone(figure_capture_profile(name))
                self.assertIn('<figure class="guide-figure">', html)
                self.assertNotIn('guide-capture-', html)
                self.assertNotIn('data-guide-capture', html)

    def test_existing_theme_capture_can_illustrate_the_ui_guide(self):
        html = render_block({'type': 'figure', 'file': 'custom-premiere',
                             'caption': 'The Premiere theme.'}, 'en',
                            route_file('en', 'web-ui-customization'), None)
        self.assertIn('assets/guide/custom-premiere-en.jpg', html)
        self.assertIn('width="761" height="429"', html)
        with self.assertRaises(ValueError):
            render_block({'type': 'figure', 'file': 'unregistered-image', 'caption': 'Unknown'},
                         'en', route_file('en', 'web-ui-customization'), None)

    def test_faq_question_and_answer_are_searchable(self):
        text = search_text({'type': 'note', 'title': 'Why does Apply recreate the player?',
                            'text': 'PlayerConfig is applied when creating a player.'})
        self.assertIn('Why does Apply recreate the player?', text)
        self.assertIn('PlayerConfig is applied when creating a player.', text)


if __name__ == '__main__':
    unittest.main()
