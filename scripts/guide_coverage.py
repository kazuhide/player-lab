"""Render the validated public API report as static bilingual guide pages."""
from collections import Counter
from datetime import date
import hashlib
from pathlib import PurePosixPath
import re
from urllib.parse import quote, unquote, urlsplit

from coverage_report import CATEGORIES, STATUSES, check_summary
from guide_html import esc, page_html, relative
from guide_routes import COVERAGE_APPS, route_file

LABELS = {
    'en': {
        'configuration': 'Configuration', 'command': 'Commands', 'observation': 'Observations', 'event': 'Events',
        'direct': 'Direct GUI', 'preset': 'Constrained preset', 'observed': 'Observed in GUI',
        'internal': 'Internal use', 'code-only': 'Code only', 'missing': 'No mapped GUI control',
        'sdk-ui-unverified': 'SDK UI unverified', 'app': 'Application', 'total': 'Available IDs',
        'direct_count': 'Individual GUI edit', 'combined': 'Direct + preset', 'seen': 'Visible in GUI',
        'used_config': 'Configuration APIs used', 'preset_config': 'GUI preset', 'code_config': 'Code only',
        'direct_command': 'Direct operation', 'combined_command': 'Direct + preset',
        'versions': 'SDK versions and latest checks', 'sdk': 'SDK', 'pinned': 'Pinned version',
        'latest': 'Latest checked version', 'checked': 'Checked', 'sources': 'Official sources',
        'revision': 'App source revision', 'report': 'Report checked', 'scope': 'Scope',
        'scopes': 'Scope totals', 'scope_notes': 'Scope and limits', 'status': 'Status',
        'deprecated': 'Deprecated', 'yes': 'Yes', 'no': 'No', 'reference': 'Reference and evidence',
        'official': 'Official API', 'evidence': 'App / SDK evidence', 'excluded': 'Explicit exclusions',
        'reason': 'Reason', 'all_ids': 'All API IDs', 'none': 'No available IDs in this category.',
        'not_applicable': 'Not applicable', 'applications': 'Application inventories',
        'overview': 'API coverage overview', 'channel': 'Channel', 'hash': 'SHA-256',
        'status_key': 'How to read the statuses',
        'goal': 'Target and remaining work',
        'goal_unmet': 'The app does not yet expose every inventoried API through its GUI.',
        'goal_note': 'Fixed presets and code-only configuration entries are not individually editable GUI inputs. Required media, services and devices are prerequisites for exercising a feature; they do not prevent adding GUI access. A method that returns a constant or has no effect on a platform can still be invoked and inspected.',
        'gap_summary': 'Reason and required work', 'gap_reason': 'Reason', 'gap_action': 'Required work',
        'gap_implementation': 'App work remains',
        'gap_input-contract': 'SDK declaration and runtime contract differ',
        'metric_note': 'Each category has its own denominator. Configuration APIs used is the sum of individual GUI edits, GUI presets and code-only configuration entries. A zero individual GUI count does not mean the app has no configuration code. Observation and event visibility includes direct, preset and observed statuses. A zero denominator has no percentage.',
        'configuration_note': 'Configuration counts use SDK API entries, including configuration-object access and nested properties, rather than independent editable fields. Code-only entries include fixed values and helper code without a GUI; changing these values requires editing the source and rebuilding. SDK defaults are not counted as app configuration. Source mappings do not prove that a setting has been applied on a device.',
        'limit_note': 'These are source-backed mappings of app configuration, GUI controls and visible output. SDK UI marked unverified receives no verified credit. Scope notes qualify each inventory; counts do not establish playback or device testing. There is no combined coverage percentage.',
        'status_note': 'Internal use and code-only entries are not GUI controls. “No mapped GUI control” describes the audited app scope. It does not establish that an opaque SDK UI lacks the feature.',
        'excluded_note': 'Excluded IDs do not enter the category denominators. Deprecated operational APIs remain included.',
        'notes_language': 'Scope notes are supplied by the public inventory.',
    },
    'ja': {
        'configuration': '設定', 'command': '操作', 'observation': '観測値', 'event': 'イベント',
        'direct': 'GUIから直接利用', 'preset': '限定プリセット', 'observed': 'GUIで観測',
        'internal': '内部で使用', 'code-only': 'コードのみ', 'missing': '対応するGUIなし',
        'sdk-ui-unverified': 'SDK UIは未確認', 'app': 'アプリ', 'total': '対象API ID数',
        'direct_count': 'GUIで個別変更', 'combined': '直接指定＋プリセット', 'seen': 'GUIで確認できる項目',
        'used_config': '設定APIの使用数', 'preset_config': 'GUIで候補選択', 'code_config': 'コード内のみ',
        'direct_command': '直接操作', 'combined_command': '直接操作＋プリセット',
        'versions': 'SDKバージョンと最新版の確認', 'sdk': 'SDK', 'pinned': '固定バージョン',
        'latest': '確認した最新版', 'checked': '確認日', 'sources': '公式資料',
        'revision': 'アプリコードの基準コミット', 'report': 'レポート確認日', 'scope': '集計範囲',
        'scopes': '範囲別の件数', 'scope_notes': '対象範囲と制限', 'status': '対応状況',
        'deprecated': '非推奨', 'yes': '該当', 'no': '非該当', 'reference': '公式資料と参照コード',
        'official': '公式API資料', 'evidence': 'アプリ／SDKの参照箇所', 'excluded': '集計から除外したID',
        'reason': '除外理由', 'all_ids': '全API ID', 'none': 'この区分に対象APIはありません。',
        'not_applicable': '対象なし', 'applications': 'アプリ別の全API一覧',
        'overview': 'API対応状況の概要', 'channel': '提供区分', 'hash': 'SHA-256',
        'status_key': '対応状況の読み方',
        'goal': '目標と残りの対応',
        'goal_unmet': 'すべての対象APIをGUIから試せる状態には達していません。',
        'goal_note': '固定候補からの選択やコード内だけの設定は、GUIで値を個別に編集できる状態とは異なります。対応する素材・サービス・端末は機能を実行するための条件であり、GUIを追加できない理由ではありません。固定値を返すメソッドや、その環境では効果のないメソッドも、呼び出して結果を確認することは可能です。',
        'gap_summary': '理由と必要な対応', 'gap_reason': '理由', 'gap_action': '必要な対応',
        'gap_implementation': 'アプリ側の対応が必要',
        'gap_input-contract': 'SDKの型と適用経路の不一致',
        'metric_note': '設定・操作・観測値・イベントは、それぞれ別の分母で集計します。設定APIの使用数は、GUIで個別変更・GUIで候補選択・コード内のみの合計です。GUIで個別変更できる件数が0でも、設定コードがないという意味ではありません。観測値とイベントの表示件数は、直接利用・プリセット・GUIでの観測を合計したものです。分母が0の場合、割合は表示しません。',
        'configuration_note': '設定はSDKのAPI単位で数えます。設定オブジェクトへのアクセスと、その中のプロパティを含むため、独立して編集できる項目数とは異なります。「コード内のみ」には固定値やGUIにつないでいない補助コードも含み、値の変更にはソースの編集と再ビルドが必要です。SDKの既定値はアプリの設定件数に加えません。コード上の対応付けは、実機での設定適用を確認した結果ではありません。',
        'limit_note': 'アプリの設定・GUI操作・表示と公開コードの対応を示す一覧です。未確認のSDK UIは確認済みの件数に含めません。アプリごとの対象範囲と制限も確認してください。件数は実再生や実機試験の結果を示すものではありません。全区分を混ぜた対応率は算出しません。',
        'status_note': '内部使用とコードのみの項目はGUI操作に含めません。「対応するGUIなし」は調査したアプリの範囲での判定です。内部構造を確認していないSDK UIの機能有無を示すものではありません。',
        'excluded_note': '除外したIDは各区分の分母に含めません。利用可能な非推奨APIは集計対象に残します。',
        'notes_language': '対象範囲の説明は、公開API一覧の日本語訳です。',
    },
}

