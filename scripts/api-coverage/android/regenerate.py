#!/usr/bin/env python3
"""Regenerate a portable, declaration-only Android coverage snapshot.

Uses public version-pinned Dokka and official public source artifacts. SDK HTML,
SDK source archives and intermediate data remain in temporary scratch storage.
Only explicitly named public app and control-test sources are read from --repo.
"""
import argparse
import collections
import hashlib
import json
import re
import shutil
import tempfile
import urllib.request
from pathlib import Path

from android_scope import build_scope
from dokka_public import collect

MAIN = 'apps/android/app/src/main/kotlin/com/playerlab/android/MainActivity.kt'
PLAYER_VIEW = 'apps/android/app/src/main/kotlin/com/playerlab/android/PlayerWorkspace.kt'
SOURCE = 'apps/android/app/src/main/kotlin/com/playerlab/android/Sources.kt'
OFFLINE = 'apps/android/app/src/main/kotlin/com/playerlab/android/OfflineManager.kt'
TIMELINE = 'apps/android/playback/src/main/kotlin/com/playerlab/android/playback/PlaybackTimeline.kt'
CONFIG = 'apps/android/app/src/main/kotlin/com/playerlab/android/Configuration.kt'
EDITOR = 'apps/android/app/src/main/kotlin/com/playerlab/android/ConfigurationPanel.kt'
CONTROL_TEST = 'apps/android/app/src/androidTest/kotlin/com/playerlab/android/PlayerControlsInstrumentedTest.kt'
CODE = 'apps/android/app/src/main/kotlin/com/playerlab/android/ConfigurationCode.kt'
APP_INPUTS = (MAIN, PLAYER_VIEW, SOURCE, OFFLINE, TIMELINE, CONFIG, EDITOR, CODE, CONTROL_TEST)
GUI_STATUSES = {'direct', 'preset'}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_id(row):
    kind = row['declaration_kind']
    member = '<init>' if kind == 'constructor' else row['member']
    suffix = '()' if kind in ('constructor', 'function', 'extension_function') else ''
    return 'android:' + row['owner'] + '.' + member + suffix


def reference_evidence(repo, needle='PlayerTouchHost(context, controller.attachView(PlayerView(context, displayedPlayer,', symbol='PlayerView'):
    content = (repo / PLAYER_VIEW).read_bytes()
    line = next(i + 1 for i, text in enumerate(content.decode().splitlines()) if needle in text)
    return {'kind':'app', 'file':PLAYER_VIEW, 'sha256':sha256(content), 'line':line, 'symbol':symbol}


def portable_evidence(items):
    evidence = []
    for item in items:
        result = {'kind':'app', 'file':item['file'], 'sha256':item['source_sha256']}
        for key in ('line', 'symbol'):
            if key in item:
                result[key] = item[key]
        if result not in evidence:
            evidence.append(result)
    return evidence


def get_alias_target(row, property_names):
    owner, member = row['owner'], row['member']
    if row['declaration_kind'] not in ('function', 'extension_function'):
        return None
    target_owner = 'com.bitmovin.player.PlayerView' if owner.endswith('.UserInterfaceApi') else owner
    names = property_names.get(target_owner, set())
    candidates = [member] if member.startswith('is') else []
    for prefix in ('get', 'set'):
        if member.startswith(prefix) and len(member) > len(prefix):
            tail = member[len(prefix):]
            candidates.extend([tail[0].lower() + tail[1:], 'is' + tail])
    for candidate in candidates:
        if candidate in names:
            return 'android:' + target_owner + '.' + candidate
    if owner.endswith('.UserInterfaceApi'):
        return 'android:' + target_owner + '.' + member + '()'
    return None


