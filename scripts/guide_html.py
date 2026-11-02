"""Escape and render the user guide using the existing Pages visual language."""
import html
import json
from pathlib import PurePosixPath
import posixpath
import re
from urllib.parse import urlsplit

from guide_routes import (CATEGORIES, CONTENT_REVIEW, LEGACY_ROUTES, LOCALIZED_FIGURES, PUBLIC_BASE,
                          SHARED_FIGURES, SOURCE_REVISION, figure_capture_profile, figure_path, route_file)

TEXT = {
    'en': {
        'apple': 'iOS / iPadOS / tvOS',
        'android': 'Android / Android TV / Fire TV',
        'react-native': 'React Native',
        'vega': 'Vega OS',
        'operation_guide': 'Screen and controls',
        'integration_guide': 'Integration',
        'features_guide': 'Playback features and events',
        'implementation_sections': 'Implementation sections',
        'related_guides': 'Related guides',
        'configuration_guide': 'PlayerConfig / SourceConfig',
        'ui_customization_guide': 'UI customization',
        'useful_features': 'Useful features',
        'faq': 'FAQ',
        'section_contents': 'On this page',
        'section_toggle': '{platform}: {chapter} sections',
        'guide': 'User guide', 'home': 'Project home', 'web': 'Web app', 'contents': 'Contents',
        'skip': 'Skip to content', 'search': 'Search the guide', 'search_hint': 'Search topics, settings, or API names',
        'search_loading': 'Searching…', 'search_empty': 'No matching topics.',
        'search_error': 'Search could not load. Use the contents or try again.',
        'search_count': '{count} results', 'search_help': 'Enter at least two characters. Up to 12 results are shown.',
        'sources': 'Sources', 'code': 'Code sample', 'table': 'Reference table',
        'previous': 'Previous', 'next': 'Next', 'overview': 'Guide overview',
        'start': 'Getting started', 'native': 'Native examples', 'analytics': 'Analytics / Observability',
        'reference': 'Reference', 'web_group': 'Web', 'implementation': 'Implementation guide',
        'settings': 'Player Config reference', 'controls': 'Controls reference', 'themes': 'Theme reference',
        'control_groups': 'Control groups', 'control_source': 'Source presets',
        'control_seek': 'Playback position', 'control_playback': 'Playback behavior',
        'control_ui': 'Player UI', 'control_casting': 'External displays',
        'api-coverage': 'Public API coverage',
        'kind': 'Input', 'fallback': 'Form fallback', 'options': 'Choices', 'api': 'Player API',
        'field': 'Setting', 'description': 'Meaning and use', 'mode': 'Applies',
        'runtime': 'Immediately', 'reload': 'Reload the source', 'recreate': 'Recreate the player',
        'number': 'Number', 'bool': 'Boolean', 'text': 'Text', 'enum': 'Choice',
        'button': 'Button', 'checkbox': 'Checkbox', 'select': 'Choice',
        'default': 'Standard UI', 'css': 'Standard UI with CSS', 'custom': 'Custom component layout',
        'review': f'Content reviewed {CONTENT_REVIEW}.',
        'fallback_note': 'Form fallback values are used when the editor cannot read an applied value. They are not SDK defaults, current effective values, or recommendations.',
        'credit': 'Screen captures include Big Buck Bunny, © 2008 Blender Foundation, under Creative Commons Attribution 3.0.',
        'license': 'Project code: MIT. The Bitmovin Player SDK has its own license.',
        'no_script': 'The chapters and references work without JavaScript. Use the contents or your browser’s Find command.',
        'intro': 'Try playback features, change configuration and UI, inspect applied code, and explore playback analytics.',
        'reference_intro': 'Find an individual setting, control, or theme. The chapters explain the workflows and their limits.',
    },
    'ja': {
        'apple': 'iOS・iPadOS・tvOS',
        'android': 'Android・Android TV・Fire TV',
        'react-native': 'React Native',
        'vega': 'Vega OS',
        'operation_guide': '画面と操作',
        'integration_guide': '組み込み',
        'features_guide': '再生機能とイベント',
        'implementation_sections': '実装ガイドの内容',
        'related_guides': '関連するガイド',
        'configuration_guide': 'PlayerConfig / SourceConfig',
        'ui_customization_guide': 'UI変更ガイド',
        'useful_features': '有用な情報',
        'faq': 'FAQ',
        'section_contents': 'このページの内容',
        'section_toggle': '{platform}：{chapter}の見出しを開閉',
        'guide': 'ユーザーガイド', 'home': 'プロジェクトのホーム', 'web': 'Web版', 'contents': '目次',
        'skip': '本文へ移動', 'search': 'ガイド内を検索', 'search_hint': '機能、設定名、API名を検索',
        'search_loading': '検索中…', 'search_empty': '一致する項目はありません。',
        'search_error': '検索データを読み込めませんでした。目次を使うか、もう一度検索してください。',
        'search_count': '{count}件', 'search_help': '2文字以上で検索します。結果は最大12件表示します。',
        'sources': '参照資料', 'code': 'コード例', 'table': '参照表',
        'previous': '前の章', 'next': '次の章', 'overview': 'ガイドの概要',
        'start': '利用の準備', 'native': 'ネイティブ版', 'analytics': 'Analytics / Observability',
        'reference': 'リファレンス', 'web_group': 'Web版', 'implementation': '実装ガイド',
        'settings': 'Player Configの設定一覧', 'controls': '操作一覧', 'themes': 'テーマ一覧',
        'control_groups': '操作の分類', 'control_source': 'ソース',
        'control_seek': '再生位置', 'control_playback': '再生動作',
        'control_ui': 'プレイヤーUI', 'control_casting': '外部画面への出力',
        'api-coverage': '公開APIの対応状況',
        'kind': '入力形式', 'fallback': '代替表示値', 'options': '選択肢', 'api': 'Player API',
        'field': '設定名', 'description': '意味と使い方', 'mode': '適用方法',
        'runtime': '即時に適用', 'reload': 'ソースを再読み込み', 'recreate': 'Playerを再生成',
        'number': '数値', 'bool': '真偽値', 'text': '文字列', 'enum': '選択',
        'button': 'ボタン', 'checkbox': 'チェック', 'select': '選択',
        'default': '標準UI', 'css': '標準UIのCSS変更', 'custom': 'カスタム構成',
        'review': f'内容の確認日: {CONTENT_REVIEW}。',
        'fallback_note': '代替表示値は、フォームが適用値を読み取れない場合に使う値です。SDKの既定値、現在の実効値、推奨値ではありません。',
        'credit': '画面例の映像: Big Buck Bunny © 2008 Blender Foundation。Creative Commons Attribution 3.0で利用しています。',
        'license': 'プロジェクトのコードはMITライセンスです。Bitmovin Player SDKには別の利用条件が適用されます。',
        'no_script': '本文と参照資料はJavaScriptを使わずに読めます。目次またはブラウザーのページ内検索を利用してください。',
        'intro': '再生機能、各種設定、UIの変更を試し、設定を反映したコード例や再生品質のデータを確認するためのガイドです。',
        'reference_intro': '個別の設定、操作、テーマを探すための一覧です。操作の流れと制限は各章で説明しています。',
    },
}