STATUS_MEANINGS = {
    'en': (
        'An app control edits an SDK field or calls an operation. Scope notes describe argument limits.',
        'The app offers fixed source, value, layout or operation-argument choices.',
        'The API contributes to a visible display or log; it does not become editable.',
        'The app uses the API for internal setup or lifecycle work, without a GUI control.',
        'The configuration or call exists in source code without a mapped GUI control.',
        'No exposure is mapped within the audited app scope.',
        'An SDK UI candidate still needs an exact binding and runtime qualification; it receives no verified credit.',
    ),
    'ja': (
        'アプリの操作部品からSDKの設定を編集するか、操作を呼び出します。引数の制限はアプリごとの対象範囲で説明します。',
        'ソース・値・レイアウト・操作の引数を、アプリが用意した固定候補から選びます。',
        'APIが画面表示やログに使われます。設定を編集できることは意味しません。',
        '初期化やライフサイクル処理のために内部で使用し、操作GUIはありません。',
        'ソースコードには設定や呼び出しがありますが、対応する操作GUIはありません。',
        '調査対象のアプリの範囲で、GUIとの対応付けがありません。',
        'SDK UIの候補です。APIとの正確な対応付けと実行時の確認が必要なため、確認済みの対応件数には含めません。',
    ),
}


def api_anchor(identifier):
    return 'api-' + hashlib.sha256(identifier.encode('utf-8')).hexdigest()[:24]


