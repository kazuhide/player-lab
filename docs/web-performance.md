# Measuring Web playback and UI changes

The lifecycle measurement runs the existing Web app with the local 60-second
Big Buck Bunny HLS and DASH fixtures. It plays video, switches all available themes
three times, changes the seek-preview setting, switches between HLS and DASH,
applies source settings three times, recreates the player through Player
settings and the DVR control three times each, and releases the UI and player. It checks that only one player and media element are active at each
settled step and that disposal stops the app's metrics timer.

## Run a measurement

Install the workspace dependencies and the Chromium version matched to the
locked Playwright package:

```sh
pnpm install --frozen-lockfile
pnpm --filter @showcase/e2e exec playwright install chromium
python3 encoding/test-streams/local.py
```

The media generator needs FFmpeg, ffprobe, and curl. Follow the
[test-media instructions](../encoding/test-streams/README.md) for its source,
license, output, and regeneration details. Generation is finished before
measurement starts; encoding while measuring would distort the result.

In a separate terminal, serve only the generated media directory:

```sh
pnpm --filter @showcase/e2e exec vite ../../.cache/test-streams \
  --config vite.media.config.ts --port 5180 --strictPort
```

Then close other benchmark, build, browser-test, and emulator workloads and run:

```sh
pnpm --filter @showcase/e2e e2e:performance
```

The measurement starts its own app on `http://localhost:5184`. Both ports must
be free before their servers start. Localhost playback uses no Player key;
Analytics collection and account requests are disabled. This command is separate
from the normal browser suite so concurrent CI jobs do not become misleading
performance comparisons.

One complete warm-up run is excluded. Three fresh browser contexts then run
serially at a 1440 × 900 viewport with headless Chromium. The app uses Vite's
development server; this is a development-workflow baseline rather than a
production-page score. Adaptive quality stays enabled, and each sample records
the selected video dimensions. There is no CPU/network throttling or forced
garbage collection. `PERF_RUNS=5` changes the measured sample count (1–10).

The JSON report is saved under `tests/e2e/test-results/` as
`lifecycle-performance.json` and attached to the Playwright result. It contains
the individual samples, medians, ranges, browser/Node versions, CPU model, and
memory capacity. Source hashes and hashes of the shared UI and dependency
responses identify the code actually served. The report omits account details,
request URLs, and local file paths.
`PERF_HLS_URL` and `PERF_DASH_URL` can select another locally served copy of the
same fixtures; URLs with credentials or query parameters are rejected.

## Read the counters correctly

Processor (CPU) counters come from the browser's Chrome DevTools Protocol. `ThreadTime`
measures renderer main-thread CPU time; `ProcessTime` measures CPU time across
the renderer process. They exclude separate browser and GPU processes.
`TaskDuration` uses elapsed time spent in renderer tasks and can include time
when the operating system interrupted that thread. It is useful for comparing
work, but it is not interchangeable with CPU time. The report subtracts the
settled starting sample when summarizing each phase.

The heap contains JavaScript-managed objects. MiB means 1,048,576 bytes.
Its size is not total player memory: decoded frames, media buffers,
native allocations, and GPU textures are outside that counter. DOM object and
listener counts describe the browser's page objects and their event handlers;
they can include detached objects awaiting the browser's garbage
collector. A higher endpoint alone does not prove a leak. Compare repeated
runs, the connected element count, and lifecycle ownership together before
changing code. The harness also counts outstanding requests and registered
intervals, without collecting their URLs or replacing timer callbacks.

The app response is instrumented only inside the test. It exposes the current
SDK instance and reuses the app's existing teardown block; the public app has
no benchmark/debug API. Instrumentation, browser automation, and the development
server add overhead, so compare results using the same command and conditions.
The correctness assertions are enforced; there is no arbitrary CPU or heap
pass/fail threshold.

For a separate retention investigation, `PERF_DIAGNOSTIC_GC=1` explicitly asks
the browser to collect garbage after each measured run's final sample. Those
results are stored separately in `collectionDiagnostics`; they do not represent
normal playback memory usage or establish a CPU improvement.

## Recorded result: 2026-10-21

Both conditions ran Player 8.281.0 and UI 4.23.0 on an Apple M5 with ten logical
processors, 32 GiB RAM, Darwin 27.0.0, Node 24.19.0, pnpm 10.33.0 and Chrome
155.0.8059.85. Each condition excluded one complete warm-up, then measured three
fresh contexts serially with zero retries. No builds or emulators ran during
the measured workload. Adaptive quality selected 320 × 180 through theme changes
and 640 × 360 in the later recreation phases in both conditions.

The [machine-readable results](web-performance-results.json) include individual
endpoint samples, medians, ranges, process counts and input hashes. The earlier
condition records HEAD `80a02ed`, with temporary Web 8.281.0 package overrides and
the measurement harness; it is not a clean checkout of that revision. The fixed
condition records `dee205b`, with committed measured inputs checked clean before
and after execution. Application and shared-UI source hashes match. Changes to
the harness added provenance checks; the 21-phase workload and sampling remained
the same. Served development responses have their own hashes for each run.

Values below are medians with observed minimum–maximum in parentheses.