def exclusion(row, property_names, page_by_owner, scoped_ids):
    owner, member, kind = row['owner'], row['member'], row['declaration_kind']
    if kind == 'constructor':
        return 'Constructor/factory alias; input fields and runtime operations are counted separately.'
    if owner.endswith('.Builder'):
        return 'Configuration builder alias; the corresponding public input field is counted once.'
    alias = get_alias_target(row, property_names)
    if alias:
        return 'Getter/setter/interface alias of ' + alias + '.'
    if member in ('CREATOR', 'entries', 'writeToParcel', 'describeContents', 'createFromParcel', 'newArray'):
        return 'Generated enum/Parcelable accessor; not an independent playback operation or input field.'
    class_signature = page_by_owner.get(owner, {}).get('class_signature', '')
    if kind == 'property' and re.search(r'\benum\b', class_signature):
        return 'Enum choice metadata; counted through its parent input/observation rather than as an independent API.'
    if member in ('values', 'valueOf') and re.search(r'\benum\b', class_signature):
        return 'Generated enum lookup alias; enum choices belong to their parent input/observation.'
    if re.fullmatch(r'component\d+', member) or member in ('copy', 'equals', 'hashCode', 'toString', 'compareTo'):
        return 'Data/Object value helper; not an independent playback operation or input field.'
    if owner.endswith(('Callback', 'Handler', 'EventEmitter', 'EventListener')) or 'fun interface ' in class_signature:
        return 'Callback/subscription implementation contract; associated API/event/input is counted separately.'
    if owner.endswith('.PlayerView') and member in ('onLayout', 'onInterceptTouchEvent', 'onTouchEvent'):
        return 'Android framework callback; not a public app-panel playback operation.'
    if row['scope'] == 'runtime_factories_extensions':
        return 'Initialization/event-subscription alias; fields and concrete event types are counted separately.'
    if row['scope'] == 'optional_module_public_declarations':
        return 'Separate optional module outside the current player dependency; retained as a separate public scope.'
    if canonical_id(row) not in scoped_ids:
        if '.api.event.' in owner:
            return 'Event payload/value declaration; the concrete event type is the event denominator unit.'
        return 'Supporting type/static/data/configuration-method alias outside the declared operational scopes.'
    return None


def sdk_ui_candidate(row):
    owner, member = row['owner'], row['member']
    if not owner.endswith(('.Player', '.Source', '.PlayerView')):
        return False
    return member in {
        'play', 'pause', 'seek', 'timeShift', 'mute', 'unmute', 'volume', 'playbackSpeed',
        'setAudio', 'setAudioTrack', 'setVideoQuality', 'setSubtitle', 'setSubtitleTrack',
        'getThumbnail', 'enterFullscreen', 'exitFullscreen', 'enterPictureInPicture',
        'exitPictureInPicture', 'isFullscreen', 'isPictureInPicture',
    }


