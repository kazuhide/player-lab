# Player UI lifecycle patch

`bitmovin-player-ui@4.15.1.patch` applies to the framework entry point used by
the Web app and bundled shared native UI. It releases auxiliary controls owned
by seek bars, buttons, labels, subtitle overlays, and dynamic settings items.
The manager uses the same weakly tracked traversal to avoid releasing a control
twice when it is also a normal child. The patch also restores the missing base
release call in `QuickSeekButton`.

This is a version-specific ownership correction, not a general memory fix.
See [the measurement instructions and results](../docs/web-performance.md) for
the observed retainer paths and remaining limitations. Recheck the upstream
implementation and the public browser regression before upgrading the package.

The [upstream library](https://github.com/bitmovin/bitmovin-player-ui/tree/v4.15.1)
uses the MIT license, reproduced in [LICENSE.bitmovin-player-ui](LICENSE.bitmovin-player-ui).
pnpm records the patch and its hash in the workspace configuration and lockfile.
Use `pnpm patch` and `pnpm patch-commit` to update it.
