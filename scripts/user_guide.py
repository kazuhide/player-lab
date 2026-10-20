"""Validate the two language editions and generate static, searchable guide pages."""
import json
import os
from pathlib import Path
import stat

from guide_html import (TEXT, anchor, esc, field_anchor, page_html, relative,
                        render_block, settings_group, source_url, sources_html, themes_html)
from guide_routes import CHAPTERS, DOCUMENTS, GUIDE_FILES, LANGUAGES, SETTING_GROUPS, THEMES, route_file
from guide_coverage import coverage_pages, validate_coverage


class GuideContent(dict):
    """Language documents with their explicitly loaded coverage inputs."""
    def __init__(self, documents, coverage):
        super().__init__(documents)
        self.coverage = coverage


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('A guide document contains duplicate object keys.')
        result[key] = value
    return result


def read_document(path, *, limit=512 * 1024):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as reader:
        metadata = os.fstat(reader.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > limit:
            raise ValueError('Guide inputs must be bounded regular files without links.')
        return json.loads(reader.read().decode('utf-8'), object_pairs_hook=unique_object)


def load_content(root, *, coverage=None):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('The guide input must be a real directory.')
    result = {}
    for language in LANGUAGES:
        folder = root / language
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError('Both real language directories are required.')
        result[language] = {name:read_document(folder / (name + '.json')) for name in DOCUMENTS}
    validate_content(result)
    if coverage is None:
        folder = root.parent / 'api-coverage'
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError('The public API coverage input directory is required.')
        coverage = tuple(read_document(folder / name, limit=10 * 1024 * 1024)
                         for name in ('coverage.json', 'summary.json'))
    return GuideContent(result, coverage)


def block_shape(block):
    kind = block['type']
    if kind == 'table':
        width = len(block['headers'])
        if not width or any(len(row) != width for row in block['rows']):
            raise ValueError('A guide table has inconsistent columns.')
        return kind, width, len(block['rows'])
    if kind in {'steps','bullets'}:
        return kind, len(block['items'])
    if kind == 'figure':
        return kind, block['file']
    if kind not in {'p', 'h2', 'code', 'note'}:
        raise ValueError('Unknown guide block.')
    return kind,


def validate_content(content):
    if set(content) != set(LANGUAGES) or any(set(content[lang]) != set(DOCUMENTS) for lang in LANGUAGES):
        raise ValueError('Both complete guide editions are required.')
    for name in DOCUMENTS:
        for language in LANGUAGES:
            document = content[language][name]
            if document.get('id') != name or not document.get('title') or not document.get('lead'):
                raise ValueError('A guide document is missing its public identity or text.')
            for source in document.get('sources', []):
                source_url(source)
        english, japanese = content['en'][name], content['ja'][name]
        if name in CHAPTERS:
            if [block_shape(b) for b in english['blocks']] != [block_shape(b) for b in japanese['blocks']]:
                raise ValueError('Language editions must preserve the same section structure.')
            for first, second in zip(english['blocks'], japanese['blocks']):
                if first['type'] == 'code' and first['text'] != second['text']:
                    raise ValueError('Language editions must preserve executable examples.')
    groups = {}
    for language in LANGUAGES:
        groups[language] = content[language]['settings']['groups']
        if tuple(g['id'] for g in groups[language]) != SETTING_GROUPS:
            raise ValueError('The settings groups are incomplete or out of order.')
        fields = [f for g in groups[language] for f in g['fields']]
        if len(fields) != 144 or len({(f['scope'],f['path']) for f in fields}) != 144:
            raise ValueError('The reference must describe all 144 distinct settings.')
        for group in groups[language]:
            if group['mode'] not in {'runtime','reload','recreate'}:
                raise ValueError('The settings application mode is unknown.')
            for field in group['fields']:
                if not field.get('description') or field['kind'] not in {'number','text','enum','bool'}:
                    raise ValueError('A setting is missing its description or input type.')
                source_url(field['source'])
        controls = content[language]['controls']['controls']
        themes = content[language]['themes']['themes']
        if len(controls) != 41 or len({item['id'] for item in controls}) != 41:
            raise ValueError('The reference must describe all 41 controls.')
        if tuple(item['id'] for item in themes) != THEMES:
            raise ValueError('The theme reference must include all 14 themes in UI order.')
        for item in [*controls, *themes]:
            if not item.get('description'):
                raise ValueError('A control or theme is missing its description.')
            source_url(item['source'])
    for en, ja in zip(groups['en'], groups['ja']):
        if en['mode'] != ja['mode'] or len(en['fields']) != len(ja['fields']):
            raise ValueError('Translated setting groups disagree.')
        for first, second in zip(en['fields'], ja['fields']):
            keys = ('scope', 'path', 'kind', 'fallback_initial', 'api', 'source')
            if any(first.get(k) != second.get(k) for k in keys) or [o['value'] for o in first['options']] != [o['value'] for o in second['options']]:
                raise ValueError('Translated settings must preserve technical values.')
    for name, keys in [('controls', ('id', 'group', 'kind', 'source')),
                       ('themes', ('id', 'category', 'code', 'source'))]:
        for first, second in zip(content['en'][name][name], content['ja'][name][name]):
            if any(first.get(key) != second.get(key) for key in keys):
                raise ValueError('Translated references must preserve technical values and order.')


def section_ids(document):
    result, used = {}, {'main', 'sources'}
    for index, block in enumerate(document['blocks']):
        if block['type'] == 'h2':
            base = anchor(block['text']) or 'section'
            value, number = base, 1
            while value in used:
                number += 1
                value = f'{base}-{number}'
            used.add(value)
            result[index] = value
    return result


def pagination(content, language, page, slug):
    order = list(CHAPTERS)
    if slug not in order:
        return ''
    index, output = order.index(slug), []
    for delta, key in [(-1,'previous'), (1,'next')]:
        if 0 <= index + delta < len(order):
            target = order[index + delta]
            output.append(f'<a href="{relative(page, route_file(language, target))}"><span>{TEXT[language][key]}</span>{esc(content[target]["title"])}</a>')
    return '<nav class="guide-pagination" aria-label="' + TEXT[language]['contents'] + '">' + ''.join(output) + '</nav>'


def search_text(block):
    if block['type'] == 'table':
        return ' '.join([*block['headers'], *(cell for row in block['rows'] for cell in row)])
    if block['type'] in {'steps','bullets'}:
        return ' '.join(block['items'])
    return block.get('text') or block.get('caption') or ''


def build(content, *, coverage=None):
    validate_content(content)
    coverage = coverage if coverage is not None else getattr(content, 'coverage', None)
    if not isinstance(coverage, (tuple, list)) or len(coverage) != 2:
        raise ValueError('The guide requires an explicitly loaded coverage report and summary.')
    report, summary = coverage
    validate_coverage(report, summary, content)
    pages = {}
    headings = {name:section_ids(content['en'][name]) for name in CHAPTERS}
    for language in LANGUAGES:
        documents, labels = content[language], TEXT[language]
        search = []
        for slug in CHAPTERS:
            document, page = documents[slug], route_file(language, slug)
            blocks = ''.join(render_block(block, language, page, headings[slug].get(index, ''))
                             for index, block in enumerate(document['blocks']))
            body = blocks + sources_html(document.get('sources', []), language)
            pages[page] = page_html(documents, language, slug, document['title'], document['lead'], body,
                                    pagination(documents, language, page, slug)).encode()
            search.append({'kind':'chapter','title':document['title'],'url':slug+'/',
                           'excerpt':document['lead'],'text':' '.join(search_text(b) for b in document['blocks'])})
            for index, identifier in headings[slug].items():
                following = []
                for block in document['blocks'][index+1:]:
                    if block['type'] == 'h2':
                        break
                    following.append(search_text(block))
                text = ' '.join(following)
                if text:
                    search.append({'kind':'section','title':document['title']+' / '+document['blocks'][index]['text'],
                                   'url':slug+'/#'+identifier,'excerpt':text[:200], 'text':text})
        for group in documents['settings']['groups']:
            slug, title = 'settings/'+group['id'], group['title']
            pages[route_file(language, slug)] = page_html(documents, language, slug, title,
                labels['settings'] + ' · ' + labels[group['mode']], settings_group(group, language)).encode()
            for field in group['fields']:
                search.append({'kind':'setting','title':field['scope']+'.'+field['path'],
                               'url':slug+'/#'+field_anchor(field),'excerpt':field['description'],
                               'text':field['label']+' '+field['description']+' '+field.get('api','')})
        page, document = route_file(language, 'settings'), documents['settings']
        items = ''.join(f'<li><a href="{relative(page, route_file(language, "settings/"+group["id"]))}">{esc(group["title"])}</a>'
                        f'<span>{len(group["fields"])} · {labels[group["mode"]]}</span></li>' for group in document['groups'])
        body = (''.join(f'<p class="guide-note">{esc(note)}</p>' for note in document['notes'])
                + f'<ul class="guide-topic-list">{items}</ul>'
                + sources_html(document.get('sources', []), language))
        pages[page] = page_html(documents, language, 'settings', document['title'], document['lead'], body).encode()
        page, document = route_file(language, 'controls'), documents['controls']
        body = '<dl class="guide-controls">' + ''.join(f'<div id="{esc(c["id"])}"><dt>{esc(c["label"])}</dt><dd>{esc(c["description"])}</dd></div>' for c in document['controls']) + '</dl>'
        pages[page] = page_html(documents, language, 'controls', document['title'], document['lead'], body).encode()
        for control in document['controls']:
            search.append({'kind':'control','title':control['label'],'url':'controls/#'+control['id'],
                           'excerpt':control['description'],'text':control['description']})
        page, document = route_file(language, 'themes'), documents['themes']
        pages[page] = page_html(documents, language, 'themes', document['title'], document['lead'],
                                themes_html(document['themes'], language, page)).encode()
        for theme in document['themes']:
            search.append({'kind':'theme','title':theme['label'],'url':'themes/#'+theme['id'],
                           'excerpt':theme['description'],'text':theme['description']+' '+theme['code']})
        generated, targets = coverage_pages(content, report, summary, language)
        pages.update(generated)
        search.extend(targets)
        page = route_file(language)
        groups = []
        for category in ('start', 'web', 'native', 'media', 'reference'):
            title = labels['web_group'] if category == 'web' else labels[category]
            entries = [key for key, group in CHAPTERS.items() if group == category]
            if category == 'reference':
                entries = ['settings','controls','themes','api-coverage',*entries]
            links = ''.join(f'<li><a href="{relative(page, route_file(language, key))}">{esc(documents[key]["title"])}</a>'
                            f'<p>{esc(documents[key]["lead"])}</p></li>' for key in entries)
            groups.append(f'<section class="guide-topic-group"><h2>{esc(title)}</h2><ul class="guide-topic-list">{links}</ul></section>')
        pages[page] = page_html(documents, language, '', labels['guide'], labels['intro'], ''.join(groups)).encode()
        index = ('ja/' if language == 'ja' else '') + 'guide/search-index.json'
        pages[index] = (json.dumps(search, ensure_ascii=False, allow_nan=False, separators=(',', ':'))+'\n').encode()
    if set(pages) != GUIDE_FILES:
        raise ValueError('Generated guide files disagree with the public allowlist.')
    return pages
