"""Explicit public routes and assets for the bilingual user guide."""

CHAPTERS = {
    'start': 'start', 'local-setup': 'start',
    'web-screen-themes': 'web', 'web-sources-tracks': 'web',
    'web-ui-settings': 'web', 'web-live-dvr': 'web',
    'web-player-config': 'web', 'web-qoe-analytics': 'web',
    'web-ui-customization': 'web',
    'native-overview': 'native', 'native-apple': 'native',
    'native-android': 'native', 'native-integrations': 'native',
    'media': 'media', 'audio-timing': 'media', 'cloud-encoding': 'media',
    'live-finalization': 'media', 'measurement': 'media',
    'troubleshooting': 'reference', 'glossary': 'reference',
}
SETTING_GROUPS = (
    'player-api', 'dynamic-adaptation', 'low-latency', 'source', 'playback',
    'adaptation', 'buffer', 'network', 'tweaks', 'logs', 'style', 'cast', 'live', 'location', 'misc',
)
THEMES = (
    'default', 'custom-neon', 'custom-glass', 'custom-sunset', 'custom-bold',
    'custom-mono', 'custom-live', 'custom-sports', 'custom-binge', 'custom-cinema',
    'custom-compact', 'custom-premiere', 'custom-creator', 'custom-studio',
)
LANGUAGES = ('en', 'ja')
SHARED_FIGURES = {
    'android-source-settings': (1080, 2400),
    'android-player-settings': (1080, 2400),
    'android-applied-code': (1080, 2400),
    'ios-playback-tracks': (1668, 2420),
    'ios-initial-tracks': (1668, 2420),
    'ios-video-scaling': (1668, 2420),
    'ios-applied-code': (1668, 2420),
    'tvos-playback-tracks': (3840, 2160),
    'tvos-initial-tracks': (3840, 2160),
    'tvos-video-scaling': (3840, 2160),
    'tvos-applied-code': (3840, 2160),
}
COVERAGE_APPS = ('web', 'web-ui', 'ios', 'tvos', 'android', 'react-native', 'vega')
DOCUMENTS = (*CHAPTERS, 'settings', 'controls', 'themes', 'api-coverage')
SLUGS = ('', *DOCUMENTS, *(f'settings/{name}' for name in SETTING_GROUPS),
         *(f'api-coverage/{name}' for name in COVERAGE_APPS))
SOURCE_REVISION = '2fa676243228288c42e110f5016b9309de516b55'
CONTENT_REVIEW = '2026-10-21'
PUBLIC_BASE = 'https://kazuhide.github.io/player-lab/'


def route_file(language, slug=''):
    prefix = 'ja/guide' if language == 'ja' else 'guide'
    return f'{prefix}/{slug + "/" if slug else ""}index.html'


GUIDE_FILES = {
    *(route_file(language, slug) for language in LANGUAGES for slug in SLUGS),
    'guide/search-index.json', 'ja/guide/search-index.json',
}
GUIDE_ASSETS = {
    'guide.css', 'guide.js',
    *(f'assets/guide/{name}.jpg' for name in SHARED_FIGURES),
    *(f'assets/guide/{name}.jpg' for name in THEMES),
    *(f'assets/guide/{name}-{language}.jpg'
      for name in ('overview', 'source-controls', 'config') for language in LANGUAGES),
}