def safe_https(value):
    if not isinstance(value, str):
        raise ValueError('Coverage references must be public HTTPS URLs.')
    try:
        parsed = urlsplit(value)
        path = unquote(parsed.path)
        host = parsed.hostname
        official = host in {'cdn.bitmovin.com', 'developer.bitmovin.com', 'artifacts.bitmovin.com', 'registry.npmjs.org'}
        official = official or (host in {'github.com', 'raw.githubusercontent.com'} and path.startswith('/bitmovin/'))
        official = official or (host == 'api.github.com' and path.startswith('/repos/bitmovin/'))
        if (parsed.scheme != 'https' or not official or parsed.username or parsed.password
                or parsed.port not in (None, 443) or parsed.query or '\\' in path or '%' in path
                or any(ord(c) < 32 for c in value) or any(p in {'.', '..'} for p in path.split('/'))):
            raise ValueError('Unsafe coverage reference.')
    except ValueError as error:
        raise ValueError('Coverage references must be safe primary-vendor HTTPS URLs.') from error
    return value


def safe_file(value, *, sdk=False):
    # DocC stores argument labels as literal %3A in its relative JSON filenames.
    checked = re.sub('%3[aA]', '', value) if sdk and isinstance(value, str) else value
    if (not isinstance(value, str) or not value or PurePosixPath(value).is_absolute()
            or any(c in checked for c in '\\:?#%') or any(ord(c) < 32 for c in value)
            or any(p.lower() in {'', '.', '..', '.git', 'local.properties', 'local.xcconfig', 'key.properties'}
                   or p.lower().startswith('.env') for p in value.split('/'))):
        raise ValueError('Coverage evidence must use safe public relative paths.')
    return value


def _text(value):
    if not isinstance(value, str) or not value.strip() or any(ord(c) < 32 for c in value):
        raise ValueError('Coverage text must be a nonempty public string.')


def _hash(value, length=64):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{' + str(length) + '}', value):
        raise ValueError('Coverage evidence has an invalid hash or revision.')


def _translation(source, text):
    _text(source); _text(text)
    numbers = lambda value: Counter(re.findall(r'\d+(?:\.\d+)*', value))
    if numbers(source) != numbers(text):
        raise ValueError('Coverage translations must preserve numeric values.')
    identifiers = re.findall(r'\b[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b', source)
    if any(identifier not in text for identifier in identifiers):
        raise ValueError('Coverage translations must preserve qualified API names.')


