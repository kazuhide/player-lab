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

Settings items also release their owned label when a subclass replaces the
normal child list. Recommendation items release the title and duration labels
they create outside that list, and the overlay releases old items before
replacing recommendations. Otherwise language-change subscriptions can retain
the removed elements and their released UI manager.

The manager's source-loaded and source-unloaded subscriptions use its tracked
player wrapper. This lets `UIManager.release()` remove them while the Player
continues running, including repeated theme changes. Browser regressions observe
the real public `on`/`off` calls and verify that removed controls stop receiving
language changes and release exactly once.

The patch also owns the asynchronous action started by a recommendation click.
Loading a source can cancel a playback request issued before that load finishes.
The action waits for loading, then plays only if the same source object still
belongs to the originating Player. A later recommendation, source change,
unload, pause request or destruction cancels that action. Changing only the UI
preserves playback intent. Settling or cancelling an action restores its pause,
load and unload hooks immediately, only while it still owns each method. An
accepted external load or unload retires the captured action even while the
source is null or the exact same source object is reused. The hook forwards the
original receiver, arguments and return value; synchronous rejection preserves
the existing action and rethrows the original error. The recommendation issues
its own initial load through the captured method, bypassing its external hook. Teardown receipts record
the concrete previous source and requested replacement for each recommendation
load. Their lifetime belongs to the Player: they survive cancellation of the
playback intent until the ordered `SourceUnloaded` notification or destruction.
The coordinator's temporary SDK listeners detach when neither an action nor a
teardown receipt remains. This allows a new recommendation after pause to own
its playback intent without inheriting an unrelated future unload.

Queued `Paused` notifications cancel intent only while the current SDK state
is paused. A new load resets that state, so a notification from the previous
source does not cancel the new recommendation. Explicit public pause requests
still cancel immediately through the owned hook, including already-paused media.

Expected browser cancellations and the two SDK 8.280 superseded/destroyed load
cancellation Errors are consumed only for confirmed retired actions. Active
same-message errors and genuine failures remain observable. A source receipt replaced
during pending playback also identifies cancellation before that notification
arrives. Disposal recognizes only the SDK's exported
`PlayerAPINotAvailableError`; local ownership is cleared even when the destroyed
API can no longer unsubscribe. The SDK's `destroy()` contract owns removal of
its remaining event handlers.

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