def esc(value):
    return html.escape(str(value), quote=True)


def relative(page, target):
    value = posixpath.relpath(target, posixpath.dirname(page))
    return value[:-10] or './' if value.endswith('index.html') else value


def anchor(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def source_url(source):
    if 'url' in source:
        url = source['url']
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query:
            raise ValueError('Sources must use public HTTPS URLs without credentials or queries.')
        return url
    path = source.get('path', '')
    if not path or not re.fullmatch(r'[A-Za-z0-9_./-]+', path) or PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
        raise ValueError('Source paths must be public relative paths.')
    line = source.get('line')
    if line is not None and (type(line) is not int or line < 1):
        raise ValueError('A source line must be a positive integer.')
    return f'https://github.com/kazuhide/player-lab/blob/{SOURCE_REVISION}/{path}' + (f'#L{line}' if line else '')


def render_block(block, language, page, section_id):
    kind, labels = block['type'], TEXT[language]
    text = esc(block.get('text', '')).replace('\n', '<br>')
    if kind == 'p':
        return f'<p>{text}</p>'
    if kind in {'h2', 'h3'}:
        return f'<{kind} id="{esc(section_id)}">{text}</{kind}>'
    if kind == 'note':
        title = f'<strong>{esc(block["title"])}</strong>' if block.get('title') else ''
        return f'<aside class="guide-note">{title}<p>{text}</p></aside>'
    if kind in {'steps', 'bullets'}:
        tag = 'ol' if kind == 'steps' else 'ul'
        return f'<{tag}>' + ''.join(f'<li>{esc(item)}</li>' for item in block['items']) + f'</{tag}>'
    if kind == 'links':
        return '<ul>' + ''.join(f'<li><a href="{esc(source_url(item))}">{esc(item["label"])}</a></li>'
                               for item in block['items']) + '</ul>'
    if kind == 'code':
        caption = [esc(block['title'])] if block.get('title') else []
        if 'source' in block:
            source = block['source']
            label = source.get('label') or source.get('path') or source.get('url')
            caption.append(f'<a href="{esc(source_url(source))}">{esc(label)}</a>')
        title = '<figcaption>' + ' · '.join(caption) + '</figcaption>' if caption else ''
        return f'<figure class="guide-code">{title}<pre tabindex="0" aria-label="{labels["code"]}"><code>{esc(block["text"])}</code></pre></figure>'
    if kind == 'table':
        head = ''.join(f'<th scope="col">{esc(value)}</th>' for value in block['headers'])
        rows = ''.join('<tr>' + ''.join(f'<td>{esc(value)}</td>' for value in row) + '</tr>' for row in block['rows'])
        return f'<div class="guide-table" tabindex="0" role="region" aria-label="{labels["table"]}"><table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'
    if kind == 'figure':
        name = block['file']
        src = relative(page, figure_path(name, language))
        width, height = (LOCALIZED_FIGURES[name][language] if name in LOCALIZED_FIGURES
                         else SHARED_FIGURES[name])
        picture = f'<img src="{esc(src)}" width="{width}" height="{height}" alt="{esc(block["caption"])}" loading="lazy" decoding="async">'
        label = 'Open full-size image' if language == 'en' else '元のサイズの画像を開く'
        profile = figure_capture_profile(name)
        if profile:
            picture = '<span class="guide-capture-viewport">' + picture + '</span>'
        link_class = ' class="guide-capture-link"' if profile else ''
        picture = f'<a{link_class} href="{esc(src)}" aria-label="{label}: {esc(block["caption"])}">{picture}</a>'
        attributes = (f' class="guide-figure guide-figure-capture" data-guide-capture="{esc(profile)}"'
                      if profile else ' class="guide-figure"')
        return f'<figure{attributes}>{picture}<figcaption>{esc(block["caption"])}</figcaption></figure>'
    raise ValueError('The guide contains an unknown block type.')


def sources_html(sources, language):
    if not sources:
        return ''
    links = ''.join(f'<li><a href="{esc(source_url(source))}">{esc(source.get("label") or source.get("path") or source["url"])}</a></li>' for source in sources)
    return f'<section class="guide-sources" aria-labelledby="sources"><h2 id="sources">{TEXT[language]["sources"]}</h2><ul>{links}</ul></section>'


def field_anchor(field):
    return 'setting-' + anchor(field['scope'] + '-' + field['path'])


def chapter_sections(content, language, chapter):
    """Use authored headings and reference groups as the navigation catalogue."""
    from guide_routes import IMPLEMENTATION_GUIDES, IMPLEMENTATION_SECTIONS
    labels, document = TEXT[language], content[chapter]
    if chapter in IMPLEMENTATION_GUIDES:
        return [(labels[label], f'{chapter}/{section}', '')
                for section, label in IMPLEMENTATION_SECTIONS.items()]
    if chapter == 'settings':
        return [(group['title'], 'settings/' + group['id'], '') for group in document['groups']]
    if chapter == 'controls':
        groups = dict.fromkeys(control['group'] for control in document['controls'])
        return [(labels['control_' + group], chapter, 'controls-' + group) for group in groups]
    if chapter == 'themes':
        return [(theme['label'], chapter, theme['id']) for theme in document['themes']]
    if chapter == 'api-coverage':
        return document['navigation']
    return [(block['text'], chapter, block['id']) for block in document['blocks'] if block['type'] == 'h2']


def current_page_attributes(selected):
    return ' aria-current="page" data-guide-page-current=""' if selected else ''


def chapter_links(content, language, page, category, current='', *, descriptions=False):
    """Render the same platform hierarchy in the sidebar and guide overview."""
    from guide_routes import (CHAPTERS, CHAPTER_PARENTS, CHILD_CHAPTERS, IMPLEMENTATION_GUIDES,
                              OPERATION_GUIDES)
    labels = TEXT[language]
    entries = [key for key, group in CHAPTERS.items() if group == category and key not in CHILD_CHAPTERS]
    if category == 'reference':
        entries = ['settings', 'controls', 'themes', 'api-coverage', *entries]
    output = []
    for key in entries:
        title = (labels['implementation'] if key in IMPLEMENTATION_GUIDES else
                 labels['operation_guide'] if key in OPERATION_GUIDES else content[key]['title'])
        href = relative(page, route_file(language, key))
        active_page = CHAPTER_PARENTS.get(current, current)
        in_branch = active_page == key or active_page.startswith(key + '/')
        active = current_page_attributes(current == key)
        if in_branch:
            active += ' data-section-current="true"'
        sections = chapter_sections(content, language, key) if not descriptions else []
        link_class = ' class="guide-chapter-link"' if sections else ''
        item = f'<a{link_class} href="{esc(href)}"{active}>{esc(title)}</a>'
        if sections:
            children = []
            for label, target, fragment in sections:
                selected = current_page_attributes(current == target and not fragment)
                destination = relative(page, route_file(language, target))
                if fragment:
                    destination += '#' + fragment
                    selected += f' data-guide-fragment="{esc(fragment)}"'
                children.append(f'<li><a href="{esc(destination)}"{selected}>{esc(label)}</a></li>')
            platform = labels['web_group'] if category == 'web' else labels[category]
            toggle = labels['section_toggle'].format(platform=platform, chapter=title)
            opened = ' open=""' if in_branch else ''
            item += (f'<details class="guide-chapter-sections" data-guide-chapter="{esc(key)}"{opened}>'
                     f'<summary aria-label="{esc(toggle)}"><span class="guide-disclosure-icon" aria-hidden="true"></span></summary>'
                     '<ul class="guide-section-links">' + ''.join(children) + '</ul></details>')
        if descriptions:
            item += f'<p>{esc(content[key]["lead"])}</p>'
        item_class = ' class="guide-chapter"' if sections else ''
        output.append(f'<li{item_class}>' + item + '</li>')
    return ''.join(output)


def navigation(content, language, page, current):
    labels, output = TEXT[language], []
    for category in CATEGORIES:
        title = labels['web_group'] if category == 'web' else labels[category]
        links = chapter_links(content, language, page, category, current)
        output.append(f'<section><h3>{esc(title)}</h3><ul>{links}</ul></section>')
    return f'<nav class="guide-nav" aria-label="{labels["contents"]}">' + ''.join(output) + '</nav>'


def legacy_html(language, slug):
    """Keep bookmarks usable without publishing retired authoring workflows."""
    target = LEGACY_ROUTES[slug]
    page = route_file(language, slug)
    destination = relative(page, route_file(language, target))
    canonical = PUBLIC_BASE + route_file(language, target).removesuffix('index.html')
    other = 'ja' if language == 'en' else 'en'
    alternate = PUBLIC_BASE + route_file(other, target).removesuffix('index.html')
    title = 'Page moved' if language == 'en' else 'ページを移動しました'
    message = 'Open the updated guide' if language == 'en' else '新しいガイドを開く'
    return f'''<!doctype html>
<html lang="{language}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url={esc(destination)}">
<title>{title} | Player Lab</title>
<link rel="canonical" href="{canonical}"><link rel="alternate" hreflang="{other}" href="{alternate}">
<link rel="stylesheet" href="{esc(relative(page, 'styles.css'))}">
<link rel="stylesheet" href="{esc(relative(page, 'guide.css'))}">
</head>
<body><main class="guide-main"><h1>{title}</h1><p><a href="{esc(destination)}">{message}</a></p><!-- PLAYER_LAB_BUILD --></main></body>
</html>
'''


def page_html(content, language, slug, title, lead, body, pagination='', *, heading_id=''):
    labels, page = TEXT[language], route_file(language, slug)
    other = 'ja' if language == 'en' else 'en'
    language_label = '日本語' if other == 'ja' else 'English'
    home = 'ja/index.html' if language == 'ja' else 'index.html'
    nav = navigation(content, language, page, slug)
    search_index = relative(page, ('ja/' if language == 'ja' else '') + 'guide/search-index.json')
    search_messages = ' '.join(f'data-msg-{key}="{esc(labels["search_" + key])}"' for key in ['loading', 'empty', 'error', 'count'])
    canonical = PUBLIC_BASE + page.removesuffix('index.html')
    alternative = PUBLIC_BASE + route_file(other, slug).removesuffix('index.html')
    stylesheet = esc(relative(page, 'styles.css'))
    guide_css = esc(relative(page, 'guide.css'))
    script = esc(relative(page, 'guide.js'))
    from guide_routes import CHAPTER_PARENTS
    parent = CHAPTER_PARENTS.get(slug)
    breadcrumb = (f'<a href="{esc(relative(page, route_file(language, parent)))}">{esc(content[parent]["title"])}</a>'
                  if parent else '')
    heading = f' id="{esc(heading_id)}"' if heading_id else ''
    return f'''<!doctype html>
<html lang="{language}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{esc(lead)}"><meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>{esc(title)} | Player Lab</title>
<link rel="canonical" href="{canonical}"><link rel="alternate" hreflang="{other}" href="{alternative}">
<link rel="icon" href="{esc(relative(page, 'assets/favicon.svg'))}" type="image/svg+xml">
<link rel="stylesheet" href="{stylesheet}"><link rel="stylesheet" href="{guide_css}">
<script src="{script}" defer></script>
</head>
<body class="guide-page">
<a class="skip-link" href="#main">{labels['skip']}</a>
<header class="site-header guide-header wrap">
<a class="wordmark" href="{esc(relative(page, home))}">Player Lab</a>
<nav aria-label="{labels['guide']}"><a href="{esc(relative(page, 'web/index.html'))}">{labels['web']}</a>
<a data-guide-language href="{esc(relative(page, route_file(other, slug)))}" lang="{other}" hreflang="{other}" hidden>{language_label}</a>
<noscript><a data-guide-language-fallback href="{esc(relative(page, route_file(other, slug)))}" lang="{other}" hreflang="{other}">{language_label}</a></noscript></nav>
</header>
<div class="guide-shell wrap">
<aside class="guide-sidebar"><h2>{labels['contents']}</h2>{nav}</aside>
<main id="main" class="guide-main" tabindex="-1">
<nav class="guide-breadcrumb" aria-label="{labels['home']}"><a href="{esc(relative(page, home))}">Player Lab</a><a href="{esc(relative(page, route_file(language)))}">{labels['guide']}</a>{breadcrumb}</nav>
<div class="guide-search" data-guide-search-container hidden data-search-index="{esc(search_index)}" {search_messages}>
<label for="guide-search">{labels['search']}</label>
<input id="guide-search" data-guide-search type="search" placeholder="{labels['search_hint']}" autocomplete="off" aria-describedby="guide-search-help guide-search-status">
<p id="guide-search-help">{labels['search_help']}</p><p id="guide-search-status" data-search-status role="status" aria-live="polite"></p>
<ol data-search-results hidden></ol></div>
<details class="guide-mobile-contents"><summary>{labels['contents']}</summary>{nav}</details>
<h1{heading}>{esc(title)}</h1><p class="guide-lead">{esc(lead)}</p>
<noscript><p class="guide-note">{labels['no_script']}</p></noscript>
{body}{pagination}
</main></div>
<footer class="site-footer wrap"><p>{labels['review']} <a href="https://github.com/kazuhide/player-lab">GitHub</a></p>
<!-- PLAYER_LAB_BUILD -->
<p>{labels['license']} <a href="{esc(relative(page, 'web/notices/BITMOVIN-PLAYER-NOTICE.txt'))}">SDK notice</a>.</p>
<p>{labels['credit']} <a href="https://peach.blender.org/about/">Blender Foundation</a> · <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>.</p></footer>
</body></html>'''


def settings_group(group, language):
    labels = TEXT[language]
    output = [f'<p class="guide-mode">{labels[group["mode"]]}</p>',
              f'<aside class="guide-note"><p>{labels["fallback_note"]}</p></aside>']
    for field in group['fields']:
        identity, description = field_anchor(field), field['description']
        fallback = json.dumps(field['fallback_initial'], ensure_ascii=False, allow_nan=False)
        choices = ' / '.join(f'{option["label"]} ({option["value"]})' for option in field['options'])
        metadata = f'<dt>{labels["kind"]}</dt><dd>{labels.get(field["kind"], esc(field["kind"]))}</dd><dt>{labels["fallback"]}</dt><dd><code>{esc(fallback)}</code></dd>'
        if choices:
            metadata += f'<dt>{labels["options"]}</dt><dd>{esc(choices)}</dd>'
        if field.get('api'):
            metadata += f'<dt>{labels["api"]}</dt><dd><code>{esc(field["api"])}</code></dd>'
        output.append(f'<article class="guide-setting" data-setting id="{identity}"><h2><code>{esc(field["path"])}</code></h2>'
                      f'<p class="guide-metadata">{esc(field["scope"])} · {esc(field["label"])}</p><p>{esc(description)}</p>'
                      f'<dl>{metadata}</dl><a href="{esc(source_url(field["source"]))}">{labels["sources"]}</a></article>')
    return ''.join(output)


def controls_html(controls, language):
    """Group the control reference without changing its published item anchors."""
    labels, groups = TEXT[language], {}
    for control in controls:
        if 'control_' + control['group'] not in labels or control['kind'] not in labels:
            raise ValueError('A control needs a translated group and input type.')
        groups.setdefault(control['group'], []).append(control)
    links = ''.join(f'<li><a href="#controls-{esc(group)}">{esc(labels["control_" + group])}</a></li>'
                    for group in groups)
    output = [f'<nav class="guide-control-nav" aria-label="{labels["control_groups"]}"><ul>{links}</ul></nav>']
    for group, entries in groups.items():
        rows = ''.join(
            f'<div id="{esc(control["id"])}"><dt><span class="guide-control-label">{esc(control["label"])}</span> '
            f'<span class="guide-control-kind">{esc(labels[control["kind"]])}</span></dt>'
            f'<dd>{esc(control["description"])}</dd></div>' for control in entries)
        output.append(f'<section class="guide-control-group" aria-labelledby="controls-{esc(group)}">'
                      f'<h2 id="controls-{esc(group)}">{esc(labels["control_" + group])}</h2>'
                      f'<dl class="guide-controls">{rows}</dl></section>')
    return ''.join(output)


def themes_html(themes, language, page):
    output = []
    for theme in themes:
        image = relative(page, figure_path(theme['id'], language))
        width, height = LOCALIZED_FIGURES[theme['id']][language]
        output.append(f'<section class="guide-theme" id="{esc(theme["id"])}"><h2>{esc(theme["label"])}</h2>'
                      f'<p class="guide-metadata">{TEXT[language][theme["category"]]}</p><p>{esc(theme["description"])}</p>'
                      f'<img src="{esc(image)}" width="{width}" height="{height}" loading="lazy" decoding="async" alt="{esc(theme["label"])}">'
                      + render_block({'type':'code','text':theme['code']}, language, page, '') + '</section>')
    return ''.join(output)
