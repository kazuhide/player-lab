#!/usr/bin/env python3
"""Check complete bilingual content, safe rendering, and navigation contracts."""
import copy
import json
from html.parser import HTMLParser
from pathlib import Path
import posixpath
import tempfile
import unittest
from urllib.parse import unquote, urlsplit

from coverage_report import summarize
from guide_coverage import api_anchor, category_metrics
from guide_routes import COVERAGE_APPS, GUIDE_ASSETS, GUIDE_FILES, route_file
from user_guide import build, load_content, render_block, source_url

ROOT = Path(__file__).resolve().parents[1]


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
        self.assertEqual(sum(path.endswith('.html') for path in self.pages), 94)
        for language in ('en', 'ja'):
            fields = [field for group in self.content[language]['settings']['groups'] for field in group['fields']]
            self.assertEqual(len(fields), 144)
            self.assertEqual(len(self.content[language]['controls']['controls']), 41)
            self.assertEqual(len(self.content[language]['themes']['themes']), 14)

    def test_published_content_builds_with_the_actual_api_report(self):
        pages = build(load_content(ROOT / 'docs/guide'))
        self.assertEqual(set(pages), GUIDE_FILES)

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
        expected = {'ios': (209, '11 / 209 · 5.26%', 0, 5, 6),
                    'tvos': (180, '8 / 180 · 4.44%', 0, 1, 7),
                    'android': (294, '10 / 294 · 3.40%', 0, 5, 5),
                    'react-native': (267, '16 / 267 · 5.99%', 10, 3, 3),
                    'vega': (653, '15 / 653 · 2.30%', 12, 0, 3)}
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

    def test_default_loader_requires_report_and_summary_in_repository_context(self):
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
            self.assertEqual(build(load_content(docs / 'guide')), self.pages)


if __name__ == '__main__':
    unittest.main()
