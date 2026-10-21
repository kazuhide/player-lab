# Player Lab

[Open the Web app](https://kazuhide.github.io/player-lab/web/)
· User guide: [English](https://kazuhide.github.io/player-lab/guide/) / [日本語](https://kazuhide.github.io/player-lab/ja/guide/)

Try Bitmovin Player settings, playback APIs and user interfaces on Web,
iOS/tvOS, Android/Fire TV, React Native and Vega OS. Change settings in the GUI,
apply them, and inspect the configuration code used by the app.

## Try the player

- **Settings:** choose a source, edit source and player options, and apply the
  changes. Check whether the field applies immediately, reloads the source or
  recreates the player.
  See the [settings reference](https://kazuhide.github.io/player-lab/guide/settings/).
- **Playback APIs:** try play/pause, seeking, live rewind, audio and subtitle
  selection, and the controls available in each interface. Check the
  [control reference](https://kazuhide.github.io/player-lab/guide/controls/) and
  [API coverage](https://kazuhide.github.io/player-lab/guide/api-coverage/)
  for each platform's implemented routes.
- **UI and code:** switch interfaces, compare their controls, and read the
  selected Web theme's construction example. Open the applied-code view for
  applied settings with license placeholders; draft edits are excluded.
  The [UI customization guide](https://kazuhide.github.io/player-lab/guide/web-ui-customization/)
  explains how to adapt the examples.

The public Web app supports English and Japanese and includes public demo media
for audio, subtitles and sprite previews. Public reference streams can change.
Some local examples need media URLs or credentials that you supply. See the
[Pages scope](apps/web/README.md#pages-version) and
[recorded test results](https://kazuhide.github.io/player-lab/guide/test-results/).

## Run locally

Use Node.js 24.19.0 and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm --filter @showcase/web dev
```

Open the printed URL using `localhost`. The Web Player can run there without a
Player key. Other hosts and native apps need an allowed Player license. Follow
[Setup](docs/SETUP.md) for keys and optional media, and the
[Web instructions](apps/web/README.md) for available controls. Account API secrets
belong on the server and must not be entered into client settings.

## Native apps and shared UI

| App | What to try |
| --- | --- |
| [iOS/tvOS](apps/ios) | Source/playback settings, initial tracks, video scaling and applied code |
| [Android/Fire TV](apps/android) | Source/player settings, language priority, external WebVTT, HTTP retries and applied code |
| [React Native](apps/react-native) | Settings, external subtitles and applied code in an external Expo development build |
| [Vega OS](apps/vega) | Settings, external subtitles and applied code in the included Kepler host |
| [Shared UI](packages/ui-shared) | Custom components, themes and UI factories |

Each app keeps its native toolchain and exposes its own set of controls.
iPhone/iPad, Android and React Native can use the shared Web UI; tvOS and Vega
use native interfaces. Start with the
[native app guide](https://kazuhide.github.io/player-lab/guide/native-overview/)
for setup and platform limits. Build and unit-test success are separate from
actual playback on a simulator, emulator or physical device.

## Development checks

```sh
pnpm typecheck
pnpm test
pnpm build
bash scripts/test-env-lib.sh
```

See [testing instructions](docs/e2e-testing.md) and
[contribution checks](docs/contributing.md) for the relevant browser and native
checks. Optional [encoding tools](encoding) can create media in your account and
incur charges; they are not required to try the public Web app.

## Analytics and Observability

After trying the player, review collected playback data in Bitmovin Dashboard.
The Analytics collector sends playback events from the player; local QoE readouts
describe the current app session. The
[Analytics guide](https://kazuhide.github.io/player-lab/guide/web-qoe-analytics/)
explains Dashboard views, collected metrics, API queries, external visualization
and analysis with a language model.

Pages can send playback data through its configured Analytics collector.
Account aggregate queries require a local server and stay hidden on Pages.

## Licenses

Project code is provided under [MIT](LICENSE). Dependencies retain their own
licenses. The hosted Bitmovin Player SDK is proprietary; the project's MIT
license does not cover it. See the
[SDK notice](https://kazuhide.github.io/player-lab/web/notices/BITMOVIN-PLAYER-NOTICE.txt).
SDK binaries and generated media are not tracked in this Git repository.
Dashboard screenshots in the guide are reproduced from Bitmovin's public
documentation and articles. They remain © Bitmovin and are not covered by the
project's MIT license; source links accompany the examples.
The [subtitle asset notes](encoding/test-streams/assets/README.md) describe its
attribution and timestamp changes.