def validate_coverage(data, summary, documents):
    """Check the rendering boundary; publication verifies exact source bytes separately."""
    try:
        if data['schemaVersion'] != 1 or type(data['schemaVersion']) is not int:
            raise ValueError('Unsupported coverage report version.')
        _hash(data['sourceRevision'], 40)
        date.fromisoformat(data['checkedAt'])
        sdks = {}
        for sdk in data['sdks']:
            if sdk['id'] in sdks:
                raise ValueError('Duplicate coverage SDK.')
            for key in ('id', 'name', 'version', 'channel', 'latestVersion'):
                _text(sdk[key])
            date.fromisoformat(sdk['latestCheckedAt'])
            if not sdk['sources']:
                raise ValueError('Coverage SDK sources are required.')
            for source in sdk['sources']:
                safe_https(source['url'])
                if 'sha256' in source:
                    _hash(source['sha256'])
            sdks[sdk['id']] = sdk
        applications = {app['id']:app for app in data['applications']}
        if len(applications) != len(data['applications']) or set(applications) != set(COVERAGE_APPS):
            raise ValueError('All explicit coverage application routes are required.')
        translations = documents['ja']['api-coverage']['noteTranslations']
        if set(translations) != set(applications):
            raise ValueError('Japanese coverage notes must cover the same applications.')
        japanese = documents['ja']['api-coverage']
        for key, records, source_key in [('appLabels', applications, 'platform'), ('sdkLabels', sdks, 'name')]:
            labels = japanese[key]
            if set(labels) != set(records):
                raise ValueError('Japanese coverage labels must cover the same IDs.')
            for identifier, record in records.items():
                if labels[identifier]['source'] != record[source_key]:
                    raise ValueError('Japanese coverage labels are stale.')
                _translation(labels[identifier]['source'], labels[identifier]['text'])
        if set(japanese['channelLabels']) != {sdk['channel'] for sdk in sdks.values()}:
            raise ValueError('Japanese release-channel labels are missing or stale.')
        for source, text in japanese['channelLabels'].items():
            _translation(source, text)
        reasons = documents['ja']['api-coverage']['reasonTranslations']
        if set(reasons) != {item['reason'] for app in applications.values() for item in app['excluded']}:
            raise ValueError('Japanese exclusion reasons are missing or stale.')
        for source, text in reasons.items():
            _translation(source, text)
        for app in applications.values():
            _text(app['platform'])
            if app['sdkId'] not in sdks:
                raise ValueError('Coverage application references an unknown SDK.')
            ids, anchors = set(), set()
            for row in app['rows']:
                _text(row['id'])
                identifier = api_anchor(row['id'])
                if row['id'] in ids or identifier in anchors:
                    raise ValueError('Duplicate API ID or anchor.')
                ids.add(row['id']); anchors.add(identifier)
                _text(row['scope'])
                if row['category'] not in CATEGORIES or row['status'] not in STATUSES or type(row['deprecated']) is not bool:
                    raise ValueError('Unknown coverage category, status or deprecation flag.')
                safe_https(row['officialReference'])
                if row['status'] != 'missing' and not any(e.get('kind') == 'app' for e in row['evidence']):
                    raise ValueError('Mapped coverage statuses require app evidence.')
                for evidence in row['evidence']:
                    if evidence['kind'] not in {'app', 'sdk'}:
                        raise ValueError('Unknown coverage evidence kind.')
                    safe_file(evidence['file'], sdk=evidence['kind'] == 'sdk'); _hash(evidence['sha256'])
                    if 'line' in evidence and (type(evidence['line']) is not int or evidence['line'] < 1):
                        raise ValueError('Coverage source lines must be positive integers.')
                    if evidence['kind'] == 'sdk':
                        _text(evidence['package']); _text(evidence['version'])
            excluded = set()
            for item in app['excluded']:
                _text(item['id']); _text(item['reason'])
                if item['id'] in ids or item['id'] in excluded:
                    raise ValueError('Excluded coverage IDs must be distinct.')
                excluded.add(item['id'])
            translated = translations[app['id']]
            if not isinstance(translated, list) or [n['source'] for n in translated] != app['scopeNotes']:
                raise ValueError('Japanese scope notes are missing or stale.')
            for note in translated:
                _translation(note['source'], note['text'])
        check_summary(data, summary)
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError('Incomplete coverage report or translations.') from error


def table(headers, rows, caption, *, coverage=False, configuration=False):
    head = ''.join(f'<th scope="col">{esc(label)}</th>' for label in headers)
    body = ''.join('<tr>' + ''.join(f'<th scope="row">{cell}</th>' if coverage and index == 0 else f'<td>{cell}</td>'
                                   for index, cell in enumerate(row)) + '</tr>' for row in rows)
    kind = ' guide-coverage-table' if coverage else ''
    if configuration:
        kind += ' guide-configuration-summary'
    return (f'<div class="guide-table{kind}" tabindex="0" role="region" aria-label="{esc(caption)}">'
            f'<table><caption>{esc(caption)}</caption><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')


def fraction(count, total, labels):
    if not total:
        return '0 / 0 · ' + labels['not_applicable']
    return f'{count} / {total} · {100 * count / total:.2f}%'


def app_label(app, document, language):
    return app['platform'] if language == 'en' else document['appLabels'][app['id']]['text']


