# Changelog

Product versions describe Player Lab releases. Bitmovin SDK versions are tracked
separately in the [API coverage guide](https://kazuhide.github.io/player-lab/guide/api-coverage/).

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
