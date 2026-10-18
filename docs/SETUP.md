# Setup — credentials & configuration

What you need to build and run the showcase locally, and **the one convention**
every script and app follows for credentials/config.

## Prerequisites

- Node.js 24 and pnpm 10.33.0 (`corepack enable` then `corepack prepare pnpm@10.33.0 --activate`)
- A Bitmovin account — https://dashboard.bitmovin.com
- For the encoding scripts: the Bitmovin CLI (`npm i -g @bitmovin/cli`) and, for
  the multi-codec Per-Title run, `pip install bitmovin-api-sdk`

## The convention

Two files, one precedence rule:

| File | Tracked? | Holds |
| --- | --- | --- |
| **`.env`** (repo root) | no — gitignored | **every credential and account-specific value**: API keys, license keys, S3 bucket + credentials |
| **`config/encoding.conf`** | yes — committed | non-secret encoding config: the S3 output **resource name** and the per-scenario **test-source catalog** |

**Precedence everywhere: environment > `.env` > `config/encoding.conf`.**
Files never override variables you exported in the shell, so one-off overrides
like `SOURCE_HOST=… provision.sh vod-baseline` always work. Loaders:
`scripts/env-lib.sh` (bash) and the equivalent block in
`encoding/vod-multicodec-pertitle/multicodec_pertitle.py` (python);
`apps/web/vite.config.ts` follows the same rule via Vite's `loadEnv`.

Secrets vs licenses — the split that decides where a value may travel:

- **API keys are secret** (`BITMOVIN_API_KEY`, `BITMOVIN_ANALYTICS_API_KEY`).
  They stay server/CLI-side; nothing ever maps them into a client bundle.
- **License keys are client credentials tied to allowed domains or app identifiers**
  (`BITMOVIN_PLAYER_LICENSE_KEY`, `BITMOVIN_ANALYTICS_LICENSE_KEY`). They are
  embedded client-side by design — the dashboard allow-list is the control.

## 1. Fill in `.env`

```bash
cp .env.example .env    # then fill in the values
```

| Variable | What / who consumes it |
| --- | --- |
| `BITMOVIN_PLAYER_LICENSE_KEY` | Player license — every app. Allow-list each app's domain / bundle ID (Web hosts other than exact `localhost`; iOS/Android/RN: the bundle/application id). |
| `BITMOVIN_ANALYTICS_LICENSE_KEY` | optional — Analytics collector license. When set, **every app's** collector reports QoE; empty keeps collectors off. |
| `BITMOVIN_API_KEY` | secret — encoding scripts, Bitmovin CLI, and the web Analytics query proxy (server-side). |
| `BITMOVIN_ANALYTICS_API_KEY` | optional secret — least-privilege key for the query proxy (falls back to `BITMOVIN_API_KEY`). |
| `BITMOVIN_TENANT_ORG_ID` | optional — org-scoped accounts only. Sent as `X-Tenant-Org-Id` by the Per-Title python script and the web analytics proxy. The CLI-based shell scripts use the org selected via `bitmovin config` instead (they print a reminder when this is set). Replaces `BITMOVIN_ANALYTICS_ORG_ID` (still accepted). |
| `BITMOVIN_OUTPUT_BUCKET` / `_REGION` | S3 bucket/region for encoder output + public URL printing. |
| `BITMOVIN_OUTPUT_ACCESS_KEY` / `_SECRET_KEY` | secret — used **once**, when a script has to create the named S3 output resource. |

## 2. Fan the licenses out to the apps

```bash
bash scripts/sync-env.sh    # rerun whenever .env changes (pnpm verify also runs it)
```

One `.env`, five targets — each app consumes the same two license keys through
its own toolchain-native mechanism:

| Target | Mechanism (generated file is untracked) |
| --- | --- |
| Web | automatic — `vite.config.ts` maps the root `.env` into `VITE_*`; an explicit `VITE_*` still wins as a web-only override |
| E2E | automatic — `tests/e2e/playwright.config.ts` injects the player key and pins analytics off |
| iOS / tvOS | `apps/ios/Local.xcconfig` → build settings → Info.plist (`xcodegen` picks it up; rerun `xcodegen generate` after the first sync) |
| Android / Fire TV | `apps/android/local.properties` (merged; `-PbitmovinLicenseKey=…` still wins) |
| React Native | `apps/react-native/.env` (`EXPO_PUBLIC_*`) — copy into the Expo app together with `App.tsx` / `src/` |
| Vega | no dotenv toolchain: the Kepler entry sets `globalThis.BITMOVIN_PLAYER_LICENSE_KEY` / `BITMOVIN_ANALYTICS_LICENSE_KEY` (configured in your Vega entry point) |

## 3. Install & verify

```bash
pnpm install --frozen-lockfile
pnpm verify     # typecheck + tests + builds (+ E2E / native builds where toolchains exist)
```

## 4. Encoders (test streams)

All encoder scripts share the storage rule — **bootstrap once, reference by
name**: the S3 output *resource* is looked up by `BITMOVIN_OUTPUT_NAME`
(`config/encoding.conf`) and created from `BITMOVIN_OUTPUT_*` only when missing.
No resource id is ever pasted into a template or committed. Test sources come
from the committed catalog in `config/encoding.conf` (env vars override).
The lookup pages through the account's full listing (needs `jq`); on an account
with thousands of resources that can take a while — `OUTPUT_ID=<uuid> …` /
`INPUT_ID=<uuid> …` skip it entirely.

```bash
# one-shot VOD test streams (validate-only first — no cost):
DRY_RUN=1 encoding/test-streams/provision.sh vod-baseline
encoding/test-streams/provision.sh vod-baseline

# the Live DVR channel (⚠ bills while RUNNING; auto-shutdown configured):
DRY_RUN=1 encoding/live-dvr/start.sh
encoding/live-dvr/start.sh

# multi-codec Per-Title (3 encodes + combined manifest — slow/expensive; AV1!):
DRY_RUN=1 python3 encoding/vod-multicodec-pertitle/multicodec_pertitle.py
python3 encoding/vod-multicodec-pertitle/multicodec_pertitle.py
```

## Test streams without an encoder

The apps' live sources default to verified public live streams
(`docs/test-streams-catalog.md`), so UI and DVR behavior work with **no**
Bitmovin encoder running. Point `VITE_LIVE_*_URL` (web) at the `dvr-showcase`
channel while `encoding/live-dvr` is running.

## Optional feature media

The Web Player can run without a Player key at the exact hostname `localhost`.
This exception is for the Web SDK; native apps still need their own licensed
app identifiers. Analytics is optional and remains off without its key.

The sprite, multi-audio, and sideloaded-subtitle examples do not include hosted
account media. Set the existing `VITE_VOD_SPRITES_HLS_URL`,
`VITE_VOD_SPRITES_VTT_URL`, `VITE_VOD_MULTIAUDIO_HLS_URL`, and
`VITE_VOD_SUBTITLE_VTT_URL` overrides in `apps/web/.env` to your own accessible
media. See [the Web environment example](../apps/web/.env.example).
Browser tests for provisioned media use the separate runner variable
`VITE_TEST_STREAM_BASE_URL`; see [their instructions](../tests/e2e/README.md).

The Analytics query proxy runs only in the Vite development server. A static
production build has no server endpoint; provide your own server integration
before expecting queries there. Never expose the server-side account API key
through a `VITE_*` variable or generated client code.
