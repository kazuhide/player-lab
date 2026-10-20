# Browser checks

These end-to-end tests run the actual Bitmovin Web player in a browser. Most
use a small player harness; `app-ui.spec.ts` drives the application's user
interface (UI). HLS (HTTP Live Streaming) and DASH (Dynamic Adaptive Streaming
over HTTP) describe media delivered in segments.

## Run

From the repository root, after installing the workspace dependencies:

```bash
pnpm --filter @showcase/e2e e2e specs/vod-baseline.spec.ts --retries=0
```

This selects the public-reference on-demand tests and does not require an
`.env` file. The tests use installed Google Chrome; no Playwright browser
download is needed. Their default page hostname is `localhost`, where Bitmovin
Web does not require a player key. For another hostname, supply a player key
for that origin through the shell variable `BITMOVIN_PLAYER_LICENSE_KEY`.
The test configuration passes it to the browser; do not use a server-side account key.

To run another file, replace `specs/vod-baseline.spec.ts` with its path from
the table below. Configure the required media before running provisioned
scenarios. Once all required assets are available, run the complete suite with:

```bash
pnpm --filter @showcase/e2e e2e --retries=0
```

Type-check the test project without starting a browser:

```bash
pnpm --filter @showcase/e2e typecheck
```

## Firefox, WebKit and Safari

Build the public Pages application with the local 60-second fixture, then run
the same production-file, playback, theme, setting and guide checks in Firefox
and WebKit. The additional cases exercise applied-code copying, native HLS
subtitles and controlled HLS/DASH live rewind through the original GUI.

```bash
pnpm --filter @showcase/e2e exec playwright install --with-deps firefox webkit
python3 encoding/test-streams/local.py
bash scripts/build-pages.sh .cache/test-streams .cache/browser-pages/site .cache/browser-pages/manifest.json
E2E_PAGES_DIR="$PWD/.cache/browser-pages/site" pnpm --filter @showcase/e2e e2e:cross-browser
```

Use `--project firefox` or `--project webkit` for one engine, or `E2E_HEADED=1`
for a visible local run. Ports default to 5214 for Pages and 5350 for controlled
live media; override `E2E_PAGES_PORT` and `E2E_CROSS_BROWSER_LIVE_PORT` to avoid
other running services. The runner stops its own servers and fails on missing
media, unsupported playback or an assertion failure. Tests do not mock player
methods or clipboard writes; the collector is intercepted to avoid recording
test sessions in an account. Browser installation requires Internet access;
the generated media tests use local media.

The Firefox project disables its browser-owned Picture-in-Picture hover button:
that overlay can intercept clicks over the application's settings menu. The
application's own Picture-in-Picture control remains available. Menu results
therefore describe this explicit browser preference, rather than every personal
Firefox profile.

