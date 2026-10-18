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

## Provisioned feature assets

The provisioned scenarios require your own hosted outputs from
`encoding/test-streams/`. Export their common base URL in the shell running
Playwright, without a trailing slash:

```bash
export VITE_TEST_STREAM_BASE_URL="https://media.example.test/test-streams"
```

The runner appends the existing `vod-baseline/`, `vod-hevc/`, `vod-sprites/`,
`vod-multiaudio/` and `assets/` paths. This variable is read by the Node.js test
runner; setting it only in `apps/web/.env` does not configure these tests.
Public `REFERENCE` scenarios do not need it. An unset base does not provision
feature assets or skip their tests; configure the base before running them.

For the application's optional sprite, multi-audio and subtitle demos, set the
corresponding `VITE_VOD_*` values listed in `apps/web/.env.example`. Those values
configure the application, separately from the test runner's shared base URL.

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

Public reference sources depend on external servers and can change or become
unavailable. Provisioned checks expect the matching assets, not arbitrary media
with the same extension. A collector request does not establish Analytics
server ingestion or dashboard results. None of these checks establishes audible
synchronization or behavior on physical casting devices.