def sdk_label(sdk, document, language):
    return sdk['name'] if language == 'en' else document['sdkLabels'][sdk['id']]['text']


def category_metrics(apps, category, language, page, document):
    labels = LABELS[language]
    if category == 'configuration':
        columns = ('used_config', 'direct_count', 'preset_config', 'code_config')
    elif category == 'command':
        columns = ('direct_command', 'combined_command')
    else:
        columns = ('seen',)
    headers = [labels['app'], labels['total'], *(labels[key] for key in columns)]
    rows = []
    for app in apps:
        selected = [r for r in app['rows'] if r['category'] == category]
        counts, total = Counter(r['status'] for r in selected), len(selected)
        href = relative(page, route_file(language, 'api-coverage/' + app['id'])) + '#' + category
        cells = [f'<a href="{esc(href)}">{esc(app_label(app, document, language))}</a>', str(total)]
        if category == 'configuration':
            used = counts['direct'] + counts['preset'] + counts['code-only']
            cells.extend([fraction(used, total, labels), str(counts['direct']),
                          str(counts['preset']), str(counts['code-only'])])
        elif category == 'command':
            cells.extend([fraction(counts['direct'], total, labels), fraction(counts['direct'] + counts['preset'], total, labels)])
        else:
            cells.append(fraction(counts['direct'] + counts['preset'] + counts['observed'], total, labels))
        rows.append(cells)
    return table(headers, rows, labels[category], configuration=category == 'configuration')


def versions_table(data, language, document):
    labels, rows = LABELS[language], []
    for sdk in sorted(data['sdks'], key=lambda s:s['id']):
        sources = []
        for source in sdk['sources']:
            link = f'<a href="{esc(safe_https(source["url"]))}">{esc(source["url"])}</a>'
            if 'sha256' in source:
                link += f'<br><small>{labels["hash"]}: <code>{source["sha256"]}</code></small>'
            sources.append('<li>' + link + '</li>')
        references = (f'<details class="guide-evidence"><summary>{labels["sources"]} ({len(sources)})</summary><ul>'
                      + ''.join(sources) + '</ul></details>')
        channel = sdk['channel'] if language == 'en' else document['channelLabels'][sdk['channel']]
        rows.append([esc(sdk_label(sdk, document, language)), esc(sdk['version']), esc(sdk['latestVersion']),
                     esc(channel), f'<time class="guide-version-date" datetime="{esc(sdk["latestCheckedAt"])}">{esc(sdk["latestCheckedAt"])}</time>', references])
    return table([labels[k] for k in ('sdk', 'pinned', 'latest', 'channel', 'checked', 'sources')], rows, labels['versions'])


def provenance(data, language):
    labels, revision = LABELS[language], data['sourceRevision']
    _hash(revision, 40)
    return (f'<p class="guide-metadata">{labels["report"]}: {esc(data["checkedAt"])}<br>'
            f'{labels["revision"]}: <a href="https://github.com/kazuhide/player-lab/tree/{revision}"><code>{revision}</code></a></p>')


def status_legend(language):
    labels = LABELS[language]
    items = ''.join(f'<dt>{labels[status]}</dt><dd>{esc(meaning)}</dd>'
                    for status, meaning in zip(STATUSES, STATUS_MEANINGS[language]))
    return (f'<details class="guide-api-group" id="statuses"><summary>{labels["status_key"]}</summary>'
            + '<dl class="guide-status-key">' + items + '</dl></details>')


def goal_html(document, language, assessments, *, app_id=None):
    labels = LABELS[language]
    paragraphs = document.get('coverageGoal', [])
    if assessments is None and not paragraphs:
        return ''
    selected = ((assessments or {}).get(app_id, {}).values() if app_id is not None
                else (item for rows in (assessments or {}).values() for item in rows.values()))
    counts = Counter(item['kind'] for item in selected)
    output = [f'<h2 id="coverage-goal">{esc(labels["goal"])}</h2>', '<aside class="guide-note guide-api-goal">']
    if counts:
        output.append('<p><strong>' + esc(labels['goal_unmet']) + '</strong></p>')
    texts = [labels['goal_note']] if app_id is not None else paragraphs
    output.extend('<p>' + esc(text) + '</p>' for text in texts)
    if assessments is not None:
        output.append('<dl class="guide-api-gap-counts">' + ''.join(
            '<dt>' + esc(labels['gap_' + kind]) + '</dt><dd>' + str(counts[kind]) + '</dd>'
            for kind in ('implementation', 'input-contract')) + '</dl>')
    output.append('</aside>')
    return ''.join(output)


