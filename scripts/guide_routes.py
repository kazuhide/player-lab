"""Explicit public routes and assets for the bilingual user guide."""

CHAPTERS = {
    'start': 'start', 'local-setup': 'start',
    'web-screen-themes': 'web', 'web-sources-tracks': 'web',
    'web-ui-settings': 'web', 'web-live-dvr': 'web',
    'web-player-config': 'web', 'web-ui-customization': 'web',
    'native-overview': 'native', 'native-apple': 'native',
    'native-android': 'native', 'native-integrations': 'native',
    'troubleshooting': 'reference', 'audio-timing': 'reference',
    'test-results': 'reference', 'glossary': 'reference',
    'web-qoe-analytics': 'analytics', 'analytics-metrics': 'analytics',
    'analytics-visualization': 'analytics', 'analytics-queries': 'analytics',
    'analytics-ai': 'analytics',
}
CATEGORIES = ('start', 'web', 'native', 'reference', 'analytics')
LEGACY_ROUTES = {
    'measurement': 'test-results',
    'media': 'web-sources-tracks',
    'cloud-encoding': 'web-sources-tracks',
    'live-finalization': 'troubleshooting',
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
    'vega-api-operation': (1920, 1080),
    'vega-api-volume': (1920, 1080),
    'vega-api-callback': (1920, 1080),
    'rn-ios-api-callback': (1206, 2622),
    'rn-android-api-operation': (1080, 2400),
    'rn-ios-api-events': (1206, 2622),
    'rn-android-cast-startup': (1080, 2400),
    'ios-offline-track-selection': (1206, 2622),
    'ios-callback-sdk-status': (1206, 2622),
    'ios-callback-editor': (1206, 2622),
    'ios-subtitle-array-sdk-state': (1206, 2622),
    'ios-subtitle-array-editor': (1206, 2622),
    'ios-api-volume-state': (1206, 2622),
    'ios-api-operation': (1206, 2622),
    'tvos-api-state': (3840, 2160),
    'ios-cast-options': (1206, 2622),
    'ios-cast-sdk-state': (1206, 2622),
    'analytics-dashboard-overview': (2864, 1270),
    'analytics-dashboard-errors': (1324, 501),
    'analytics-session-errors': (804, 188),
    'android-source-settings': (1080, 2400),
    'android-player-settings': (1080, 2400),
    'android-applied-code': (1080, 2400),
    'android-api-callback': (1080, 2400),
    'android-api-operation': (1080, 2400),
    'android-api-state': (1080, 2400),
    'android-api-events': (1080, 2400),
    'android-offline-tracks': (1080, 2400),
    'android-media-session': (1080, 2400),
    'ios-playback-tracks': (1668, 2420),
    'ios-initial-tracks': (1668, 2420),
    'ios-video-scaling': (1668, 2420),
    'ios-applied-code': (1668, 2420),
    'tvos-playback-tracks': (3840, 2160),
    'tvos-initial-tracks': (3840, 2160),
    'tvos-video-scaling': (3840, 2160),
    'tvos-applied-code': (3840, 2160),
    'rn-ios-subtitles': (1206, 2622),
    'rn-ios-caption': (1206, 2622),
    'rn-ios-code': (1206, 2622),
    'rn-android-subtitles': (1080, 2400),
    'rn-android-caption': (1080, 2400),
    'vega-subtitles': (1920, 1080),
    'vega-caption': (1920, 1080),
    'vega-code': (1920, 1080),
}
FIGURE_EXTENSIONS = {
    name: 'png' for name in (
        'vega-api-operation',
        'vega-api-volume',
        'vega-api-callback',
        'rn-ios-api-callback',
        'rn-android-api-operation',
        'rn-ios-api-events',
        'rn-android-cast-startup',
        'ios-offline-track-selection',
        'ios-callback-sdk-status',
        'ios-callback-editor',
        'ios-subtitle-array-sdk-state',
        'ios-subtitle-array-editor',
        'ios-api-volume-state',
        'ios-api-operation',
        'tvos-api-state',
        'ios-cast-options',
        'ios-cast-sdk-state',
        'analytics-dashboard-overview', 'analytics-dashboard-errors', 'analytics-session-errors',
        'android-api-callback',
        'android-api-operation',
        'android-api-state',
        'android-api-events',
        'android-offline-tracks',
        'android-media-session',)
}


def shared_figure_path(name):
    return f'assets/guide/{name}.{FIGURE_EXTENSIONS.get(name, "jpg")}'


COVERAGE_APPS = ('web', 'web-ui', 'ios', 'tvos', 'android', 'react-native', 'vega')
DOCUMENTS = (*CHAPTERS, 'settings', 'controls', 'themes', 'api-coverage')
SLUGS = ('', *DOCUMENTS, *(f'settings/{name}' for name in SETTING_GROUPS),
         *(f'api-coverage/{name}' for name in COVERAGE_APPS))
SOURCE_REVISION = '70580e811bb769dcfc45e623c15f88d5c4a4fd36'
CONTENT_REVIEW = '2026-10-22'
PUBLIC_BASE = 'https://kazuhide.github.io/player-lab/'


def route_file(language, slug=''):
    prefix = 'ja/guide' if language == 'ja' else 'guide'
    return f'{prefix}/{slug + "/" if slug else ""}index.html'


GUIDE_FILES = {
    *(route_file(language, slug) for language in LANGUAGES for slug in SLUGS),
    *(route_file(language, slug) for language in LANGUAGES for slug in LEGACY_ROUTES),
    'guide/search-index.json', 'ja/guide/search-index.json',
}
GUIDE_ASSETS = {
    'guide.css', 'guide.js',
    *(shared_figure_path(name) for name in SHARED_FIGURES),
    *(f'assets/guide/{name}.jpg' for name in THEMES),
    *(f'assets/guide/{name}-{language}.jpg'
      for name in ('overview', 'source-controls', 'config', 'sdk-configuration', 'sdk-callback') for language in LANGUAGES),
}
