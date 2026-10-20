#!/usr/bin/env python3
"""Build scoped public declarations in a temporary scratch directory.

Only public SDK identifiers/signatures are parsed in memory; raw distributions
and intermediate data stay in caller-owned temporary scratch storage.
"""
import hashlib
import json
import re
import zipfile
from collections import Counter
from pathlib import Path

CONFIGURATION_EXPOSURE = json.loads((Path(__file__).with_name('exposure.json')).read_text())['configuration']


def build_scope(inventory, repo, scratch, version):
    ART = Path(scratch)
    REPO = Path(repo).resolve()
    VERSION = version
    DATA = inventory
    PAGES = {r['url']:r for r in DATA['pages']}
    MAIN = 'apps/android/app/src/main/kotlin/com/showcase/app/MainActivity.kt'
    SOURCES = 'apps/android/app/src/main/kotlin/com/showcase/app/Sources.kt'
    OFFLINE = 'apps/android/app/src/main/kotlin/com/showcase/app/OfflineManager.kt'
    DVR = 'apps/android/dvr/src/main/kotlin/com/showcase/dvr/Dvr.kt'
    CONFIG = 'apps/android/app/src/main/kotlin/com/showcase/app/Configuration.kt'
    EDITOR = 'apps/android/app/src/main/kotlin/com/showcase/app/ConfigurationPanel.kt'


    def qualified(r):
        parts=r['page'].split('/')
        owners=[]
        for i in range(2,len(parts)-1):
            parent='/'.join(parts[:i+1])+ '/index.html'
            hit=next((x for x in DATA['pages'] if x['page']==parent),None)
            if hit:
                owners.append(hit['owner'])
        return r['package']+('.'+'.'.join(owners) if owners else '')


    for r in DATA['pages']:
        r['qualified_owner']=qualified(r)
    for r in DATA.get('package_declarations',[]):
        r['qualified_owner']=r['package']


    def ev(path, needle, symbol, note=''):
        lines=(REPO/path).read_text().splitlines()
        hits=[i+1 for i,s in enumerate(lines) if needle in s]
        if not hits:
            raise RuntimeError(f'Missing tracked evidence: {path}:{needle}')
        return {'file':path,'line':hits[0],'symbol':symbol,'note':note,
                'source_sha256':hashlib.sha256((REPO/path).read_bytes()).hexdigest()}


    def qpage(owner,module='player-core'):
        return next(r for r in DATA['pages'] if r['owner']==owner and r['module']==module and r['page'].count('/-')==1)


    runtime_owners=['Player','Source','AdvertisingApi','BufferApi','RemoteControlApi','LowLatencyApi','PlaylistApi','VrApi','SsaiApi']
    runtime=[qpage(n) for n in runtime_owners]
    runtime += [qpage('PlayerView','player-ui-web'),qpage('UserInterfaceApi','player-ui-web'),
                qpage('OfflineContentManager'),qpage('AnalyticsApi','player-analytics'),qpage('SourceAnalyticsApi','player-analytics')]
    runtime_urls={r['url'] for r in runtime}

    # Named config/options types and their public nested variants are independently
    # inspectable declarations. Builders and companions are aliases, retained in raw.
    config_types=set()
    for r in DATA['pages']:
        if r['module'] not in ('player-core','player-ui-web','player-analytics','player'):
            continue
        if r['owner'].endswith(('Config','Options')):
            config_types.add(r['url'])
    for url in list(config_types):
        for r in DATA['pages']:
            if r['url'].startswith(url.removesuffix('index.html')) and r['owner'] not in ('Builder','Companion'):
                config_types.add(r['url'])

    # Also retain the configurable data structures directly referred to by input
    # fields, including AdItem, subtitle/thumbnail tracks and CMCD union variants.
    # Callback input/output payloads and runtime roots are separate, not field fanout.
    supporting=set()
    queue=list(config_types)
    while queue:
        r=PAGES[queue.pop()]
        # Public base types declare inherited fields once (for example Track).
        bases=set(re.findall(r'\b[A-Z]\w*\b',r['class_signature'].split(' : ',1)[-1])) if ' : ' in r['class_signature'] else set()
        for url in r.get('class_type_urls',[]):
            target=PAGES.get(url)
            if target and target['owner'] in bases and url not in config_types and url not in supporting and url not in runtime_urls:
                supporting.add(url);queue.append(url)
        for m in r['members']:
            if m['kind']!='property' or '->' in m['signature']:
                continue
            for url in m['type_urls']:
                target=PAGES.get(url)
                if (target is None or url in runtime_urls or url in config_types or url in supporting
                    or target['owner'] in ('Builder','Companion') or re.search(r'(Callback|Handler|Listener|Renderer|Provider|Exception|Event)$',target['owner'])):
                    continue
                if target['module'] not in ('player-core','player-ui-web','player-analytics','player'):
                    continue
                supporting.add(url);queue.append(url)
                for nested in DATA['pages']:
                    if nested['url'].startswith(url.removesuffix('index.html')) and nested['owner'] not in ('Builder','Companion') and nested['url'] not in supporting and nested['url'] not in config_types:
                        supporting.add(nested['url']);queue.append(nested['url'])

    # Return objects and public helper interfaces are separately inventoried so that
    # the broad audit is not limited to the app's current calls or first-level roots.
    runtime_supporting=set()
    queue=[r['url'] for r in runtime]
    while queue:
        r=PAGES[queue.pop()]
        links=set(r.get('class_type_urls',[]))
        for m in r['members']:
            if m['kind'] in ('property','function'):links.update(m['type_urls'])
        for url in links:
            target=PAGES.get(url)
            if (target is None or url in runtime_urls or url in runtime_supporting or url in config_types or url in supporting
                or target['owner'] in ('Builder','Companion') or target['module'] not in ('player-core','player-ui-web','player-analytics','player')):
                continue
            if '/com.bitmovin.player.api.event/' in url or '/com.bitmovin.player.api.event.data/' in url:
                continue
            runtime_supporting.add(url);queue.append(url)

    root_membership={}
    def mark_roots(seed,allowed):
        seen=set();todo=[seed['url']]
        while todo:
            url=todo.pop()
            if url in seen or url not in allowed:continue
            seen.add(url);root_membership.setdefault(url,set()).add(seed['qualified_owner'])
            page=PAGES[url]
            links=set(page.get('class_type_urls',[])) | set(page.get('inheritor_urls',[]))
            for member in page['members']:
                if member['kind'] in ('property','function','type'):
                    links.update(member['type_urls'])
                    if member['kind']=='type':links.add(member['url'])
            todo.extend(links & allowed)
    for name,module in [('PlayerConfig','player-core'),('SourceConfig','player-core'),('PlayerViewConfig','player-ui-web'),('OfflineConfig','player-core'),('PlaylistConfig','player-core'),('AnalyticsPlayerConfig','player-analytics'),('AnalyticsSourceConfig','player-analytics'),('DebugConfig','player-core'),('LoggingEventConfig','player-core')]:
        mark_roots(qpage(name,module),config_types|supporting)
    for page in [qpage('Player'),qpage('Source'),qpage('PlayerView','player-ui-web'),qpage('UserInterfaceApi','player-ui-web'),qpage('OfflineContentManager'),qpage('AnalyticsApi','player-analytics'),qpage('SourceAnalyticsApi','player-analytics')]:
        mark_roots(page,runtime_urls|runtime_supporting)


    def availability(r,m):
        q=r['qualified_owner']
        notes=[]
        if r['module'] in ('player-media-session','player-video-feed'):
            notes.append('Optional '+r['module']+' artifact is documented publicly but is not included by the current app dependency declaration.')
        if '.offline.' in q:
            notes.append('Offline-capable source, storage, notification/foreground-service permissions, download service and localbroadcastmanager dependency. Existing app helper is not connected to GUI and manifest lacks the download service/permissions.')
        if '.casting.' in q or r['owner']=='RemoteControlApi':
            notes.append('Google Cast framework dependency, configured sender and receiver, discovery/network and supported device services; not guaranteed on Fire TV.')
        if '.drm.' in q or m['name']=='preloadDrmLicense':
            notes.append('Compatible encrypted source, DRM license endpoint, entitlement and supported device/CDM/security level.')
        if '.ima.' in q:
            notes.append('IMA dependency, +jason Player flavor and core library desugaring are required; current app uses plain flavor.')
        if '.advertising.' in q or '.ssai.' in q:
            notes.append('Compatible ad tag/source/integration and network; IMA has additional dependency/flavor requirements.')
        if '.analytics.' in q:
            notes.append('Analytics configuration/license and collection consent where required; collector-owned APIs are a separate SDK scope.')
        if '.live.' in q:
            notes.append('Compatible live/low-latency source and manifest prerequisites where applicable.')
        if '.vr.' in q:
            notes.append('VR-formatted source/renderer and supported sensors or input provider where applicable.')
        if 'PictureInPicture' in m['name']:
            notes.append('Supported Android/device state, manifest PiP capability and lifecycle integration; not configured/tested here.')
        return {'status':'available_with_prerequisites' if notes else 'available',
                'platforms':['Android','Android TV','Android-based Fire TV'],
                'notes':notes,'runtime_verified':False}


    def mapping(r,m,category):
        owner=r['qualified_owner']; name=m['name']; signature=m['signature']
        result={'status':'missing','evidence':[],'runtime_verified':False}
        member = 'android:' + owner + '.' + name
        if m['kind'] == 'property' and member in CONFIGURATION_EXPOSURE:
            exposed = CONFIGURATION_EXPOSURE[member]
            result.update(status=exposed['status'], evidence=[
                ev(item['file'], item['needle'], item['symbol'], exposed['limitation'])
                for item in exposed['evidence']])
        elif owner.endswith('.PlayerConfig') and name=='key':
            result.update(status='code_only',evidence=[ev(CONFIG,'key = licenseKey,','key = licenseKey','Initialized from app metadata, no GUI editor.')])
        elif owner.endswith('.PlayerViewConfig') and name=='uiConfig':
            result.update(status='constrained_preset',evidence=[ev(MAIN,'uiConfig = UiConfig.WebUi(','playerViewConfig'),ev(MAIN,'uiMode = mode','ShowcaseScreen UI picker')])
        elif owner.endswith('.UiConfig.WebUi') and name=='variant':
            result.update(status='constrained_preset',evidence=[ev(MAIN,name+' =','playerViewConfig','Default/Sports/Live/Cinema presets; not a free field editor.'),ev(MAIN,'uiMode = mode','ShowcaseScreen UI picker')])
        elif owner.endswith('.UiConfig.WebUi') and name in ('jsLocation','cssLocation'):
            result.update(status='code_only',evidence=[ev(MAIN,name+' =','playerViewConfig','Constant path matches the SDK default across all modes. UI mode selection does not change this field.')])
        elif owner.endswith('.UiConfig.WebUi.Variant.Custom') and name=='uiManagerFactoryFunction':
            result.update(status='constrained_preset',evidence=[ev(MAIN,'Variant.Custom(mode.factoryFunction)','playerViewConfig','One of three hardcoded custom factory names.')])
        elif owner.endswith('.Player') and name=='load' and 'source: Source' in signature:
            result.update(status='direct_gui',evidence=[
                ev(EDITOR,'validated.value?.let { controller.applySource(it) }','controller.applySource(it)','Validated arbitrary HTTP(S) URL and all four source types.'),
                ev(MAIN,'val source = sourceFactory(sourceSettings.toSourceConfig())','sourceFactory(sourceSettings.toSourceConfig())'),
                ev(MAIN,'owner.load(source)','owner.load(source)','Only the Source overload is an app GUI path; SourceConfig and other overloads are not exposed.')])
        elif owner.endswith('.Player') and name=='timeShift' and m['kind']=='function':
            result.update(status='constrained_preset',evidence=[ev(MAIN,'player.timeShift(if','PlayerController.seek','Fixed offsets -10/-30/-60 with clamp; live edge passes 0.'),ev(MAIN,'controller.goToLiveEdge()','ShowcaseScreen live-edge button')])
        elif owner.endswith('.Player') and name in ('duration','maxTimeShift','timeShift') and m['kind']=='property':
            result.update(status='observed',evidence=[ev(MAIN,name+' = player.'+name,'PlayerController.snapshot'),ev(DVR,'fun deriveState(','Dvr.deriveState','Value contributes to rendered DVR mode/window/behindLive.'),ev(MAIN,'"mode=${dvr.mode.raw}','ShowcaseScreen DVR text')])
        elif owner.endswith('.Player') and name in ('isLive','currentTime'):
            result.update(status='code_only',evidence=[ev(MAIN,name+' = player.'+name,'PlayerController.snapshot'),ev(DVR,'fun deriveState(','Dvr.deriveState','Snapshot copies the value but deriveState never reads it; no GUI observation credit.')])
        elif owner.endswith('.Player') and name=='destroy':
            result.update(status='code_only',evidence=[ev(MAIN,'player.destroy()','PlayerController.release','Lifecycle only.'),
                ev(MAIN,'previous.destroy()','PlayerController.applyPlayerSettings','Cleanup after player replacement; no standalone destroy control.')])
        elif owner.endswith('.PlayerView') and name in ('onStart','onResume','onPause','onStop'):
            result.update(status='code_only',evidence=[ev(MAIN,'it::'+name,'PlayerController.attachView',
                'View-owned host lifecycle forwarding, including resumed-state catch-up; not a GUI command.')])
        elif owner.endswith('.PlayerView') and name in ('player','setPlayer','onDestroy'):
            needle = 'view.onDestroy()' if name == 'onDestroy' else 'view.player = null'
            result.update(status='code_only',evidence=[ev(MAIN,needle,needle,'Detach/release lifecycle; not an API command control.')])
        elif owner.endswith('.AnalyticsPlayerConfig.Enabled') and name=='analyticsConfig':
            result.update(status='code_only',evidence=[ev(MAIN,'AnalyticsPlayerConfig.Enabled(','PlayerController.createPlayer','Enabled from optional app metadata license; no GUI editor.')])
        elif owner=='com.bitmovin.player.api' and name=='Player' and m['kind']=='function':
            result.update(status='code_only',evidence=[ev(MAIN,'Player(context, config)','PlayerController.createPlayer','Factory used at player creation; its configuration leaves are mapped individually.')])
        elif owner.endswith('.OfflineContentManager') and name in ('getOptions','offlineSourceConfig','deleteAll','release','process'):
            needles={'getOptions':'manager.getOptions()','offlineSourceConfig':'manager.offlineSourceConfig','deleteAll':'manager.deleteAll()','release':'manager.release()','process':'manager.process(options)'}
            result.update(status='code_only',evidence=[ev(OFFLINE,needles[name],'OfflineManager','Helper exists but is never instantiated from MainActivity or GUI.')])
        elif owner.endswith('.OfflineContentManager.Companion') and name=='getOfflineContentManager':
            result.update(status='code_only',evidence=[ev(OFFLINE,'OfflineContentManager.getOfflineContentManager(','OfflineManager.manager','Helper factory has no GUI path.')])
        elif owner.endswith('.OfflineOptionEntry') and name=='action':
            result.update(status='code_only',evidence=[ev(OFFLINE,'?.action = OfflineOptionEntryAction.Download','OfflineManager.onOptionsAvailable','Helper option mutation has no GUI path.')])
        elif owner.endswith('.PlayerEvent.Error') and name=='code':
            result.update(status='observed',evidence=[ev(MAIN,'append("PlayerError ${it.code.value}")','PlayerController.observePlayer PlayerEvent.Error','Numeric error code is rendered in the event log.')])
        elif owner.endswith('.SourceEvent.Error') and name=='code':
            result.update(status='observed',evidence=[ev(MAIN,'append("SourceError ${it.code.value}")','PlayerController.loadCurrentSource SourceEvent.Error','Numeric error code is rendered in the event log.')])
        elif owner.endswith('.PlayerErrorCode') and name=='value':
            result.update(status='observed',evidence=[ev(MAIN,'append("PlayerError ${it.code.value}")','PlayerController.observePlayer PlayerEvent.Error','Numeric error value is rendered in the event log.')])
        elif owner.endswith('.SourceErrorCode') and name=='value':
            result.update(status='observed',evidence=[ev(MAIN,'append("SourceError ${it.code.value}")','PlayerController.loadCurrentSource SourceEvent.Error','Numeric error value is rendered in the event log.')])
        if category=='event':
            family=owner.split('.')[-1]
            needle=family+'.'+name+'::class'
            if (family,name) in {('PlayerEvent','Error'),('SourceEvent','Error'),('PlayerEvent','TimeChanged'),('SourceEvent','Loaded'),('PlayerEvent','TimeShifted'),('PlayerEvent','DvrWindowExceeded')}:
                if family == 'SourceEvent':
                    action = 'if (ownsSource()) { lastErrorCode = it.code.value; append("SourceError ${it.code.value}") }' if name == 'Error' else 'if (ownsSource()) { lastErrorCode = null; append("SourceLoaded"); refresh() }'
                    evidence = [ev(MAIN,needle,'PlayerController.loadCurrentSource'), ev(MAIN,action,action)]
                else:
                    evidence = [ev(MAIN,needle,'PlayerController.observePlayer')]
                evidence.append(ev(MAIN,'controller.log.take(12)' if name != 'TimeChanged' else '"mode=${dvr.mode.raw}',
                                   'ShowcaseScreen event log' if name != 'TimeChanged' else 'ShowcaseScreen DVR text'))
                result.update(status='observed',evidence=evidence)
        return result


    def make_row(r,m,category,scope):
        owner=r['qualified_owner']
        suffix=m['name']
        if m['kind'] in ('function','extension_function'):
            suffix=m['signature'].split('fun ',1)[-1]
        elif m['kind']=='extension_property':
            suffix=m['signature'].split('val ',1)[-1].split('var ',1)[-1]
        elif m['kind']=='constructor':
            suffix='<init>'+m['signature'].split('constructor',1)[-1]
        roots=sorted(root_membership.get(r['url'],{owner}))
        row={'id':'android:'+owner+'.'+suffix,'sdk_version':VERSION,'category':category,
             'scope':scope,'owner':owner,'root':roots[0],'roots':roots,'member':m['name'],'declaration_kind':m['kind'],
             'signature':m['signature'],'deprecated':m['deprecated'],
             'experimental':m['experimental'] or 'ExperimentalBitmovinApi' in r['class_signature'],
             'availability':availability(r,m),'official_reference':m['url'],
             'artifact_source':{'url':r['url'],'sha256':r['sha256']},
             'coverage':mapping(r,m,category)}
        if scope.startswith('runtime'):
            candidates={'play','pause','seek','timeShift','mute','unmute','volume','playbackSpeed','setAudio','setAudioTrack','setVideoQuality','setSubtitle','setSubtitleTrack','enterFullscreen','exitFullscreen','enterPictureInPicture','exitPictureInPicture'}
            row['sdk_ui_coverage']={'status':'unaudited' if m['name'] in candidates else 'not_assessed',
                'evidence':[ev(MAIN,'PlayerView(context, displayedPlayer, playerViewConfig(uiMode))','ShowcaseScreen AndroidView')],
                'note':'SDK Web UI and shared custom factories have their own controls. This inventory does not infer native bridge or device GUI coverage from API presence or compilation.'}
        return row


    rows=[]
    generated_names={'entries','CREATOR'}
    for url in sorted(config_types | supporting):
        r=PAGES[url]
        for m in r['members']:
            if m['kind']!='property':continue
            scope='configuration_named_types' if url in config_types else 'configuration_supporting_types'
            category='observation' if r['owner']=='SourceConfig' and m['name'] in ('dashSource','hlsSource','smoothSource','progressiveSource','drmConfigs') else 'configuration'
            if url in supporting:
                constructors=' '.join(x['signature'] for x in r['members'] if x['kind']=='constructor')
                if not re.search(r'\bvar\b',m['signature']) and not re.search(r'\b'+re.escape(m['name'])+r'\s*:',constructors):
                    category='observation'
            if m['name'] in generated_names:
                category='observation';scope='supporting_generated_accessors'
            rows.append(make_row(r,m,category,scope))
    for r in runtime:
        scope='runtime_playback' if r['owner'] in runtime_owners else 'runtime_ui_offline_analytics'
        for m in r['members']:
            if m['kind'] not in ('property','function'):continue
            observation=(m['kind']=='property' and not re.search(r'\bvar\b',m['signature'])) or (m['kind']=='function' and (m['name'].startswith(('get','is'))))
            category='observation' if observation else 'command'
            rows.append(make_row(r,m,category,scope))
    for url in sorted(runtime_supporting):
        r=PAGES[url]
        for m in r['members']:
            if m['kind'] not in ('property','function'):continue
            observation=(m['kind']=='property' and not re.search(r'\bvar\b',m['signature'])) or (m['kind']=='function' and (m['name'].startswith(('get','is')) or m['name'] in ('equals','hashCode','toString','compareTo')))
            category='observation' if observation else 'command'
            scope='supporting_generated_accessors' if m['name'] in generated_names else 'runtime_supporting_types'
            rows.append(make_row(r,m,category,scope))
    for r in DATA.get('package_declarations',[]):
        if r['module'] not in ('player-core','player-ui-web','player-analytics','player'):continue
        for m in r['members']:
            if m['kind'] not in ('function','extension_function','property','extension_property'):continue
            category='observation' if m['kind'] in ('property','extension_property') or m['name'].startswith(('get','is')) else 'command'
            rows.append(make_row(r,m,category,'runtime_factories_extensions'))
    for family in ['PlayerEvent','SourceEvent','OfflineEvent']:
        r=qpage(family)
        for m in r['members']:
            if m['kind']=='type':rows.append(make_row(r,m,'event','events'))

    ids=[r['id'] for r in rows]
    if len(ids)!=len(set(ids)):
        raise RuntimeError('Duplicate qualified ids: '+str([k for k,v in Counter(ids).items() if v>1]))

    config_pages=[PAGES[u] for u in sorted(config_types)]
    summary={'by_scope':{},'runtime_by_owner':{},'root_config_fields':{},'events':{}}
    for scope in sorted({r['scope'] for r in rows}):
        selected=[r for r in rows if r['scope']==scope]
        summary['by_scope'][scope]={'declarations':len(selected),'category':dict(Counter(r['category'] for r in selected)),
           'coverage':dict(Counter(r['coverage']['status'] for r in selected)),'deprecated':sum(r['deprecated'] for r in selected)}
    for r in runtime:
        subset=[x for x in rows if x['owner']==r['qualified_owner']]
        summary['runtime_by_owner'][r['qualified_owner']]={'methods':sum(x['declaration_kind']=='function' for x in subset),'properties':sum(x['declaration_kind']=='property' for x in subset),'categories':dict(Counter(x['category'] for x in subset))}
    for owner,module in [('PlayerConfig','player-core'),('SourceConfig','player-core'),('PlayerViewConfig','player-ui-web')]:
        r=qpage(owner,module);subset=[x for x in rows if x['owner']==r['qualified_owner']]
        summary['root_config_fields'][r['qualified_owner']]={'fields':len(subset),'configurable':sum(x['category']=='configuration' for x in subset),'deprecated':sum(x['deprecated'] for x in subset),'coverage':dict(Counter(x['coverage']['status'] for x in subset))}
    for family in ['PlayerEvent','SourceEvent','OfflineEvent']:
        subset=[x for x in rows if x['scope']=='events' and x['owner'].endswith('.'+family)]
        summary['events'][family]={'types':len(subset),'deprecated':sum(x['deprecated'] for x in subset),'observed':sum(x['coverage']['status']=='observed' for x in subset)}

    result={'schema_version':1,'platform':'Android','sdk_version':VERSION,'app_source_scope':'Tracked public player-lab app sources; no credential/config files read.',
        'scope_notes':[
           'All named public Config/Options types in the shipped core/UI/analytics/player documentation and nested union variants. Linked supporting input/value/base structures are a separate scope and read-only results are observations. Each declared owner/member counts once; inherited fields remain on their declaring owner.',
           'Runtime playback domain: Player, Source and every public Player sub-API, including inherited casting. UI, offline and Analytics integration APIs are a separate domain.',
           'Deprecated callable properties/methods/events are retained with flags. Constructors/builders/companions and event subscription overload aliases remain fully preserved in dokka-public-inventory.json; they are not multiplied into field/command coverage.',
           'Public generated enum entries and Parcelable CREATOR accessors are retained in supporting_generated_accessors, as observations. Builder/constructor/companion aliases, enum cases and event payload properties remain in the full raw inventory without multiplying the semantic field/command units. Optional media-session/video-feed wrappers and the separate Analytics collector dependency remain separately identifiable in the raw inventory.',
           'SDK Web UI integration exists; its native bridge/device availability is an unaudited scope and is not silently counted as custom app panel coverage. Android TV/Fire TV use the same build, with no TV UI selector currently exposed.',
           'No aggregate percentage is emitted: configuration structures, method overloads, getter observations and concrete event types are different units.'
        ],
        'excluded_unavailable_internal_nonpublic':[],
        'app_non_sdk_controls':[{'control':'Allow DVR','reason':'Changes app-owned DvrConfig.timeShiftEnabled, not SDK PlayerConfig or SourceConfig.',
            'evidence':[ev(MAIN,'fun toggleDvr(enabled: Boolean)','PlayerController.toggleDvr')]}],
        'configuration_type_pages':[{'owner':r['qualified_owner'],'url':r['url'],'sha256':r['sha256']} for r in config_pages],
        'summary':summary,'rows':rows}
    (ART/'android-coverage-rows.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (ART/'android-coverage-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')

    unknown = set(CONFIGURATION_EXPOSURE) - {row['id'] for row in rows if row['category'] == 'configuration'}
    if unknown:
        raise RuntimeError('Configuration exposure references an unavailable scoped SDK field: ' + ', '.join(sorted(unknown)))

    # Exhaustive flattened declaration companion. No public callable is lost merely
    # because it is a builder, constructor/static alias, optional module or payload
    # helper. The scoped semantic inventory above remains the report denominator.
    all_rows={r['id']:r for r in rows}
    for r in DATA['pages']+DATA.get('package_declarations',[]):
        for m in r['members']:
            if m['kind'] not in ('property','function','constructor','extension_property','extension_function'):continue
            if r['url'] in config_types or r['owner']=='Builder':
                category='configuration'
            elif m['kind'] in ('property','extension_property'):
                category='observation' if not re.search(r'\bvar\b',m['signature']) else 'command'
            elif m['kind']=='function' and m['name'].startswith(('get','is')) and m['name']!='getOfflineContentManager':
                category='observation'
            else:category='command'
            scope='public_constructor_builder_static_and_value_declarations'
            if r['module'] in ('player-media-session','player-video-feed'):
                scope='optional_module_public_declarations'
            row=make_row(r,m,category,scope)
            if row['id'] not in all_rows:
                row['semantic_counting']='Supporting/alias declaration retained; refer to scoped inventory before combining units.'
                all_rows[row['id']]=row
    (ART/'android-all-public-declarations.json').write_text(json.dumps({'schema_version':1,'sdk_version':VERSION,
        'scope':'All documented public type/package properties, functions, extension functions/properties and constructors, plus concrete event types. Builder/static/constructor aliases and optional modules are retained separately. Type aliases and enum cases remain in raw Dokka inventory.',
        'rows':sorted(all_rows.values(),key=lambda r:r['id'])},ensure_ascii=False,indent=2)+'\n')

    # Independent source-jar census for the public interfaces and root input/event
    # declarations. No implementation/internal source repositories are accessed.
    z=zipfile.ZipFile(ART/f'player-core-{VERSION}-sources.jar')
    checks=[]
    source_files={'Player':'Player.kt','Source':'source/Source.kt','AdvertisingApi':'advertising/AdvertisingApi.kt','BufferApi':'buffer/BufferApi.kt','RemoteControlApi':'casting/RemoteControlApi.kt','LowLatencyApi':'live/LowLatencyApi.kt','PlaylistApi':'playlist/PlaylistApi.kt','VrApi':'vr/VrApi.kt','SsaiApi':'ssai/SsaiApi.kt'}
    for owner,file in source_files.items():
        s=z.read(file).decode();s=re.sub(r'/\*.*?\*/','',s,flags=re.S);s=re.sub(r'//[^\n]*','',s).split('public companion object')[0]
        methods=len(re.findall(r'\bpublic\s+fun\b',s));props=len(re.findall(r'\bpublic\s+(?:val|var)\b',s))
        doc=summary['runtime_by_owner'][qpage(owner)['qualified_owner']]
        check={'owner':owner,'source_jar_entry':file,'public_source_methods':methods,'public_source_properties':props,'dokka_methods':doc['methods'],'dokka_properties':doc['properties']}
        check['pass']=methods==doc['methods'] and props==doc['properties'];checks.append(check)
    for owner,file in [('PlayerConfig','PlayerConfig.kt'),('SourceConfig','source/SourceConfig.kt')]:
        s=z.read(file).decode();s=re.sub(r'/\*.*?\*/','',s,flags=re.S);s=re.sub(r'//[^\n]*','',s).split('public class Builder')[0]
        props=len(re.findall(r'\bpublic\s+(?:val|var)\b',s))
        expected=summary['root_config_fields'][qpage(owner)['qualified_owner']]['fields']
        checks.append({'owner':owner,'source_jar_entry':file,'public_source_properties':props,'dokka_properties':expected,'pass':props==expected})
    ui_sources=zipfile.ZipFile(ART/f'player-ui-web-{VERSION}-sources.jar')
    for owner,file in [('PlayerViewConfig','ui/PlayerViewConfig.kt'),('WebUi','ui/UiConfig.kt')]:
        s=ui_sources.read(file).decode();s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
        start=s.index('class '+owner+'(')+len('class '+owner+'(');depth=1;pos=start
        while depth:
            if s[pos]=='(':depth+=1
            elif s[pos]==')':depth-=1
            pos+=1
        props=len(re.findall(r'\b(?:val|var)\s+\w+\s*:',s[start:pos-1]))
        page=next(r for r in DATA['pages'] if r['owner']==owner and r['module']=='player-ui-web')
        expected=sum(m['kind']=='property' for m in page['members'])
        checks.append({'owner':owner,'source_jar_entry':file,'public_source_constructor_fields':props,'dokka_properties':expected,'pass':props==expected})
    events_source=z.read('event/Event.kt').decode()
    for family in ['PlayerEvent','SourceEvent','OfflineEvent']:
        start=events_source.index('public sealed class '+family)
        end=events_source.find('public sealed class ',start+1)
        part=events_source[start:end if end>=0 else None]
        count=len(re.findall(r'public\s+(?:data\s+)?class\s+\w+',part))
        checks.append({'owner':family,'source_jar_entry':'event/Event.kt','public_source_concrete_types':count,'dokka_concrete_types':summary['events'][family]['types'],'pass':count==summary['events'][family]['types']})
    validation={'checks':checks,'pass':all(x['pass'] for x in checks),'source_jar_sha256':hashlib.sha256((ART/f'player-core-{VERSION}-sources.jar').read_bytes()).hexdigest(),'rows_unique':True,'row_count':len(rows),'all_public_declaration_rows':len(all_rows),'dokka_pages':len(DATA['pages']),'dokka_packages':len(DATA.get('package_declarations',[]))}
    (ART/'android-inventory-validation.json').write_text(json.dumps(validation,indent=2)+'\n')
    if not validation['pass']:raise RuntimeError(validation)
    return result, all_rows, validation, summary
