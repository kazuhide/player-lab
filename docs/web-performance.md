# Measuring Web playback and UI changes

The lifecycle measurement runs the existing Web app with the local 60-second
Big Buck Bunny HLS and DASH fixtures. It plays video, switches all 14 themes
three times, changes the seek-preview setting, switches between HLS and DASH,
recreates the player three times through the DVR control, and releases the UI
and player. It checks that only one player and media element are active at each
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

## Recorded result: 2026-10-19

The original public baseline (`dc43bc7`) and patched 4.15.1 ran sequentially on
the same otherwise idle Apple M5 machine: 10 logical processors, 32 GiB memory,
macOS with Darwin 27.0.0, Node 24.19.0, pnpm 10.33.0, and Chromium
149.0.7827.55. Each used one excluded full warm-up and three measured contexts,
the same local fixture and harness, and a 1440 × 900 viewport. Video selected
both 320 × 180 and 640 × 360 renditions. The app's player lifecycle source was
identical; the change was the UI ownership correction described below.

Values are medians with the observed minimum–maximum in parentheses. CPU time
covers the workload from the settled starting sample through disposal, before
the separate explicit collection diagnostic.

| Normal measurement | Original baseline | Patched 4.15.1 |
| --- | --- | --- |
| Renderer process CPU time | 1.811 s (1.758–1.923) | 1.979 s (1.667–2.031) |
| Renderer main-thread CPU time | 1.103 s (1.042–1.152) | 1.166 s (1.042–1.242) |
| JavaScript heap after disposal | 28.08 MiB (24.70–28.34) | 28.24 MiB (19.24–30.46) |
| Highest sampled heap per run | 29.76 MiB (29.60–29.76) | 31.89 MiB (31.07–34.47) |

CPU ranges overlap and the patched medians are higher. These runs demonstrate
neither a CPU improvement nor a reduction in the highest sampled heap. Browser
collection timing affects the ordinary heap samples; the patch specifically
corrects ownership of objects that outlive their UI.

| Separate diagnostic after explicit collection | Original baseline | Patched 4.15.1 |
| --- | --- | --- |
| JavaScript heap | 19.61 MiB (19.59–19.63) | 17.59 MiB (17.57–17.59) |
| DOM nodes | 12,618 in all three runs | 10,535 in all three runs |
| DOM event listeners | 14,333 in all three runs | 10,580 in all three runs |

This diagnostic shows about 10% less retained JavaScript heap, 17% fewer DOM
nodes, and 26% fewer listeners for this workload. The connected page still had
886 elements in both cases. Every run created and destroyed four players;
disposal left zero media elements, zero pending requests, no pending app source
load, and a stopped app metrics timer. One registered interval remained in the
development page. No uncaught exception or error-level console message occurred
in these measured runs. The 17 public browser checks also passed with zero
retries. These short desktop measurements do not predict long sessions,
other hardware, or native application memory use.

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
so the rebased patch omits that older correction. The numeric measurements above
remain results for 4.15.1; they do not establish performance for 4.23.0.

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
