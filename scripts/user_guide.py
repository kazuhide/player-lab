"""Validate the two language editions and generate static, searchable guide pages."""
import json
import os
from pathlib import Path
import stat

from guide_html import (TEXT, anchor, chapter_links, controls_html, esc, field_anchor, legacy_html, page_html, relative,
                        render_block, settings_group, source_url, sources_html, themes_html)
from guide_routes import (CATEGORIES, CHAPTERS, CHAPTER_ORDER, CHILD_CHAPTERS, COVERAGE_APPS, DOCUMENTS, GUIDE_FILES,
                          IMPLEMENTATION_GUIDES, IMPLEMENTATION_SECTIONS, LANGUAGES, LEGACY_ROUTES,
                          OPERATION_GUIDES, SETTING_GROUPS, THEMES, route_file)
from guide_coverage import app_label, coverage_pages, validate_coverage
from coverage_gaps import validate_gaps


class GuideContent(dict):
    """Language documents with their explicitly loaded coverage inputs."""
    def __init__(self, documents, coverage, gaps=None):
        super().__init__(documents)
        self.coverage = coverage
        self.gaps = gaps


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


def load_content(root, *, coverage=None, gaps=None):
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
        gaps = read_document(folder / 'gaps.json', limit=2 * 1024 * 1024)
    return GuideContent(result, coverage, gaps)


def block_shape(block):
    kind = block['type']
    if kind == 'table':
        width = len(block['headers'])
        if not width or any(len(row) != width for row in block['rows']):
            raise ValueError('A guide table has inconsistent columns.')
        return kind, width, len(block['rows'])
    if kind in {'steps','bullets','links'}:
        return kind, len(block['items'])
    if kind == 'figure':
        return kind, block['file']
    if kind not in {'p', 'h2', 'h3', 'code', 'note'}:
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
            for block in document.get('blocks', []):
                if block['type'] == 'links':
                    for item in block['items']:
                        source_url(item)
                if block['type'] != 'code' or 'source' not in block:
                    continue
                source_url(block['source'])
                line, end = block['source'].get('line'), block.get('endLine')
                if ('path' not in block['source'] or 'url' in block['source']
                        or type(line) is not int or type(end) is not int
                        or end < line or len(block['text'].splitlines()) != end - line + 1):
                    raise ValueError('Code excerpts must name their repository source line range.')
        english, japanese = content['en'][name], content['ja'][name]
        if name in IMPLEMENTATION_GUIDES:
            for document in (english, japanese):
                sections = [block for block in document['blocks'] if block['type'] == 'h2']
                if ([section.get('id') for section in sections] != list(IMPLEMENTATION_SECTIONS)
                        or any(not isinstance(section.get('summary'), str) or not section['summary'].strip()
                               for section in sections)):
                    raise ValueError('Implementation sections need stable routes and localized introductions.')
        if name in CHAPTERS:
            if [block_shape(b) for b in english['blocks']] != [block_shape(b) for b in japanese['blocks']]:
                raise ValueError('Language editions must preserve the same section structure.')
            for first, second in zip(english['blocks'], japanese['blocks']):
                if first['type'] in {'h2', 'h3'} and first.get('id') != second.get('id'):
                    raise ValueError('Translated explicit section bookmarks must match.')
                if first['type'] == 'code' and first['text'] != second['text']:
                    raise ValueError('Language editions must preserve executable examples.')
                if first['type'] == 'code':
                    first_source = source_url(first['source']) if 'source' in first else None
                    second_source = source_url(second['source']) if 'source' in second else None
                    if first_source != second_source or first.get('endLine') != second.get('endLine'):
                        raise ValueError('Translated code excerpts must reference the same source lines.')
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
            raise ValueError('The theme reference must include every theme in UI order.')
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
        if block['type'] in {'h2', 'h3'}:
            base = anchor(block.get('id', block['text'])) or 'section'
            value, number = base, 1
            while value in used:
                number += 1
                value = f'{base}-{number}'
            used.add(value)
            result[index] = value
    return result


def pagination(content, language, page, slug):
    order = list(CHAPTER_ORDER)
    if slug not in order:
        return ''
    index, output = order.index(slug), []
    for delta, key in [(-1,'previous'), (1,'next')]:
        if 0 <= index + delta < len(order):
            target = order[index + delta]
            title = (content[target]['title'] if target in content else
                     TEXT[language][IMPLEMENTATION_SECTIONS[target.rsplit('/', 1)[1]]])
            output.append(f'<a href="{relative(page, route_file(language, target))}"><span>{TEXT[language][key]}</span>{esc(title)}</a>')
    return '<nav class="guide-pagination" aria-label="' + TEXT[language]['contents'] + '">' + ''.join(output) + '</nav>'