def normalize(scoped, all_public, inventory, repo):
    scoped_rows = scoped['rows']
    scoped_ids = {canonical_id(row) for row in scoped_rows}
    all_rows = list(all_public.values())
    property_names = collections.defaultdict(set)
    for row in all_rows:
        if row['declaration_kind'] == 'property':
            property_names[row['owner']].add(row['member'])
    page_by_owner = {page['qualified_owner']:page for page in inventory['pages']}
    all_groups = collections.defaultdict(list)
    for row in all_rows:
        all_groups[canonical_id(row)].append(row)

    included = collections.defaultdict(list)
    excluded = {}
    for row in all_rows:
        identifier = canonical_id(row)
        reason = exclusion(row, property_names, page_by_owner, scoped_ids)
        if reason:
            excluded.setdefault(identifier, reason)
        else:
            included[identifier].append(row)

    output_rows = []
    overload_notes = []
    status_map = {'direct_gui':'direct', 'constrained_preset':'preset', 'observed':'observed',
                  'code_only':'code-only', 'missing':'missing'}
    rank = {'direct':0, 'preset':1, 'observed':2, 'internal':3, 'code-only':4,
            'sdk-ui-unverified':5, 'missing':6}
    anchor = reference_evidence(repo)
    for identifier, group in sorted(included.items()):
        # An exposed overload gives the qualified operation a lower-bound credit;
        # notes preserve how many overloads are actually mapped by the app.
        statuses = []
        evidence = []
        for row in group:
            status = status_map[row['coverage']['status']]
            if status == 'code-only' and ((row['owner'].endswith('.Player') and row['member'] == 'destroy')
                or (row['owner'].endswith('.PlayerView') and row['member'] in ('player', 'onDestroy', 'onStart', 'onResume', 'onPause', 'onStop'))):
                status = 'internal'
            if status == 'missing' and sdk_ui_candidate(row) and row['coverage'].get('sdk_ui_qualification') != 'not-exposed':
                status = 'sdk-ui-unverified'
            statuses.append(status)
            evidence.extend(portable_evidence(row['coverage']['evidence']))
        exemplar = min(group, key=lambda row:rank[status_map[row['coverage']['status']]])
        status = min(statuses, key=rank.get)
        if not evidence:
            evidence = [anchor]
        evidence = sorted({json.dumps(item, sort_keys=True):item for item in evidence}.values(),
                          key=lambda item:(item['file'], item.get('line', 0), item.get('symbol', '')))
        category, scope = exemplar['category'], exemplar['scope']
        if exemplar['owner'].endswith('.SeekTarget') and exemplar['declaration_kind'] == 'property':
            category, scope = 'configuration', 'runtime_argument_fields'
        output_rows.append({'id':identifier, 'category':category, 'scope':scope,
            'deprecated':any(row['deprecated'] for row in group), 'status':status,
            'officialReference':exemplar['official_reference'], 'evidence':evidence})
        excluded.pop(identifier, None)
        if exemplar['declaration_kind'] in ('function', 'extension_function') and len(group) > 1:
            mapped = sum(value in GUI_STATUSES for value in statuses)
            overload_notes.append(identifier + ': ' + str(len(group)) + ' public overload declarations; '
                                  + str(mapped) + ' app-panel GUI overloads mapped.')

    # Keep enum cases explicit as exclusions; choices are not independent APIs.
    for page in inventory['pages']:
        for member in page['members']:
            if member['kind'] == 'entry':
                identifier = 'android:' + page['qualified_owner'] + '.' + member['name']
                if identifier not in included:
                    excluded[identifier] = 'Enum choice; counted through its parent input/observation, not as an API operation.'

    scope_counts = collections.defaultdict(collections.Counter)
    for row in output_rows:
        scope_counts[row['scope']][row['category']] += 1
    count_notes = [scope + ': ' + ', '.join(str(counts[kind]) + ' ' + kind for kind in sorted(counts)) + '.'
                   for scope, counts in sorted(scope_counts.items())]
    notes = [
        'Bitmovin Android SDK ' + inventory['version'] + '; Android, Android TV and Android-based Fire TV share this SDK/build.',
        str(len(scoped_rows)) + ' source scoped declarations normalize to ' + str(len(output_rows))
            + ' qualified operational IDs across four categories. The full public callable/property/constructor census has '
            + str(len(all_rows)) + ' declarations; it is not an editable-control count.',
        'Configuration, commands, read-only observations and concrete event types have separate denominators. No aggregate percentage is asserted.',
        'Overloads count once by fully qualified method name; () distinguishes explicit methods from Kotlin properties. Exposed-overload counts are listed below.',
        'Generated enum/Parcelable/Data helpers, constructors/builders, property getter/setter and interface aliases, callback contracts and optional-wrapper declarations have explicit exclusion reasons.',
        'Deprecated callable fields/methods/events remain included; deprecation alone never excludes an operational ID.',
        'Missing means no exposed route in the audited app. The standard SDK UI routes below were separately exercised on an Android phone emulator; no Android TV or Fire TV device behavior is inferred.',
        'Eleven standard UI routes were observed at the native boundary: play, pause, seek, mute/unmute, speed, audio/subtitle/video quality selection and both public thumbnail query entry points. The thumbnail query returned null; this does not establish thumbnail image rendering. The speed selector offers only 0.25, 0.5, 1, 1.5 and 2, so that command receives preset credit.',
        'Fullscreen/PiP entry, exit and state controls and the mobile volume slider were verified absent from the configured phone UI. They remain missing and receive no GUI credit; reading a false native getter in a test does not count as an app observation.',
        'Current UI choices are Default/Sports/Live/Cinema. Shared assets and custom factories were exercised in the native phone tests. No TvUi/focus selector is exposed.',
        'Cast, IMA, DRM, offline, low-latency, VR, PiP and Analytics remain SDK-available with their media, dependency, license, hardware or integration prerequisites; lack of a test device does not remove them.',
        'OfflineManager is not wired to a GUI. Its helper calls receive code-only status. Allow DVR changes app-owned TimelineConfig; the separate SDK time shifting editor changes PlaybackConfig.isTimeShiftEnabled.',
        'jsLocation/cssLocation remain constant and match SDK defaults, so the UI mode picker does not receive GUI field credit for them.',
        'duration/maxTimeShift/timeShift contribute to the rendered DVR text. isLive/currentTime are copied but unused by PlaybackTimeline.deriveState and receive no observed GUI credit.',
        'Source evidence reads tracked public app and control-test files, including the configuration editor, SDK mapping and applied-code export. No environment files, native local properties, license values or device state are read by this generator.',
        '25 individual creation/source configuration leaves are editable. They include player/source audio-language priorities, one external WebVTT track\'s URL/label/language/default metadata and HTTP retry delays, alongside source target latency. Blank target latency leaves SourceConfig.liveConfig unset.',
        'PlayerConfig playback/buffer/adaptation/network bindings, SourceConfig options/liveConfig/subtitleTracks and BufferConfig.audioAndVideo are code-only owner bindings; they do not expose arbitrary objects or arrays. External track ID and WebVTT MIME type are fixed code-only values.',
        'Source Apply validates HTTP(S) URLs and finite offset seconds, constructs Source(SourceConfig) and invokes Player.load(Source). Only this load overload is an app GUI path. Player.config, Source.config and Player.isDestroyed reads in tests receive no observed GUI credit; Player.on/off and Source.on/off remain listener lifecycle code.',
        'Player Apply recreates the player and reloads the retained source options, preserving UI mode, log and app Allow DVR. Playback position resets. Source Reset restores the applied source draft; Player Reset restores SDK-default draft values. Reset alone does not apply either draft.',
        'Buffer durations are finite seconds: forward buffer is at least 0.5, and nonnegative startup/restart thresholds are at most forward minus 0.5, allowing 1 ULP of subtraction error. Automatic video bitrate is a nonnegative Int in bit/s; empty means 2147483647 with no ABR cap. Quality/stability balance is 0 through 1 and applies near the live edge.',
        'PlayerView onStart/onResume/onPause/onStop are internal host lifecycle calls. A view-owned observer catches up newly attached views in a resumed Activity and stops notifications before retirement. Detach precedes view.onDestroy, and the controller owns Player destruction. Foreground return can retain the SDK paused state; the regression explicitly requests Play rather than assuming automatic resume.',
        'The 2026-10-21 Android phone group passed all 16 cases, with 18 JVM tests and both app/test APK builds. It covered configuration, source-owned startup offset, standard UI/native controls, HLS/DASH live finalization, clipboard, ownership, UI handoffs and background return with explicit Play.',
        'Live acceptance couples a fresh TimeShifted completion, native zero time-shift and genuinely visible LIVE within the same deadline. Raw live latency and effective target latency are separate diagnostics; no seek-completion or ideal-latency SLA is asserted, and no automatic seek retry is added.',
    ] + ['A nonempty SourceConfig.preferredAudioLanguages list overrides the player preference; blank inherits it. Language codes retain order after trimming and case-insensitive duplicate removal. No match uses the SDK default audio track.', "The single external WebVTT track's isDefault flag is informational metadata and does not enable subtitles. Select the track through the normal Default UI subtitle menu. HTTP retry delays are finite nonnegative seconds: blank keeps linear backoff, none disables retries, and each list entry allows one retry. No arbitrary request callback or DRM renewal retry editor is provided."] + count_notes + overload_notes
    result = {'id':'android', 'sdkId':'android', 'platform':'Android', 'rows':output_rows,
              'excluded':[{'id':identifier, 'reason':reason} for identifier, reason in sorted(excluded.items())],
              'scopeNotes':notes}
    assert len({row['id'] for row in output_rows}) == len(output_rows)
    assert not ({row['id'] for row in output_rows} & set(excluded))
    assert all(row['category'] in ('configuration', 'command', 'observation', 'event') for row in output_rows)
    assert all(row['status'] in rank for row in output_rows)
    assert all(re.fullmatch(r'android:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+(?:\(\))?', row['id']) for row in output_rows)
    return result