| Ordinary measurement | Before the ownership correction | After |
| --- | --- | --- |
| Renderer process CPU time | 2.333 s (2.160–2.343) | 2.924 s (2.892–2.929) |
| Renderer main-thread CPU time | 1.349 s (1.288–1.382) | 1.785 s (1.778–1.799) |
| JavaScript heap after disposal | 27.02 MiB (22.16–27.64) | 15.92 MiB (15.84–21.50) |
| Highest sampled heap per run | 33.94 MiB (33.83–37.14) | 29.38 MiB (26.33–29.65) |

The CPU times increased. Cleanup performs work, but this comparison does not
isolate the cause of the CPU difference. Ordinary heap samples also depend on
when the browser collects garbage.

| Separate diagnostic after explicit collection | Before | After |
| --- | --- | --- |
| JavaScript heap | 20.049 MiB (20.043–20.051) | 13.676 MiB (13.664–13.679) |
| DOM nodes | 12,991 in every run | 2,560 in every run |
| DOM event listeners | 14,469 in every run | 531 in every run |
| Browser process RSS | 222.95 MiB (220.66–227.70) | 244.44 MiB (244.03–245.23) |
| Three renderer processes, summed RSS | 607.61 MiB (533.84–674.36) | 661.89 MiB (660.38–664.56) |
| GPU process RSS | 131.05 MiB (130.30–131.92) | 158.19 MiB (154.77–158.59) |

The separate diagnostic showed approximately 32% less retained JavaScript heap,
80% fewer DOM nodes and 96% fewer listeners. Process RSS did not decrease in this
comparison. RSS includes resident code, native allocations and shared pages; it
is not a private-allocation total. GPU-process RSS is system RAM, not graphics
memory. These measurements establish neither total-memory savings nor a CPU
improvement.

Both conditions finished with 988 connected elements, zero media elements and
live players, seven created and seven destroyed players, no pending source load
or requests, and a stopped app metrics timer. One interval remained in the
development page. The runs had no uncaught exceptions or error-level console
messages. This short desktop workload does not establish long-session behavior,
all SDK caches becoming collectible, or results on other hardware.

## Why auxiliary controls need explicit ownership

The ownership issue was recorded on 2026-10-19 with `bitmovin-player-ui` 4.15.1:
theme changes removed the old UI from the page while shared language-change
subscriptions retained some controls
and their UI trees. This also reproduced without the benchmark's app hook.
Local heap snapshots traced references through `SeekBarLabel` and subtitle
settings controls such as `WindowOpacitySelectBox` to a released UI manager.

The current locked version is 4.23.0. These objects are configured separately
from the normal container children. The upstream
[seek-bar release](https://github.com/bitmovin/bitmovin-player-ui/blob/v4.23.0/src/ts/components/seekbar/SeekBar.ts)
does not release its label subtree, and dynamic settings items similarly own
separate selectors. Icons, preview subtitles, and temporary subtitle sizing
labels also need their creating component to release them. Upstream 4.23.0
already calls the base release method in
[`QuickSeekButton`](https://github.com/bitmovin/bitmovin-player-ui/blob/v4.23.0/src/ts/components/buttons/QuickSeekButton.ts),
so the rebased patch omits that older correction. The current measurements above apply to the corrected 4.23.0 patch.

Further inspection of 4.23.0 found two ownership paths outside ordinary child
traversal. Dynamic settings items replace their child list, leaving the item
label outside `getComponents()`. Recommendation items similarly own title and
duration labels separately; removing old recommendations must release them.
The patch releases these owned controls exactly once, including labels outside
the ordinary child tree. UI managers also registered source-change callbacks
directly on the player. Registering them through the manager's wrapped player
makes manager disposal remove those subscriptions. Regression checks reproduce
each path before the correction and verify released controls after it.

The [version-specific dependency patch](../patches/README.md) adds these ownership
releases to the framework entry point used by both Web and the shared native UI
bundle. The manager and auxiliary owners share a traversal backed by a
`WeakSet`: it marks an object before releasing it, avoids duplicate release
when a child has two owners, and does not retain the released object. It leaves
the global language-change event implementation unchanged. The Default theme
also releases its unused stock root after adopting its children; the adopted
children remain active under their normal owner.

The public browser regression uses all nine actual factories and UI managers.
It checks live localization, exactly-once auxiliary and Icon release, repeated
manager disposal, and subsequent factory creation. It also covers an auxiliary
that is reachable through the normal tree and checks that the Default theme
preserves its adopted child instances. Run
`pnpm --filter @showcase/e2e e2e:public` to include this check. Recheck these
ownership paths before upgrading the UI library; the patch applies only to
4.23.0 and preserves its MIT notice.

This correction does not establish that every SDK object becomes collectible.
Some objects remain after explicit collection, so the measured reduction must
not be described as eliminating all retained UI memory. A successful destroy
check confirms the tested player, media element, and app timer lifecycle; it
does not prove that every SDK cache or browser-native media allocation is empty.

Protocol references: [Playwright CDP sessions](https://playwright.dev/docs/api/class-cdpsession),
[Chromium performance counter implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/inspector/inspector_performance_agent.cc),
and [DevTools memory counters](https://chromedevtools.github.io/devtools-protocol/tot/Memory/).
