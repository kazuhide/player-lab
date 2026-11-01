"""Explicit public routes and assets for the bilingual user guide."""

CHAPTERS = {
    'start': 'start', 'local-setup': 'start', 'native-overview': 'start',
    'web-screen-controls': 'web', 'web-implementation': 'web',
    'web-player-config': 'web', 'web-ui-customization': 'web',
    'web-startup-comparison': 'web', 'web-startup-integration': 'web',
    'native-apple': 'apple', 'apple-implementation': 'apple',
    'native-android': 'android', 'android-implementation': 'android',
    'native-react-native': 'react-native', 'react-native-implementation': 'react-native',
    'native-vega': 'vega', 'vega-implementation': 'vega',
    'web-live-dvr': 'reference',
    'troubleshooting': 'reference', 'audio-timing': 'reference',
    'test-results': 'reference', 'glossary': 'reference',
    'web-qoe-analytics': 'analytics', 'analytics-metrics': 'analytics',
    'analytics-visualization': 'analytics', 'analytics-queries': 'analytics',
    'analytics-ai': 'analytics',
    # Retain published bookmarks without keeping combined platform chapters in the contents.
    'implementation': None, 'native-integrations': None,
    'web-screen-themes': None, 'web-sources-tracks': None, 'web-ui-settings': None,
}
CATEGORIES = ('start', 'web', 'apple', 'android', 'react-native', 'vega', 'reference', 'analytics')
IMPLEMENTATION_GUIDES = (
    'web-implementation', 'apple-implementation', 'android-implementation',
    'react-native-implementation', 'vega-implementation',
)
IMPLEMENTATION_SECTIONS = {
    'integration': 'integration_guide',
    'player-source-config': 'configuration_guide',
    'ui-customization': 'ui_customization_guide',
    'useful-features': 'features_guide',
    'faq': 'faq',
    'analytics-observability': 'analytics',
}
IMPLEMENTATION_PAGES = {
    f'{guide}/{section}': guide
    for guide in IMPLEMENTATION_GUIDES for section in IMPLEMENTATION_SECTIONS
}
OPERATION_GUIDES = ('web-screen-controls', 'native-apple', 'native-android',
                    'native-react-native', 'native-vega')
CHILD_CHAPTERS = frozenset(('web-player-config', 'web-ui-customization',
                            'web-startup-comparison', 'web-startup-integration'))
