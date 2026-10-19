# Player UI compatibility patch

`bitmovin-player-ui@4.23.0.patch` applies to the framework entry point used by
the Web app and bundled shared native UI. It releases auxiliary controls owned
by seek bars, buttons, labels, subtitle overlays, and dynamic settings items.
The manager uses the same weakly tracked traversal to avoid releasing a control
twice when it is also a normal child. Upstream 4.23.0 already calls the base
release method in
[`QuickSeekButton`](https://github.com/bitmovin/bitmovin-player-ui/blob/v4.23.0/src/ts/components/buttons/QuickSeekButton.ts),
so this patch no longer carries the older correction for that call.

Layout exclusions in 4.23.0 also release their removed components. The patch
shares release tracking between that processor, the normal tree, and auxiliary
owners so the same component is released once.

The patch also owns the asynchronous action started by a recommendation click.
Loading a source can cancel a playback request issued before that load finishes.
The action waits for loading, then plays only if the same source object still
belongs to the originating Player. A later recommendation, source change,
unload, pause request or destruction cancels that action. Changing only the UI
preserves playback intent. Temporary SDK listeners and the pause hook are
removed when the action settles or is cancelled; the hook restores the original
method only while it still owns that method. Expected browser cancellations of
retired actions are consumed, while active cancellations and genuine failures
remain observable.

These are version-specific ownership corrections, not a general memory fix.
See [the measurement instructions and results](../docs/web-performance.md) for
the retainer paths and numeric results recorded with 4.15.1 on 2026-10-19, and
their remaining limitations. Those measurements do not validate 4.23.0. Recheck
the upstream implementation and the public browser regression before upgrading
the package.

The [upstream library](https://github.com/bitmovin/bitmovin-player-ui/tree/v4.23.0)
uses the MIT license, reproduced in [LICENSE.bitmovin-player-ui](LICENSE.bitmovin-player-ui).
pnpm records the patch and its hash in the workspace configuration and lockfile.
Use `pnpm patch` and `pnpm patch-commit` to update it.
