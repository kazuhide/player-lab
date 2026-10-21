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
    'analytics-dashboard-overview': (2864, 1270),
    'analytics-dashboard-errors': (1324, 501),
    'analytics-session-errors': (804, 188),
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
        'analytics-dashboard-overview', 'analytics-dashboard-errors', 'analytics-session-errors')
}


def shared_figure_path(name):
    return f'assets/guide/{name}.{FIGURE_EXTENSIONS.get(name, "jpg")}'


COVERAGE_APPS = ('web', 'web-ui', 'ios', 'tvos', 'android', 'react-native', 'vega')
DOCUMENTS = (*CHAPTERS, 'settings', 'controls', 'themes', 'api-coverage')
SLUGS = ('', *DOCUMENTS, *(f'settings/{name}' for name in SETTING_GROUPS),
         *(f'api-coverage/{name}' for name in COVERAGE_APPS))
SOURCE_REVISION = '11b7ccac88b126c07fc3984b63af45fe36219c67'
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