CHAPTER_PARENTS = {
    **IMPLEMENTATION_PAGES,
    'web-player-config': 'web-implementation', 'web-ui-customization': 'web-implementation',
    'web-startup-comparison': 'web-screen-controls', 'web-startup-integration': 'web-implementation',
    'web-screen-themes': 'web-screen-controls', 'web-sources-tracks': 'web-screen-controls',
    'web-ui-settings': 'web-screen-controls',
}
CHAPTER_ORDER = tuple(page for key, category in CHAPTERS.items()
                      if category is not None and key not in CHILD_CHAPTERS
                      for page in (key, *(f'{key}/{section}' for section in IMPLEMENTATION_SECTIONS
                                         if key in IMPLEMENTATION_GUIDES)))

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
NATIVE_FIGURES = {
    'vega-api-operation': (1920, 1080),
    'vega-api-search': (1920, 1080),
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
    'tvos-api-state': (1920, 1080),
    'ios-cast-options': (1206, 2622),
    'ios-cast-sdk-state': (1206, 2622),
    'android-source-settings': (1080, 2400),
    'android-player-settings': (1080, 2400),
    'android-applied-code': (1080, 2400),
    'android-api-callback': (1080, 2400),
    'android-api-operation': (1080, 2400),
    'android-api-state': (1080, 2400),
    'android-api-events': (1080, 2400),
    'android-offline-tracks': (1080, 2400),
    'android-media-session': (1080, 2400),
    'android-tv-workspace': (1920, 1080),
    'android-tv-api': (1920, 1080),
    'ios-playback-tracks': (1206, 2622),
    'ios-initial-tracks': (1640, 2360),
    'ios-video-scaling': (1640, 2360),
    'ios-applied-code': (1206, 2622),
    'tvos-playback-tracks': (1920, 1080),
    'tvos-initial-tracks': (1920, 1080),
    'tvos-video-scaling': (1920, 1080),
    'tvos-applied-code': (1920, 1080),
    'rn-ios-subtitles': (1206, 2622),
    'rn-ios-configuration-differences': (1134, 472),
    'rn-ios-caption': (1206, 2622),
    'rn-ios-code': (1206, 2622),
    'rn-android-subtitles': (1080, 2400),
    'rn-android-configuration-differences': (1080, 2400),
    'rn-android-caption': (1080, 2400),
    'vega-subtitles': (1920, 1080),
    'vega-caption': (1920, 1080),
    'vega-code': (1920, 1080),
}
NATIVE_CAPTURE_PROFILES = {
    (1206, 2622): 'ios-phone',
    (1134, 472): 'ios-detail',
    (1080, 2400): 'android-phone',
    (1640, 2360): 'ipad',
    (1920, 1080): 'tv',
}
SHARED_FIGURES = {
    # The external Dashboard provides these screens in English.
    'analytics-dashboard-overview': (2864, 1270),
    'analytics-dashboard-errors': (1324, 501),
    'analytics-session-errors': (804, 188),
}
LOCALIZED_FIGURES = {
    **{name: {language: size for language in LANGUAGES} for name, size in NATIVE_FIGURES.items()},
    **{name: {language: (761, 429) for language in LANGUAGES} for name in THEMES},
    'overview': {'en': (1650, 1425), 'ja': (1650, 1425)},
    'source-controls': {'en': (301, 193), 'ja': (301, 197)},
    'config': {'en': (1210, 147), 'ja': (1210, 155)},
    'sdk-configuration': {'en': (1240, 1402), 'ja': (1240, 1402)},
    'web-sdk-differences': {'en': (928, 636), 'ja': (928, 637)},
    'sdk-callback': {'en': (1240, 1527), 'ja': (1240, 1529)},
    'ui-controls': {'en': (301, 546), 'ja': (301, 656)},
    'applied-settings': {'en': (1240, 511), 'ja': (1240, 512)},
    'web-startup-controls': {'en': (1240, 418), 'ja': (1240, 423)},
    'web-startup-results': {'en': (1240, 634), 'ja': (1240, 663)},
}
FIGURE_EXTENSIONS = {name: 'png' for name in (*NATIVE_FIGURES, *SHARED_FIGURES)}
FIGURE_EXTENSIONS.update({name: 'png' for name in ('web-sdk-differences', 'web-startup-controls', 'web-startup-results')})


def figure_capture_profile(name):
    """Match native captures to the measured crop and display rules in guide.css."""
    if name not in NATIVE_FIGURES:
        return None
    profile = NATIVE_CAPTURE_PROFILES[NATIVE_FIGURES[name]]
    # tvOS and Vega use smaller source text than the Android TV screenshots.
    return 'tv-dense' if profile == 'tv' and name.startswith(('tvos-', 'vega-')) else profile


def figure_path(name, language):
    if language not in LANGUAGES:
        raise ValueError('The guide image language is not supported.')
    extension = FIGURE_EXTENSIONS.get(name, 'jpg')
    if name in LOCALIZED_FIGURES:
        return f'assets/guide/{name}-{language}.{extension}'
    if name in SHARED_FIGURES:
        return f'assets/guide/{name}.{extension}'
    raise ValueError('The guide contains an unknown figure.')


COVERAGE_APPS = ('web', 'web-ui', 'ios', 'tvos', 'android', 'react-native', 'vega')
DOCUMENTS = (*CHAPTERS, 'settings', 'controls', 'themes', 'api-coverage')
SLUGS = ('', *DOCUMENTS, *IMPLEMENTATION_PAGES, *(f'settings/{name}' for name in SETTING_GROUPS),
         *(f'api-coverage/{name}' for name in COVERAGE_APPS))
SOURCE_REVISION = '92feedae389f3ed59ef76587f2e143bbd55d04b0'
CONTENT_REVIEW = '2026-10-26'
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
    *(figure_path(name, 'en') for name in SHARED_FIGURES),
    *(figure_path(name, language) for name in LOCALIZED_FIGURES for language in LANGUAGES),
}