On macOS 27, Firefox 157 can fail before a test starts when its shared app-data
directory is protected by the operating system. The upstream report describes
[the separate app-data lookup](https://github.com/microsoft/playwright/issues/42768).
Run with a new, dedicated `CFFIXED_USER_HOME` directory in the shell environment
to isolate test app data. Keep it separate from a personal browser profile and
remove it after testing. This workaround does not grant Full Disk Access or
disable the browser sandbox. Linux CI uses the normal browser launcher.

Playwright's WebKit build is not the installed Safari application, as explained
in [the Playwright browser documentation](https://playwright.dev/docs/browsers).
For a Safari release check, serve the same Pages artifact with
`python3 tests/e2e/serve-pages.py --directory .cache/browser-pages/site --port 5214`
and open `http://localhost:5214/player-lab/web/` in Safari. Check HLS and DASH
movie/time progression, source and player Apply, a theme swap and its construction
code, code copying, native HLS audio/subtitle selection, live rewind/return, and
return to finite VOD. Record the Safari/OS versions separately from WebKit.
Remote Automation is not required for this manual path.

## Provisioned feature assets

To test the existing feature presets locally without cloud resources, follow
[local test media](../../docs/local-test-media.md):

```bash
python3 encoding/test-streams/local.py
E2E_MEDIA_DIR=.cache/test-streams pnpm --filter @showcase/e2e e2e:features
```

The generator provides the same fixture paths used by the feature tests. The
runner configures the optional application presets and starts/stops its local
media server. It does not generate an HEVC fixture or replace cloud Encoding
API verification.

The provisioned scenarios require your own hosted outputs from
`encoding/test-streams/`. Export their common base URL in the shell running
Playwright, without a trailing slash:

```bash
export VITE_TEST_STREAM_BASE_URL="https://media.example.test/test-streams"
```

The runner appends the existing `vod-baseline/`, `vod-hevc/`, `vod-sprites/`,
`vod-multiaudio/` and `assets/` paths. This variable is read by the Node.js test
runner; setting it only in `apps/web/.env` does not configure these tests.
Public `REFERENCE` scenarios do not need it. Provisioned suites fail in their
setup hook with an explicit configuration message when the base is missing or
invalid, before opening a player. They are not reported as passing or silently
replaced with public reference media; configure the base before running them.

For the application's optional sprite, multi-audio and subtitle demos, set the
corresponding `VITE_VOD_*` values listed in `apps/web/.env.example`. Those values
configure the application, separately from the test runner's shared base URL.
The seven application presets remain visible. Demos with missing required URLs
are disabled with the exact variable names shown next to the source controls.
The episode playlist and recommendation tiles only offer configured sources.

## Existing scenarios

Each file is under `tests/e2e/specs/`. This table describes its assertions and
configuration, not a claim that it passed in your environment.

| Spec | What it checks | Required configuration |
| --- | --- | --- |
| `vod-baseline.spec.ts` | Public HLS and DASH load as finite on-demand media; seek reaches the requested region. | Access to the public reference streams. |
| `provisioned-vod.spec.ts` | Finite on-demand duration, no live rewind window, and seeking within the clip. | `VITE_TEST_STREAM_BASE_URL`; `vod-baseline` outputs. |
| `provisioned-hevc.spec.ts` | The loaded H.265 source reports an `hvc1` or `hev1` codec. | `VITE_TEST_STREAM_BASE_URL`; `vod-hevc` outputs and browser codec support. |
| `sprites.spec.ts` | Thumbnail tile coordinates and dimensions, plus an image response from the resolved sprite sheet. | `VITE_TEST_STREAM_BASE_URL`; `vod-sprites` playlist, WebVTT index and sprite sheet. |
| `subtitles.spec.ts` | One English subtitle track can be enabled and supplies the expected cue text. | `VITE_TEST_STREAM_BASE_URL`; baseline playlist and the expected English WebVTT asset. |
| `multiaudio.spec.ts` | English and German tracks, the English default, and an audio-selection change event with the selected track ID. | `VITE_TEST_STREAM_BASE_URL`; `vod-multiaudio` outputs. |
| `network-api.spec.ts` | The player's request callback observes manifest and media requests. | `VITE_TEST_STREAM_BASE_URL`; baseline playlist and segments. |
| `live-dvr.spec.ts` | Live state, a rewind window, seeking behind live, and returning near the live edge. | Access to the default public live source, or `E2E_LIVE_DASH_URL` pointing to a compatible live stream. |
| `live-analytics.spec.ts` | Advancing live playback and an outgoing Analytics collector request. | Both `E2E_ANALYTICS_LIVE_DASH_URL` and `E2E_ANALYTICS_LICENSE_KEY`; otherwise this opt-in file is skipped. |
| `app-ui.spec.ts` | Theme composition, guide and construction code, language switching, UI settings, controls, player state, and live-to-on-demand UI changes. | Access to the application's public reference streams; optional feature assets use the application's `VITE_VOD_*` settings. |
| `app-features.spec.ts` | The original application's audio/subtitle settings menus and visible sprite preview. | Local feature runner and its generated media. |

Public reference sources depend on external servers and can change or become
unavailable. Provisioned checks expect the matching assets, not arbitrary media
with the same extension. A collector request does not establish Analytics
server ingestion or dashboard results. None of these checks establishes audible
synchronization or behavior on physical casting devices.
