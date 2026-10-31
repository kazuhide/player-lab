#!/usr/bin/env python3
"""Check this reference's bilingual Markdown, local links and code examples.

Uses only the Python standard library. Git supplies the public file inventory
when available; an independently copied reference uses the same directory rules.
External URLs are never requested. Technical fenced examples must match exactly.
"""

from html import unescape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlsplit


EXCLUDED_DIRECTORIES = {
    '.git', '.gradle', '.kotlin', '.venv', '__pycache__', 'build',
    'captures', 'coverage', 'node_modules', 'test-results',
}
FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})(.*)$')


def excluded(relative):
    parts = relative.parts
    return (any(part in EXCLUDED_DIRECTORIES or part == '.env' or
                part.startswith('.env.') for part in parts) or
            any(parts[i:i + 2] == ('fixtures', 'generated')
                for i in range(len(parts) - 1)))


def markdown_files(root):
    """Include tracked and new public pages; do not enter generated/private trees."""
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    command = ['git', '-c', 'core.fsmonitor=false', '-C', str(root)]
    try:
        repository = subprocess.run(command + ['rev-parse', '--show-toplevel'],
                                    capture_output=True, env=environment)
    except FileNotFoundError:
        repository = None
    if repository is not None and repository.returncode == 0:
        inventory = subprocess.run(
            command + ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
            capture_output=True, env=environment)
        if inventory.returncode:
            raise ValueError('Git could not enumerate public documentation')
        names = {Path(os.fsdecode(name)) for name in inventory.stdout.split(b'\0') if name}
    else:
        names = set()
    # Git may discover an unrelated parent while an extracted reference is ignored.
    if not {Path('README.md'), Path('LICENSE')}.issubset(names):
        names = set()
        for directory, subdirectories, files in os.walk(root, followlinks=False):
            relative = Path(directory).relative_to(root)
            subdirectories[:] = [name for name in subdirectories
                                 if not excluded(relative / name) and
                                 not (Path(directory) / name).is_symlink()]
            names.update(relative / name for name in files)
    return sorted(name for name in names if name.suffix.lower() == '.md' and not excluded(name))


def prose_and_fences(text):
    """Blank fenced examples while preserving source line numbers for diagnostics."""
    prose, examples, errors = [], [], []
    opening = None
    for number, line in enumerate(text.splitlines(), 1):
        match = FENCE.match(line)
        if opening is None and match:
            marker, info = match.groups()
            opening = (marker, info.strip(), number, [])
            prose.append('')
        elif opening is not None:
            marker, info, start, content = opening
            if match and match[1][0] == marker[0] and len(match[1]) >= len(marker) and not match[2].strip():
                examples.append((info, '\n'.join(content)))
                opening = None
            else:
                content.append(line)
            prose.append('')
        else:
            prose.append(line)
    if opening is not None:
        errors.append((opening[2], 'unclosed fence'))
    return '\n'.join(prose), examples, errors


def strip_comments(text):
    return re.sub(r'<!--[\s\S]*?(?:-->|\Z)', lambda m: '\n' * m[0].count('\n'), text)


def strip_inline_code(text):
    return re.sub(r'(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)',
                  lambda m: ''.join('\n' if char == '\n' else ' ' for char in m[0]), text)


