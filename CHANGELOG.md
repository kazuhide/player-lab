# Changelog

Product versions describe Player Lab releases. Bitmovin SDK versions are tracked
separately in the [API coverage guide](https://kazuhide.github.io/player-lab/guide/api-coverage/).

## 0.1.5

- Give Android, Apple and React Native apps direct setting selection, fixed Apply
  and Reset actions, and separate Settings, APIs, Code and More workspaces.
  Preserve drafts and the player across navigation and layout changes.
- Improve large-text layouts, software-keyboard editing and TV remote focus,
  including returning from tvOS editors with Back/Menu. Keep React Native
  editors reachable after input or handler-factory errors.
- Add English and Japanese native interface labels while preserving SDK
  identifiers, source values, returned data and generated code.
- Preserve Web setting drafts across search, selection and language changes.
  Wait for SDK Apply results, retain failed drafts for correction, and compare
  edits with the last successful Apply.
- Show Before and After configuration comparisons on Web and React Native.
  Mask sensitive comparison fields and generated configuration values, and
  correct enum serialization in copied Web code.
- Improve API search on Web, React Native and Vega with exact API-path and method
  matches first. Make every Vega match reachable through result pages.
- Add standalone integration examples checked against the pinned SDKs, with
  platform setup and host-entry instructions in the English and Japanese guides.
- Add collapsible guide navigation, simplify repeated instructions, and refresh
  English and Japanese guides with captures of the matching app language.
- Replace the unavailable public Live HLS sample. Keep initial Apple audio and
  subtitle preferences when changing themes or reloading a source.
- Harden SDK update checks, retain sanitized browser failure diagnostics, and
  add a managed local preview workflow.
- Rename the Android shared module from `:dvr` to `:playback` and the Apple Swift
  package/module from `DvrKit` to `PlaybackCore`. Refresh generated projects and
  native hosts using the platform READMEs. Bitmovin SDK version pins are unchanged.

See the [release notes](docs/releases/0.1.5.md) for source checkout updates.

## 0.1.4

- Clarify Japanese descriptions of settings, UI customization, playback and
  Analytics / Observability in the guides and project home page.
- Preserve guide structure, examples, captures, API identifiers and feature
  prerequisites. Player behavior and SDK versions are unchanged.

See the [release notes](docs/releases/0.1.4.md).

## 0.1.3

- Split each platform's implementation guide into pages for integration,
  configuration, UI customization, playback features, FAQ, and Analytics /
  Observability. Keep Screen and controls and Implementation guide as the
  unnumbered entry points.
- Add platform-specific subheadings and introductions, with links between
  implementation details, app operations, and source examples.
- Keep published section bookmarks usable and send guide search results
  directly to the relevant implementation page.

See the [release notes](docs/releases/0.1.3.md).

## 0.1.2

- Organize the guide into Web, Apple, Android, React Native and Vega OS sections.
  Give each platform unnumbered Screen and controls and Implementation guide chapters.
- Explain operation workflows with screen captures beside the relevant steps,
  including Web UI settings and applied configuration code.
- Explain configuration, UI customization, useful features and common problems
  in each platform's implementation guide, with examples from the existing app.
- Include reusable Web configuration and UI examples, add local contents links, and keep
  published chapter bookmarks working after the platform split.

See the [release notes](docs/releases/0.1.2.md).

## 0.1.1

- Add an English and Japanese implementation guide that follows the existing
  Web and native code, with Analytics / Observability as its final section.
- Link code excerpts to public source and check their contents and translation
  parity automatically.
- Correct the native overview's offline and platform integration descriptions.

See the [release notes](docs/releases/0.1.1.md). Player behavior and SDK versions
are unchanged.

## 0.1.0

- Try Bitmovin Player configuration, playback controls, UI examples and SDK
  inspection on Web and the included native apps.
- Read applied configuration code and compare the implemented API routes in
  the English and Japanese user guide.
- Identify published Web and guide builds by product version and source commit.
- Publish GitHub Pages from an immutable release, using the validated CI build
  without rebuilding it. Keep the build and its verification files in the release.

See the [release notes](docs/releases/0.1.0.md) for scope and setup requirements,
and the [release instructions](docs/releases.md) for versioning and publication.
