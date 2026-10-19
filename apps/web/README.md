# Web player playground

The existing Bitmovin Web Player app includes a source and API control panel,
14 interface themes, PlayerConfig and SourceConfig settings, named Tweaks
settings, theme construction code, playback observations, and a customization
guide at `guide.html`. The English/Japanese switch applies to the interface
and its displayed explanations.

## Run

```sh
pnpm install --frozen-lockfile
pnpm --filter @showcase/web dev
```

Open the printed URL using `localhost` to try the Web Player without a key.
The shared UI builds automatically before the development server starts.

The [root setup guide](../../docs/SETUP.md) explains optional licenses and the
server-side Analytics query API. `apps/web/.env` is only needed for Web-specific
`VITE_*` overrides; see [.env.example](.env.example). Public VOD and live streams
are defaults. Sprite, multi-audio, and sideloaded-subtitle demos need the feature
stream URLs you configure there.

## Pages version

The Pages build targets the [Web app](https://kazuhide.github.io/player-lab/web/)
and keeps the existing controls, 14 themes and customization guide. Playback on
that host requires a Player license allowing the hostname. Both the public
Player license and configured Analytics license must allow `kazuhide.github.io`.
These client keys are delivered to the browser. The keyless `localhost` exception
applies only to the Web SDK on that exact hostname. Account API keys must stay
out of the browser.

The build packages a 60-second *Big Buck Bunny* excerpt as HLS and DASH, with
two-second video segments and thumbnail previews. Both audio tracks use the
same nonverbal soundtrack at different volumes; their
language labels are test metadata. The separate *Sintel* subtitle sample tests
cue timing and rendering, not a translation of *Big Buck Bunny*. See the
[media attribution](https://kazuhide.github.io/player-lab/web/media/ATTRIBUTION.txt)
and [timing explanation](../../docs/local-test-media.md#why-audio-segment-times-differ-from-video).

Local playback measurements, including startup time and the number of buffering
interruptions, work in the browser. When an Analytics license is configured, the
collector sends playback events and measurements to Bitmovin. Use a separate
license for the public demo to keep its data separate from local testing; see
[Analytics setup](https://developer.bitmovin.com/playback/docs/setup-analytics).
The account aggregation query panel is hidden on Pages. These queries require
a backend that keeps the account API key server-side; Pages does not run the
development proxy.

The project code uses MIT. The hosted Bitmovin Player SDK remains proprietary;
its [notice](https://kazuhide.github.io/player-lab/web/notices/BITMOVIN-PLAYER-NOTICE.txt)
describes the separate terms.

## Try the controls

Select a theme to inspect its actual UI and construction code. The configuration
panels distinguish settings that recreate the player, reload the source, or
apply immediately. Unapplied changes do not prove that the SDK accepted them.

Source edits retain other applied source settings. Selecting a preset, including
that same preset from a recommendation, clears earlier source overrides.
The SDK's `SourceLoaded` notification can arrive after the asynchronous `load()`
call completes. The app settles source state on that notification so live and
on-demand labels follow the active source and later edits cannot restore old
overrides. Notifications from an old player and cancellations of older loads
cannot settle a newer source change.

For live media, seek within the rewind window or jump to the live edge. The DVR
state panel reports the current window and offset. Buffer targets control
media downloaded ahead; they do not make the rewind window longer. See
[DVR time and start settings](../../docs/dvr-time-and-start-config.md).

During local development, the Analytics collector is optional. Its license is a
client setting; the Analytics query API secret stays in the development server
and must not be entered into client configuration.

## Build and test

```sh
pnpm --filter @showcase/web build
pnpm --filter @showcase/web test
```

The build checks types and bundles both HTML pages. Unit tests cover the DVR
logic, metrics, client-license handling, and Analytics proxy. Browser checks
are separate; see [testing](../../docs/e2e-testing.md).

To reproduce the Pages artifact with the generated fixture:

```sh
python3 encoding/test-streams/local.py --output .cache/pages-media
bash scripts/build-pages.sh .cache/pages-media .cache/pages-site .cache/pages-manifest.json
E2E_PAGES_DIR="$PWD/.cache/pages-site" pnpm --filter @showcase/e2e e2e:pages
```

Run these commands from the repository root. Use new output paths; the packager
refuses to overwrite existing output. The production build ignores dotenv files,
keeps only approved public files, and writes its manifest outside the site.
See [Pages configuration](../../docs/SETUP.md#pages-version) for the public licenses.