def search_text(block):
    if block['type'] == 'note':
        return ' '.join(filter(None, (block.get('title'), block.get('text'))))
    if block['type'] == 'table':
        return ' '.join([*block['headers'], *(cell for row in block['rows'] for cell in row)])
    if block['type'] in {'steps','bullets'}:
        return ' '.join(block['items'])
    if block['type'] == 'links':
        return ' '.join(item['label'] for item in block['items'])
    return block.get('text') or block.get('caption') or ''


def on_page_contents(document, language, headings):
    label = TEXT[language]['section_contents']
    links = ''.join(f'<li><a href="#{esc(identifier)}">{esc(document["blocks"][index]["text"])}</a></li>'
                    for index, identifier in headings.items() if document['blocks'][index]['type'] == 'h2')
    return f'<nav class="guide-onpage" aria-label="{label}"><p>{label}</p><ul>{links}</ul></nav>' if links else ''


def implementation_sections(document, headings):
    """Publish each authored section once, retaining its existing heading bookmarks."""
    starts = [i for i, block in enumerate(document['blocks']) if block['type'] == 'h2']
    result = []
    for start, end in zip(starts, [*starts[1:], len(document['blocks'])]):
        heading = document['blocks'][start]
        blocks = [dict(block, type='h2') if block['type'] == 'h3' else block
                  for block in document['blocks'][start + 1:end]]
        references = {}
        for block in blocks:
            sources = ([block['source']] if block['type'] == 'code' and 'source' in block else
                       block['items'] if block['type'] == 'links' else [])
            for source in sources:
                if not source_url(source).startswith('https://kazuhide.github.io/player-lab/'):
                    references.setdefault(source_url(source), source)
        result.append({'id': heading['id'], 'title': heading['text'], 'lead': heading['summary'],
                       'blocks': blocks, 'sources': list(references.values()),
                       'headings': {i - start - 1: identifier for i, identifier in headings.items()
                                    if start < i < end}})
    return result


def implementation_overview(document, sections, language, page):
    label = TEXT[language]['implementation_sections']
    first = next(i for i, block in enumerate(document['blocks']) if block['type'] == 'h2')
    intro = ''.join(render_block(block, language, page, '') for block in document['blocks'][:first])
    items = []
    for section in sections:
        target = relative(page, route_file(language, document['id'] + '/' + section['id']))
        topics = ''.join(f'<li><a id="{esc(identifier)}" href="{esc(target)}#{esc(identifier)}">'
                         f'{esc(section["blocks"][index]["text"])}</a></li>'
                         for index, identifier in section['headings'].items())
        topics = '<ul>' + topics + '</ul>' if topics else ''
        items.append(f'<li><h2 id="{esc(section["id"])}"><a href="{esc(target)}">{esc(section["title"])}</a></h2>'
                     f'<p>{esc(section["lead"])}</p>{topics}</li>')
    return intro + f'<nav class="guide-implementation-contents" aria-label="{label}"><ul>' + ''.join(items) + '</ul></nav>'


def section_related_links(language, page, guide):
    labels = TEXT[language]
    operation = OPERATION_GUIDES[IMPLEMENTATION_GUIDES.index(guide)]
    targets = [(guide, labels['implementation']), (operation, labels['operation_guide']),
               ('glossary', 'Glossary' if language == 'en' else '用語集')]
    links = ''.join(f'<li><a href="{esc(relative(page, route_file(language, target)))}">{esc(title)}</a></li>'
                    for target, title in targets)
    sources = relative(page, route_file(language, guide)) + '#sources'
    links += f'<li><a href="{esc(sources)}">{labels["sources"]}</a></li>'
    return f'<nav class="guide-related" aria-label="{labels["related_guides"]}"><ul>{links}</ul></nav>'


def append_search(search, document, slug, headings, *, title=None):
    title = title or document['title']
    search.append({'kind': 'chapter', 'title': title, 'url': slug + '/',
                   'excerpt': document['lead'], 'text': ' '.join(search_text(b) for b in document['blocks'])})
    for index, identifier in headings.items():
        following = []
        for block in document['blocks'][index + 1:]:
            if block['type'] in {'h2', 'h3'}:
                break
            following.append(search_text(block))
        text = ' '.join(following)
        if text:
            search.append({'kind': 'section', 'title': title + ' / ' + document['blocks'][index]['text'],
                           'url': slug + '/#' + identifier, 'excerpt': text[:200], 'text': text})