def gap_html(assessment, language):
    labels, content = LABELS[language], assessment[language]
    output = [f'<details class="guide-api-gap" data-api-gap="{esc(assessment["id"])}">',
              '<summary>' + esc(labels['gap_summary']) + '</summary>',
              '<p class="guide-api-gap-kind">' + esc(labels['gap_' + assessment['kind']]) + '</p>',
              '<dl><dt>' + esc(labels['gap_reason']) + '</dt><dd>' + esc(content['reason']) + '</dd>',
              '<dt>' + esc(labels['gap_action']) + '</dt><dd>' + esc(content['action']) + '</dd></dl>']
    if assessment['references']:
        output.append('<ul class="guide-api-gap-sources">' + ''.join(
            '<li><a href="' + esc(safe_https(url)) + '">' + esc(url) + '</a></li>'
            for url in assessment['references']) + '</ul>')
    output.append('</details>')
    return ''.join(output)


def evidence_html(row, revision, language):
    labels, output = LABELS[language], []
    for item in row['evidence']:
        file = safe_file(item['file'], sdk=item['kind'] == 'sdk')
        if item['kind'] == 'app':
            href = f'https://github.com/kazuhide/player-lab/blob/{revision}/' + quote(file, safe='/')
            href += '#L' + str(item['line']) if 'line' in item else ''
            label = file + (':' + str(item['line']) if 'line' in item else '')
            description = f'<a href="{esc(href)}">{esc(label)}</a>'
            if item.get('symbol'):
                description += '<br><code>' + esc(item['symbol']) + '</code>'
        else:
            description = '<code>' + esc(item['package'] + '@' + item['version'] + ' / ' + file) + '</code>'
        output.append('<li>' + description + f'<br><small>{labels["hash"]}: <code>{item["sha256"]}</code></small></li>')
    official = f'<a href="{esc(safe_https(row["officialReference"]))}">{labels["official"]}</a>'
    if output:
        official += f'<details class="guide-evidence"><summary>{labels["evidence"]} ({len(output)})</summary><ul>' + ''.join(output) + '</ul></details>'
    return official


def rows_table(app, category, data, language, *, assessments=None):
    labels = LABELS[language]
    selected = sorted((r for r in app['rows'] if r['category'] == category), key=lambda r:(r['scope'], r['id']))
    if not selected:
        return f'<p>{labels["none"]}</p>'
    rows = []
    app_assessments = (assessments or {}).get(app['id'], {})
    for row in selected:
        identity = api_anchor(row['id'])
        status = f'<span data-api-status="{row["status"]}">{labels[row["status"]]}</span>'
        if row['id'] in app_assessments:
            status += gap_html(app_assessments[row['id']], language)
        cells = [f'<code id="{identity}" data-api-id="{esc(row["id"])}">{esc(row["id"])}</code>',
                 '<code>' + esc(row['scope']) + '</code>',
                 status,
                 labels['yes'] if row['deprecated'] else labels['no'], evidence_html(row, data['sourceRevision'], language)]
        rows.append(cells)
    caption = f'{labels[category]} · {labels["all_ids"]} ({len(selected)})'
    return (f'<details class="guide-api-group" open><summary>{esc(caption)}</summary>'
            + table(['API ID', labels['scope'], labels['status'], labels['deprecated'], labels['reference']], rows, caption, coverage=True)
            + '</details>')


