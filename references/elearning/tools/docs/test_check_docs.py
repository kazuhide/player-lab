import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote

from check_docs import audit


class DocumentationChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.write('LICENSE', 'Example license\n')
        self.pair('README', '# Reference', '# リファレンス')

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def pair(self, name, english, japanese):
        stem = Path(name)
        navigation = f'[English]({quote(stem.name)}.md) / [日本語]({quote(stem.name)}.ja.md)\n\n'
        self.write(name + '.md', navigation + english + '\n')
        self.write(name + '.ja.md', navigation + japanese + '\n')

    def errors(self):
        return '\n'.join(audit(self.root)['errors'])

    def test_valid_pairs_images_links_and_fences(self):
        example = '```sh\nnpm test\n```'
        self.pair('docs/start', '# Start\n' + example, '<a id="start"></a>\n# 開始\n' + example)
        self.write('docs/image.png', 'image placeholder')
        for name in ['README.md', 'README.ja.md']:
            with (self.root / name).open('a') as f:
                suffix = '.ja' if '.ja.' in name else ''
                f.write(f'\n[Start](docs/start{suffix}.md#start)\n<img src="docs/image.png">\n')
        result = audit(self.root)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['pairs'], 2)
        self.assertGreaterEqual(result['local_links'], 12)

    def test_missing_japanese_counterpart_fails(self):
        (self.root / 'README.ja.md').unlink()
        self.assertIn('Japanese counterpart', self.errors())

    def test_orphan_japanese_counterpart_fails(self):
        self.write('orphan.ja.md', '# 孤立\n')
        self.assertIn('English counterpart', self.errors())

    def test_missing_language_navigation_fails(self):
        self.write('README.md', '# Reference\n')
        self.assertIn('language navigation', self.errors())

    def test_missing_local_file_and_image_fail(self):
        with (self.root / 'README.md').open('a') as f:
            f.write('[`Missing`](absent.json)\n![Missing](absent.png)\n')
        errors = self.errors()
        self.assertIn('absent.json', errors)
        self.assertIn('absent.png', errors)

    def test_missing_markdown_fragment_fails(self):
        with (self.root / 'README.md').open('a') as f:
            f.write('[Missing](#not-a-heading)\n')
        self.assertIn('missing fragment', self.errors())

    def test_encoded_paths_queries_duplicate_headings_and_explicit_ids(self):
        self.pair('docs/a file', '# A &amp; B\n## Again\n## Again\n<span id="fixed"></span>', '# 日本語\n<a id="a--b"></a>')
        with (self.root / 'README.md').open('a') as f:
            f.write('[One](docs/a%20file.md?view=plain#a--b)\n')
            f.write('[Two](<docs/a file.md#again-1>)\n')
            f.write('[Three](docs/a%20file.md#fixed)\n')
        self.assertEqual(self.errors(), '')

    def test_balanced_parentheses_and_reference_links(self):
        self.write('a(b).json', '{}')
        with (self.root / 'README.md').open('a') as f:
            f.write('[Inline](a(b).json "Example")\n[Reference][data]\n[data]: a(b).json\n')
        self.assertEqual(self.errors(), '')

    def test_undefined_full_reference_link_fails(self):
        with (self.root / 'README.md').open('a') as f:
            f.write('[Reference][unknown]\n')
        self.assertIn('undefined reference', self.errors())

    def test_code_examples_and_comments_are_not_links_or_headings(self):
        example = '````md\n# Not a heading\n[Not a link](missing.md)\n```\n````'
        self.pair('docs/example', example, example)
        for name in ['README.md', 'README.ja.md']:
            with (self.root / name).open('a') as f:
                f.write('`[literal](missing.md)`\n`<img src="missing.png">`\n<!-- [comment](missing.md) -->\n')
        self.assertEqual(self.errors(), '')
        with (self.root / 'README.md').open('a') as f:
            f.write('[Bad](docs/example.md#not-a-heading)\n')
        self.assertIn('missing fragment', self.errors())

    def test_differing_or_unclosed_fenced_examples_fail(self):
        self.pair('docs/code', '```sh\nnpm test\n```', '```sh\nnpm start\n```')
        self.assertIn('fenced code', self.errors())
        self.write('docs/code.ja.md', '[English](code.md) / [日本語](code.ja.md)\n```sh\nnpm test\n')
        self.assertIn('unclosed fence', self.errors())

    def test_ignored_generated_and_dependency_pages_are_not_scanned(self):
        for directory in ['node_modules/pkg', 'android/build/output', '.gradle/caches', 'fixtures/generated', 'test-results/run', '__pycache__', '.env.private']:
            self.write(directory + '/unpaired.md', '[private](missing.md)')
        self.assertEqual(audit(self.root)['pages'], 2)
        self.assertEqual(self.errors(), '')

    def test_git_inventory_failure_is_not_silently_accepted(self):
        responses = [subprocess.CompletedProcess([], 0, b'/repository\n'),
                     subprocess.CompletedProcess([], 128, b'', b'cannot read index')]
        with patch('check_docs.subprocess.run', side_effect=responses):
            self.assertIn('Git could not enumerate', self.errors())

    def test_encoded_japanese_fragment_and_same_page_query(self):
        self.pair('docs/unicode', '# 日本語', '# 日本語')
        with (self.root / 'docs/unicode.md').open('a') as f:
            f.write('[Section](?plain=1#%E6%97%A5%E6%9C%AC%E8%AA%9E)\n')
        self.assertEqual(self.errors(), '')

    def test_external_links_are_not_fetched(self):
        with (self.root / 'README.md').open('a') as f:
            f.write('[Network](https://unreachable.invalid/file.md#missing)\n')
            f.write('[CDN](//unreachable.invalid/image.png)\n[Email](mailto:demo@example.invalid)\n')
        self.assertEqual(self.errors(), '')

    def test_encoded_escape_and_symlink_targets_cannot_leave_reference(self):
        with (self.root / 'README.md').open('a') as f:
            f.write('[Escape](%2e%2e/elsewhere.md)\n')
        self.assertIn('outside reference', self.errors())
        outside = self.root.parent / (self.root.name + '-outside.md')
        outside.write_text('Do not read this file')
        self.addCleanup(outside.unlink)
        (self.root / 'escape.md').symlink_to(outside)
        self.assertIn('outside reference', self.errors())

    def test_japanese_links_and_screenshots_preserve_ui_language(self):
        self.pair('docs/start', '# Start', '# 開始')
        self.write('docs/screenshots/view-en.png', 'image placeholder')
        with (self.root / 'README.ja.md').open('a') as f:
            f.write('[Wrong guide](docs/start.md)\n<img src="docs/screenshots/view-en.png">\n')
        errors = self.errors()
        self.assertIn('English guide', errors)
        self.assertIn('UI language', errors)

    def test_checker_cli_operates_in_an_independent_copy_without_git(self):
        script = self.root / 'tools/docs/check_docs.py'
        script.parent.mkdir(parents=True)
        shutil.copyfile(Path(__file__).with_name('check_docs.py'), script)
        environment = dict(os.environ, PATH='')
        result = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, env=environment)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['pairs'], 1)
        (self.root / 'README.ja.md').unlink()
        broken = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, env=environment)
        self.assertNotEqual(broken.returncode, 0)


if __name__ == '__main__':
    unittest.main()