def build(content, *, coverage=None, gaps=None):
    validate_content(content)
    coverage = coverage if coverage is not None else getattr(content, 'coverage', None)
    if not isinstance(coverage, (tuple, list)) or len(coverage) != 2:
        raise ValueError('The guide requires an explicitly loaded coverage report and summary.')
    report, summary = coverage
    validate_coverage(report, summary, content)
    gaps = gaps if gaps is not None else getattr(content, 'gaps', None)
    assessments = validate_gaps(gaps, report) if gaps is not None else None
    pages = {}
    headings = {name:section_ids(content['en'][name]) for name in CHAPTERS}
    # Give every rendered edition the same resolved bookmarks. Navigation and
    # content share these IDs without modifying the authored input documents.
    content = {language: dict(content[language]) for language in LANGUAGES}
    applications = {app['id']: app for app in report['applications']}
    for language, documents in content.items():
        for name, identifiers in headings.items():
            document = documents[name]
            blocks = [dict(block, id=identifiers[index]) if index in identifiers else block
                      for index, block in enumerate(document['blocks'])]
            documents[name] = dict(document, blocks=blocks)
        document = documents['api-coverage']
        documents['api-coverage'] = dict(document, navigation=[
            (app_label(applications[name], document, language), 'api-coverage/' + name, '')
            for name in COVERAGE_APPS])
    for language in LANGUAGES:
        documents, labels = content[language], TEXT[language]
        search = []
        for slug in CHAPTERS:
            document, page = documents[slug], route_file(language, slug)
            if slug in IMPLEMENTATION_GUIDES:
                sections = implementation_sections(document, headings[slug])
                body = implementation_overview(document, sections, language, page)
                body += sources_html(document.get('sources', []), language)
                pages[page] = page_html(documents, language, slug, document['title'], document['lead'], body,
                                       pagination(documents, language, page, slug)).encode()
                search.append({'kind': 'chapter', 'title': document['title'], 'url': slug + '/',
                               'excerpt': document['lead'], 'text': ' '.join(s['lead'] for s in sections)})
                for section in sections:
                    target = slug + '/' + section['id']
                    child = route_file(language, target)
                    body = section_related_links(language, child, slug)
                    body += on_page_contents(section, language, section['headings'])
                    body += ''.join(render_block(block, language, child, section['headings'].get(index, ''))
                                    for index, block in enumerate(section['blocks']))
                    body += sources_html(section['sources'], language)
                    pages[child] = page_html(documents, language, target, section['title'], section['lead'], body,
                                             pagination(documents, language, child, target),
                                             heading_id=section['id']).encode()
                    append_search(search, section, target, section['headings'],
                                  title=document['title'] + ' / ' + section['title'])
                continue
            blocks = ''.join(render_block(block, language, page, headings[slug].get(index, ''))
                             for index, block in enumerate(document['blocks']))
            contents = (on_page_contents(document, language, headings[slug])
                        if slug in (*IMPLEMENTATION_GUIDES, *OPERATION_GUIDES, *CHILD_CHAPTERS) else '')
            body = contents + blocks + sources_html(document.get('sources', []), language)
            pages[page] = page_html(documents, language, slug, document['title'], document['lead'], body,
                                    pagination(documents, language, page, slug)).encode()
            if CHAPTERS[slug] is None:
                continue
            append_search(search, document, slug, headings[slug])
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
        body = controls_html(document['controls'], language)
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
        generated, targets = coverage_pages(content, report, summary, language, assessments=assessments)
        pages.update(generated)
        search.extend(targets)
        page = route_file(language)
        groups = []
        for category in CATEGORIES:
            title = labels['web_group'] if category == 'web' else labels[category]
            links = chapter_links(documents, language, page, category, descriptions=True)
            groups.append(f'<section class="guide-topic-group"><h2>{esc(title)}</h2><ul class="guide-topic-list">{links}</ul></section>')
        pages[page] = page_html(documents, language, '', labels['guide'], labels['intro'], ''.join(groups)).encode()
        index = ('ja/' if language == 'ja' else '') + 'guide/search-index.json'
        pages[index] = (json.dumps(search, ensure_ascii=False, allow_nan=False, separators=(',', ':'))+'\n').encode()
        for slug in LEGACY_ROUTES:
            pages[route_file(language, slug)] = legacy_html(language, slug).encode()
    if set(pages) != GUIDE_FILES:
        raise ValueError('Generated guide files disagree with the public allowlist.')
    return pages