def public_source_archive(version, artifact, scratch, artifact_cache, offline):
    name = artifact + '-' + version + '-sources.jar'
    target = scratch / name
    cached = artifact_cache / name if artifact_cache else None
    url = 'https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/' + artifact + '/' + version + '/' + name
    if cached is not None and cached.is_file():
        shutil.copyfile(cached, target)
    elif offline:
        raise RuntimeError('Offline SDK artifact cache is missing ' + name)
    else:
        request = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 public API coverage'})
        target.write_bytes(urllib.request.urlopen(request, timeout=60).read())
    return {'url':url, 'sha256':sha256(target.read_bytes())}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path, help='Public player-lab checkout root')
    parser.add_argument('--version', default='3.171.0')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--dokka-cache', type=Path, help='Read-only cache rooted at version/docs/')
    parser.add_argument('--sdk-artifact-cache', type=Path, help='Read-only official public sources.jar cache')
    parser.add_argument('--offline', action='store_true', help='Require complete supplied public caches; no network')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        parser.error('--version must be a numeric stable Android SDK version')
    repo = args.repo.resolve()
    for relative in APP_INPUTS:
        if not (repo / relative).is_file():
            parser.error('Missing public app source: ' + relative)
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.android-regenerate-', dir=args.output) as temporary:
        scratch = Path(temporary)
        artifacts = [public_source_archive(args.version, artifact, scratch, args.sdk_artifact_cache, args.offline)
                     for artifact in ('player-core', 'player-ui-web')]
        inventory = collect(args.version, scratch / 'dokka', args.dokka_cache, args.offline)
        scoped, all_public, validation, _ = build_scope(inventory, repo, scratch, args.version)
        snapshot = normalize(scoped, all_public, inventory, repo)
        document_hashes = {page['page']:page['sha256'] for page in inventory['pages'] + inventory['package_declarations']}
        sources = {'sdkId':'android', 'version':args.version, 'officialDokkaBase':inventory['base_url'],
            'sourceArtifacts':artifacts, 'dokkaTypePages':len(inventory['pages']),
            'dokkaPackagePages':len(inventory['package_declarations']),
            'documentPublicApiSha256':dict(sorted(document_hashes.items())),
            'hashNote':'Document hashes cover normalized public declaration kind/name/signature/deprecation only; descriptions and mutable CDN markup are excluded. Official source-archive hashes cover original distribution bytes.'}
        validation['normalizedOperationalIds'] = len(snapshot['rows'])
        validation['normalizedExcludedIds'] = len(snapshot['excluded'])
        validation['sourceArtifacts'] = artifacts
        validation['noRawSdkContentInSnapshot'] = True
        scope_summary = {}
        for scope in sorted({row['scope'] for row in snapshot['rows']}):
            selected = [row for row in snapshot['rows'] if row['scope'] == scope]
            scope_summary[scope] = {'rows':len(selected),
                'category':dict(collections.Counter(row['category'] for row in selected)),
                'status':dict(collections.Counter(row['status'] for row in selected))}
        summary = {'sdkId':'android', 'version':args.version,
            'sourceScopedDeclarations':len(scoped['rows']), 'sourcePublicDeclarations':len(all_public),
            'normalizedOperationalIds':len(snapshot['rows']), 'excludedIds':len(snapshot['excluded']),
            'byScope':scope_summary, 'category':dict(collections.Counter(row['category'] for row in snapshot['rows'])),
            'status':dict(collections.Counter(row['status'] for row in snapshot['rows']))}
        write_json(args.output / 'android.json', snapshot)
        write_json(args.output / 'android-sources.json', sources)
        write_json(args.output / 'android-validation.json', validation)
        write_json(args.output / 'android-summary.json', summary)
    print(json.dumps({'platform':'Android', 'version':args.version, 'rows':len(snapshot['rows']),
        'excluded':len(snapshot['excluded']), 'independentSourceChecks':len(validation['checks']),
        'sourceChecksPassed':validation['pass'], 'status':dict(collections.Counter(row['status'] for row in snapshot['rows'])),
        'category':dict(collections.Counter(row['category'] for row in snapshot['rows']))}, indent=2))


if __name__ == '__main__':
    main()
