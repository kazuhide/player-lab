# Player Lab

[Project overview and getting started](https://kazuhide.github.io/player-lab/)
· [Web app](https://kazuhide.github.io/player-lab/web/)

A Bitmovin Player playground for Web, iOS/tvOS, Android/Fire TV, React Native,
and Vega OS. Try player and source settings, switch between the standard and
custom player interfaces, and inspect the code that builds each Web interface.

The Web app includes 14 themes, configuration panels, player API controls,
UI construction examples, an English/Japanese language switch, and a separate
customization guide. Existing examples also cover live rewind, multi-audio,
subtitles, sprite previews, and playback measurements. Some examples need media
or credentials that you supply when running locally. The Pages build includes
public test media; see the [Web guide](apps/web/README.md#pages-version) for its
contents and Pages limitations.
When configured, the Analytics collector sends playback data to Bitmovin.
Account aggregation queries remain disabled on Pages.

## Run the Web app

Use Node.js 24.19.0 and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm --filter @showcase/web dev
```

Open the printed URL with the hostname `localhost`. The Web Player can run
there without a player key. Other hosts and native apps need your own Player
license. To configure keys or optional feature streams, follow
[Setup](docs/SETUP.md). Never put an account API secret into a client setting.

Use the theme selector and configuration panels beside the player. The
construction panel shows the selected theme's code; the separate guide explains
how to customize it. See the [Web instructions](apps/web/README.md).

## Apps and tools

| Path | Contents |
| --- | --- |
| [Web](apps/web) | Player playground, settings, UI examples, and guide |
| [iOS/tvOS](apps/ios) | Swift app and its DVR logic tests |
| [Android/Fire TV](apps/android) | Kotlin app, DVR tests, and offline download example |
| [React Native](apps/react-native) | Screen and controls for an Expo development build |
| [Vega OS](apps/vega) | Modular player integration; requires the Vega toolchain |
| [Shared UI](packages/ui-shared) | Custom player components, themes, and UI factories |
| [Encoding](encoding) | Optional scripts to create your own test streams |
| `tests/e2e` | Browser tests that drive the existing Web app and player |

Native apps keep their own toolchains and DVR implementations. iPhone/iPad,
Android, and React Native can use the shared Web UI; tvOS and Vega use native
interfaces. Type checks and compilation do not establish playback on a device.

## Live rewind

DVR means a live stream's rewind window. In the player API, the live edge is
`0` and positions behind it are negative. Each app clamps requested positions
to the current window. Increasing the downloaded buffer does not extend that
window: the live manifest determines how far back the viewer can seek.

Read [DVR time and start settings](docs/dvr-time-and-start-config.md),
[live-to-VOD transitions and measurements](docs/live-to-vod-and-analytics.md),
and the [feature guide](docs/bitmovin-feature-coverage.md).

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
bash scripts/test-env-lib.sh
```

[Testing instructions](docs/e2e-testing.md) distinguish unit tests, browser
playback, native builds, and device checks. Public reference streams can change
or become unavailable. Local sprite and multi-audio examples need configured
media URLs; the Pages build includes a public 60-second fixture.

[Web memory and processor measurements](docs/web-performance.md) cover repeated
theme changes and player release, with reproduction steps and measurement limits.

Encoding scripts create resources in your account and can incur charges.
They are optional for trying the Web app with public reference streams.

Before publishing changes, follow [the contribution checks](docs/contributing.md)
for local secret checks and the existing browser subset.

## Licenses

Project code is provided under [MIT](LICENSE). Dependencies retain their own
licenses. The hosted Bitmovin Player SDK is proprietary; the project's MIT
license does not cover it. See the
[SDK notice](https://kazuhide.github.io/player-lab/web/notices/BITMOVIN-PLAYER-NOTICE.txt).
SDK binaries and generated media are not tracked in this Git repository.
The [subtitle asset notes](encoding/test-streams/assets/README.md) describe its
attribution and timestamp changes.