def app_body(app, data, document, language, page, *, assessments=None):
    labels = LABELS[language]
    sdk = next(s for s in data['sdks'] if s['id'] == app['sdkId'])
    overview = relative(page, route_file(language, 'api-coverage'))
    output = [f'<p><a href="{esc(overview)}">{labels["overview"]}</a> · {esc(sdk_label(sdk, document, language))} <code>{esc(sdk["version"])}</code></p>',
              provenance(data, language), goal_html(document, language, assessments, app_id=app['id']),
              f'<aside class="guide-note"><p>{labels["limit_note"]}</p><p>{labels["status_note"]}</p></aside>',
              status_legend(language), f'<h2 id="scope-notes">{labels["scope_notes"]}</h2>']
    notes = app['scopeNotes'] if language == 'en' else [n['text'] for n in document['noteTranslations'][app['id']]]
    output.append('<ul>' + ''.join(f'<li>{esc(note)}</li>' for note in notes) + '</ul>')
    output.append(f'<h2 id="scopes">{labels["scopes"]}</h2>')
    scopes = []
    for scope in sorted({r['scope'] for r in app['rows']}):
        counts = Counter(r['category'] for r in app['rows'] if r['scope'] == scope)
        scopes.append(['<code>' + esc(scope) + '</code>', *(str(counts[k]) for k in CATEGORIES)])
    output.append(table([labels['scope'], *(labels[k] for k in CATEGORIES)], scopes, labels['scopes']))
    output.append(f'<p class="guide-note">{labels["metric_note"]}</p>')
    for category in CATEGORIES:
        output.append(f'<h2 id="{category}">{labels[category]}</h2>')
        if category == 'configuration':
            output.append(f'<p class="guide-note">{labels["configuration_note"]}</p>')
        output.append(category_metrics([app], category, language, page, document))
        output.append(rows_table(app, category, data, language, assessments=assessments))
    output.append(f'<h2 id="exclusions">{labels["excluded"]} ({len(app["excluded"])})</h2><p>{labels["excluded_note"]}</p>')
    if app['excluded']:
        rows = [['<code>' + esc(item['id']) + '</code>',
                 esc(item['reason'] if language == 'en' else document['reasonTranslations'][item['reason']])]
                for item in sorted(app['excluded'], key=lambda e:e['id'])]
        output.append(f'<details class="guide-api-group"><summary>{labels["excluded"]} ({len(rows)})</summary>'
                      + table(['API ID', labels['reason']], rows, labels['excluded']) + '</details>')
    return ''.join(output)


def coverage_pages(documents, data, summary, language, *, assessments=None):
    labels, document = LABELS[language], documents[language]['api-coverage']
    apps_by_id = {a['id']:a for a in data['applications']}
    apps = [apps_by_id[key] for key in COVERAGE_APPS]
    page = route_file(language, 'api-coverage')
    output = [provenance(data, language), goal_html(document, language, assessments),
              f'<aside class="guide-note"><p>{labels["metric_note"]}</p><p>{labels["limit_note"]}</p></aside>', status_legend(language),
              f'<h2 id="versions">{labels["versions"]}</h2>', versions_table(data, language, document),
              f'<h2 id="applications">{labels["applications"]}</h2><ul>']
    for app in apps:
        href = relative(page, route_file(language, 'api-coverage/' + app['id']))
        output.append(f'<li><a href="{esc(href)}">{esc(app_label(app, document, language))}</a></li>')
    output.append('</ul>')
    for category in CATEGORIES:
        output.append(f'<h2 id="{category}">{labels[category]}</h2>')
        if category == 'configuration':
            output.append(f'<p class="guide-note">{labels["configuration_note"]}</p>')
        output.append(category_metrics(apps, category, language, page, document))
    pages = {page:page_html(documents[language], language, 'api-coverage', document['title'], document['lead'], ''.join(output)).encode()}
    search = [{'kind':'chapter', 'title':document['title'], 'url':'api-coverage/', 'excerpt':document['lead'],
               'text':' '.join([document['lead'], *document.get('coverageGoal', [])])}]
    for app in apps:
        slug = 'api-coverage/' + app['id']
        title = document['title'] + ' · ' + app_label(app, document, language)
        pages[route_file(language, slug)] = page_html(documents[language], language, slug, title, document['lead'],
            app_body(app, data, document, language, route_file(language, slug), assessments=assessments)).encode()
        app_assessments = (assessments or {}).get(app['id'], {})
        for row in sorted(app['rows'], key=lambda r:r['id']):
            status = labels[row['status']]
            explanation = ''
            if row['id'] in app_assessments:
                content = app_assessments[row['id']][language]
                explanation = ' ' + content['reason'] + ' ' + content['action']
            search.append({'kind':'api', 'title':row['id'], 'url':slug + '/#' + api_anchor(row['id']),
                           'excerpt':app_label(app, document, language) + ' · ' + status + explanation,
                           'text':row['status'] + ' ' + status + explanation})
    return pages, search