class HtmlTargets(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links, self.anchors = [], set()
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        anchor = attributes.get('id') or (attributes.get('name') if tag == 'a' else None)
        if anchor:
            self.anchors.add(anchor)
        attribute = 'src' if tag == 'img' else 'href' if tag == 'a' else None
        if attribute and attributes.get(attribute) is not None:
            self.links.append((self.getpos()[0], attributes[attribute], tag == 'img'))


def heading_anchors(text):
    anchors, occurrences = set(), {}
    lines = text.splitlines()
    for index, line in enumerate(lines):
        atx = re.match(r'^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$', line)
        setext = index + 1 < len(lines) and re.fullmatch(r' {0,3}(?:=+|-+)[ \t]*', lines[index + 1])
        if not atx and not (setext and line.strip()):
            continue
        title = atx[1] if atx else line.strip()
        title = re.sub(r'!?\[([^]]+)\]\([^)]*\)', r'\1', title)
        title = unescape(re.sub(r'<[^>]*>', '', title)).lower()
        slug = ''.join(character for character in title if character in ' -_' or
                       unicodedata.category(character)[0] in 'LNM').replace(' ', '-')
        count = occurrences.get(slug, 0)
        occurrences[slug] = count + 1
        anchors.add(slug + (f'-{count}' if count else ''))
    return anchors


def destination(text):
    """Read a Markdown target, including balanced parentheses or angle brackets."""
    text = text.lstrip()
    if text.startswith('<'):
        end = text.find('>')
        return text[1:end] if end >= 0 else None
    depth, result, index = 0, [], 0
    while index < len(text):
        character = text[index]
        if character == '\\' and index + 1 < len(text):
            index += 1
            result.append(text[index])
        elif character == '(':
            depth += 1
            result.append(character)
        elif character == ')':
            if depth == 0:
                break
            depth -= 1
            result.append(character)
        elif character.isspace():
            break
        else:
            result.append(character)
        index += 1
    return ''.join(result) if depth == 0 else None


def markdown_links(text):
    text = strip_inline_code(text)
    definitions = {}
    for match in re.finditer(r'^ {0,3}\[([^]\n]+)\]:[ \t]*(.*)$', text, re.MULTILINE):
        definitions[' '.join(match[1].split()).casefold()] = destination(match[2])
    links, errors = [], []
    # A bounded scanner handles local inline and reference links used in guides.
    pattern = r'(?<!!)\[([^]\n]+)\]|!\[([^]\n]*)\]'
    for match in re.finditer(pattern, text):
        rest = text[match.end():]
        if rest.startswith(':'):  # Reference definition, validated when used.
            continue
        label = match[1] if match[1] is not None else match[2]
        line = text.count('\n', 0, match.start()) + 1
        target = None
        if rest.startswith('('):
            target = destination(rest[1:])
            if target is None:
                errors.append((line, 'invalid Markdown destination'))
        elif rest.startswith('[') and ']' in rest:
            reference = rest[1:rest.index(']')] or label
            key = ' '.join(reference.split()).casefold()
            target = definitions.get(key)
            if target is None:
                errors.append((line, f'undefined reference: {reference}'))
        elif ' '.join(label.split()).casefold() in definitions:
            target = definitions[' '.join(label.split()).casefold()]
        if target is not None:
            links.append((line, unescape(target), match[2] is not None))
    return links, errors


def audit(root):
    root = Path(root).resolve()
    errors, documents = [], {}
    local_links = 0

    def error(relative, line, message):
        errors.append(f'{relative.as_posix()}:{line}: {message}')

    try:
        names = markdown_files(root)
    except (OSError, ValueError) as failure:
        return {'pages': 0, 'pairs': 0, 'local_links': 0, 'errors': [str(failure)]}
    if not names:
        return {'pages': 0, 'pairs': 0, 'local_links': 0,
                'errors': ['Reference contains no public Markdown documentation']}
    for relative in names:
        path = root / relative
        if not path.resolve().is_relative_to(root):
            error(relative, 1, 'Markdown path is outside reference')
            continue
        try:
            prose, fences, parse_errors = prose_and_fences(path.read_text(encoding='utf-8'))
            prose = strip_comments(prose)
            html = HtmlTargets(strip_inline_code(prose))
            links, link_errors = markdown_links(prose)
            documents[relative] = (fences, heading_anchors(prose) | html.anchors, links + html.links)
            for line, message in parse_errors + link_errors:
                error(relative, line, message)
        except (OSError, UnicodeError) as failure:
            error(relative, 1, f'cannot read Markdown ({type(failure).__name__})')

    pairs = 0
    for relative, (fences, anchors, links) in documents.items():
        japanese = relative.name.endswith('.ja.md')
        counterpart = relative.with_name(relative.name[:-6] + '.md' if japanese else relative.stem + '.ja.md')
        if counterpart not in documents:
            error(relative, 1, f'missing {"English" if japanese else "Japanese"} counterpart: {counterpart}')
        elif not japanese:
            pairs += 1
            if fences != documents[counterpart][0]:
                error(relative, 1, f'fenced code differs from {counterpart}')
        navigation = set()
        for line, target, image in links:
            try:
                url = urlsplit(target)
                if url.scheme or url.netloc:
                    continue
                path = (root / relative.parent / unquote(url.path)).resolve() if url.path else root / relative
                if not path.is_relative_to(root):
                    error(relative, line, f'link is outside reference: {target}')
                    continue
                resolved = path.relative_to(root)
                local_links += 1
                if excluded(resolved) or not path.is_file():
                    error(relative, line, f'missing public {"image" if image else "file"}: {target}')
                    continue
                if resolved.suffix.lower() == '.md':
                    navigation.add(resolved)
                    if japanese and not resolved.name.endswith('.ja.md') and resolved != counterpart:
                        error(relative, line, f'Japanese page links to English guide: {target}')
                    fragment = unquote(url.fragment)
                    if fragment and (resolved not in documents or fragment not in documents[resolved][1]):
                        error(relative, line, f'missing fragment: {target}')
                if image and japanese and 'screenshots' in resolved.parts and not resolved.stem.endswith('-ja'):
                    error(relative, line, f'screenshot UI language must be Japanese: {target}')
            except ValueError:
                error(relative, line, f'invalid local URL: {target}')
        if counterpart not in navigation:
            error(relative, 1, f'missing language navigation to {counterpart}')
    return {'pages': len(documents), 'pairs': pairs, 'local_links': local_links, 'errors': errors}


def main():
    root = Path(__file__).resolve().parents[2]
    if not (root / 'README.md').is_file() or not (root / 'LICENSE').is_file():
        print('Run this checker inside an intact reference with README.md and LICENSE.', file=sys.stderr)
        return 1
    result = audit(root)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return bool(result['errors'])


if __name__ == '__main__':
    sys.exit(main())
