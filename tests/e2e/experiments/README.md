# Source preparation experiments

These branch experiments compare source preparation through public SDK APIs.
They do not change the released player comparison or GitHub Pages build.

## Run locally

Install the repository's pinned Node.js and pnpm versions, configure the local
`.env` as described in the root README, and build the Web application:

```sh
pnpm --filter @showcase/web build
```

Prepare the existing clear Big Buck Bunny baseline fixture: a 60-second HLS
presentation with 2-second fragmented MP4 segments, 640 × 360 video and separate
English audio. `--media-root` is the directory containing
`comparison-360p.m3u8`, its child playlists, initialization files and media
segments. Missing resources fail preflight; an HTML fallback is not accepted.

```sh
node tests/e2e/experiments/use-case-sweep.mjs \
  --media-root /absolute/path/to/vod-baseline \
  --output /absolute/path/outside/the/repository/results \
  --rounds 4 --policies on-demand,metadata,segments,decoded \
  --warmups 0,1000 --lookaheads 1,3 --steps 2
```

The output directory must be new. The command starts and closes its own
loopback server and Chromium process. Use `--help` for network, CPU and player
variants. Run performance batches sequentially on an otherwise idle machine.
Do not run builds or another browser benchmark during a batch.

`use-cases.html` is also available in the normal local Web build for manual
operation. Provide the baseline under that server's `media/vod-baseline/`
directory. This page is excluded from the Pages build.

## What the modes measure

| Mode | Work allowed before selecting the next source |
| --- | --- |
| `on-demand` | Source registration only; loading starts on selection. |
| `metadata` | Manifest and stream metadata, without deliberate segment preparation. |
| `segments` | Media loading before selection; no deliberate decoded playback. |
| `decoded` | Muted hidden playback, followed by pause and rewind before selection. |

Policies describe requested work, not a guarantee that a buffer is ready.
The configured preparation window starts before preparation is dispatched.
Unsupported modes remain in the results. Shaka's `pool` strategy owns a player
per source; `shared` uses one player and its public preload managers.

Every accepted transition requires the newly selected video's playback event,
two advancing presented frames near the requested start, the expected video
dimensions, and fresh audio decoder evidence. A successful SDK promise alone
is insufficient. A source error or preparation rejection invalidates the trial,
including errors from a prepared source that was not selected.

`initialFromCaseStart` includes driver import, SDK download, construction,
loading and playback. The nested `initial.marks` starts after the driver import;
use it only when that narrower interval is intended. Transition timings start
at selection. Keep input dispatch delay, preparation time and initial startup
separate when interpreting a transition result.

## Interpretation limits

The harness retains failures, unsupported modes, timeouts and unexecuted trials.
It does not retry failures or discard slow observations. A four-round block
balances engine order; more rounds are needed for a performance claim.

Each trial uses a fresh browser context. All trials in a batch share one owned
Chromium process, so operating-system and GPU caches can remain warm. Browser
CPU slowdown is a simulation; it does not establish performance on a TV or
mobile device. Audio counters establish decoding, not audibility or audio/video
synchronization.

CPU and heap diagnostics cover the measured page interval, including the
application and harness. They do not isolate SDK CPU or establish peak memory.
Server byte counts describe queued response bodies, not bytes received over the
network. Preparation for sources that are never selected is still real work.

This source-switching harness uses the normal application bundles. Separate
experiments with purpose-built SDK compositions must report their exact build
inputs and downloaded bytes; their cold-start results must not be attributed
to this harness or to CPU execution alone.
