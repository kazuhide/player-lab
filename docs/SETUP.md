# Setup — credentials & configuration

What you need to build and run the apps locally, including their shared
credential convention. The Pages version uses a separate public configuration.

## Prerequisites

- Node.js 24.19.0 and pnpm 10.33.0 (`corepack enable` then `corepack prepare pnpm@10.33.0 --activate`)
- A Bitmovin account for licensed hosts, native apps or cloud features — https://dashboard.bitmovin.com
- For encoding: Bitmovin CLI 0.7.0, Python 3.10+ with OpenSSL, `jq`, and
  `envsubst` (from GNU gettext). See the pinned installation below.

## The convention

Two files, one precedence rule:

| File | Tracked? | Holds |
| --- | --- | --- |
| **`.env`** (repo root) | no — gitignored | **every credential and account-specific value**: API keys, license keys, S3 bucket + credentials |
| **`config/encoding.conf`** | yes — committed | non-secret encoding config: the S3 output **resource name** and the per-scenario **test-source catalog** |

**Local precedence: environment > `.env` > `config/encoding.conf`.**
Files never override variables you exported in the shell, so one-off overrides
like `SOURCE_HOST=… provision.sh vod-baseline` always work. Loaders:
`scripts/env-lib.sh` (bash) and the equivalent block in
`encoding/vod-multicodec-pertitle/multicodec_pertitle.py` (python);
Regular modes in `apps/web/vite.config.ts` follow the same rule via Vite's
`loadEnv`. The Pages profile ignores local dotenv files and inherited `VITE_*`
overrides.

Secrets vs licenses — the split that decides where a value may travel:

- **API keys are secret** (`BITMOVIN_API_KEY`, `BITMOVIN_ANALYTICS_API_KEY`).
  They stay server/CLI-side; nothing ever maps them into a client bundle.
- **License keys are client credentials tied to allowed domains or app identifiers**
  (`BITMOVIN_PLAYER_LICENSE_KEY`, `BITMOVIN_ANALYTICS_LICENSE_KEY`). They are
  embedded client-side by design — the dashboard allow-list is the control.

## Pages version

The public build targets [the Web app](https://kazuhide.github.io/player-lab/web/).
Playback there requires a Player license allowing the hostname. The exact
`localhost` exception does not apply to GitHub Pages or native apps. Never enter
an account API key into a browser setting.

The Pages build includes public test media. When configured with its public
Analytics license, the collector sends playback data to Bitmovin. Browser-local
playback measurements remain available. The account aggregation query panel is
hidden on Pages; queries need a separate backend with server-side account
credentials. See the [Web guide](../apps/web/README.md#pages-version) for the
fixture and notices.

This Pages build accepts only `PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY` and
`PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY` as client licenses. Use separate
licenses intended for the public demo, and allow `kazuhide.github.io` on both.
Both keys are delivered to visitors' browsers. Configure the two GitHub
repository variables with those exact names before publishing. Empty values
keep the corresponding build setting empty; an empty Analytics value leaves the
collector off. Local `BITMOVIN_*` names and inherited `VITE_*` values are not
fallbacks. Account API keys are never needed for Pages.

CI builds and tests the static files under `/player-lab/web/`, then uploads
those same files with a separate SHA-256 manifest. Pages accepts only a successful
CI run for the current `main` commit and configured public Player and Analytics
keys; it verifies the file list and hashes before deployment. A keyless build
can be tested at `localhost`, but cannot be promoted by the Pages workflow.

The artifact scan uses the default secret detectors. It distinguishes only those
two explicitly configured public license values in the generated main bundle;
other values and files remain subject to scanning. The temporary scan settings
are kept outside the published files and removed afterward. Local account keys
are never eligible for this exception.

## 1. Fill in `.env`

```bash
cp .env.example .env    # then fill in the values
```

| Variable | What / who consumes it |
| --- | --- |
| `BITMOVIN_PLAYER_LICENSE_KEY` | Player license for local apps. Allow-list each app's domain / bundle ID (Web hosts other than exact `localhost`; iOS/Android/RN: the bundle/application id). |
| `BITMOVIN_ANALYTICS_LICENSE_KEY` | optional — Analytics collector license for local apps. When set, their collectors report playback-quality measurements; empty keeps collectors off. |
| `BITMOVIN_API_KEY` | secret — encoding scripts, Bitmovin CLI, and the web Analytics query proxy (server-side). |
| `BITMOVIN_ANALYTICS_API_KEY` | optional secret — least-privilege key for the query proxy (falls back to `BITMOVIN_API_KEY`). |
| `BITMOVIN_TENANT_ORG_ID` | optional — org-scoped accounts only. Sent as `X-Tenant-Org-Id` by the Per-Title python script and the web analytics proxy. The shell workflows, including S3 bootstrap, use the org selected via `bitmovin config` instead (they print a reminder when this is set). Replaces `BITMOVIN_ANALYTICS_ORG_ID` (still accepted). |
| `BITMOVIN_OUTPUT_BUCKET` / `_REGION` | S3 bucket/region for encoder output + public URL printing. |
| `BITMOVIN_OUTPUT_ACCESS_KEY` / `_SECRET_KEY` | secret — used **once**, when a script has to create the named S3 output resource. |

## 2. Fan the licenses out to the apps

```bash
bash scripts/sync-env.sh    # rerun whenever .env changes (pnpm verify also runs it)
```

For local development, the apps consume the same two license keys through their
own toolchain-native mechanisms:

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

Install the tested CLI and Python SDK versions from the repository root. The
Python environment is local and ignored by Git; activate it in each new shell:

```bash
npm install -g @bitmovin/cli@0.7.0
python3 -m venv encoding/.venv
. encoding/.venv/bin/activate
python3 -m pip install -r encoding/requirements.txt
bitmovin --version
python3 -m pip show bitmovin-api-sdk
```

The SDK is needed for the Per-Title script and for first-use S3 output creation
by the shell scripts. Reusing an existing output in a shell workflow does not
need Python. These versions were checked with Python 3.14; cloud encoding and
account resources are not exercised by the offline regression tests.

All encoder scripts share the storage rule — **bootstrap once, reference by
name**: the S3 output *resource* is looked up by `BITMOVIN_OUTPUT_NAME`
(`config/encoding.conf`) and created from `BITMOVIN_OUTPUT_*` only when missing.
No resource id is ever pasted into a template or committed. Test sources come
from the committed catalog in `config/encoding.conf` (env vars override).
The lookup pages through the account's full listing (needs `jq`); on an account
with thousands of resources that can take a while. One exact name match is
required. Multiple matches fail before creating resources or starting an
encoding, even when a second match is on a later page. Use a unique name or
`OUTPUT_ID=<uuid> …` to choose an existing output explicitly. The shell scripts
also accept `INPUT_ID=<uuid> …` to bypass HTTPS input lookup.
They also reject multiple HTTPS inputs for the same host. Name lookup and
creation are separate requests, so bootstrap once before concurrent runs and
pass explicit IDs when another process may modify the resource listing.

First-use S3 creation reads the API key and S3 credentials from the environment.
It uses the SDK with request logging disabled: the CLI's create command requires
credential flags, which would expose them in a process listing. SDK exceptions
can also contain the request payload, so bootstrap prints a fixed error instead
of the exception body. Check existing outputs before retrying an uncertain
creation. Credentials still exist in process memory and the environment; keep
the machine and root `.env` private.

The shell bootstrap reads only the CLI's selected organization locally and uses
the same API-key environment variable as the CLI listing. The standalone
Per-Title script uses `BITMOVIN_TENANT_ORG_ID` directly. Confirm both organization
settings if you use both workflows. See the [CLI S3 interface](https://github.com/bitmovin/cli/blob/v0.7.0/src/commands/encoding/outputs/create/s3.ts)
and [SDK request logging](https://github.com/bitmovin/bitmovin-api-sdk-python/blob/v1.284.0/bitmovin_api_sdk/common/rest_client.py).

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

Run the offline resource-resolution and credential-handling checks with:

```bash
python3 scripts/test-encoding.py
```

These checks use local CLI fixtures and mocked HTTP requests. They cover zero,
one, and multiple name matches, pagination, explicit IDs, and success/error paths
without creating outputs or starting encoders in an account.

## Test streams without an encoder

The apps' live sources default to public live streams
(`docs/test-streams-catalog.md`), so UI and DVR behavior work with **no**
Bitmovin encoder running. Point `VITE_LIVE_*_URL` (web) at the `dvr-showcase`
channel while `encoding/live-dvr` is running.

## Optional feature media

The Web Player can run without a Player key at the exact hostname `localhost`.
This exception is for the Web SDK; native apps still need their own licensed
app identifiers. Analytics is optional and remains off without its key.

The local defaults for sprite, multi-audio, and sideloaded-subtitle examples
need media URLs. Set the existing `VITE_VOD_SPRITES_HLS_URL`,
`VITE_VOD_SPRITES_VTT_URL`, `VITE_VOD_MULTIAUDIO_HLS_URL`, and
`VITE_VOD_SUBTITLE_VTT_URL` overrides in `apps/web/.env` to your own accessible
media. See [the Web environment example](../apps/web/.env.example).
Browser tests for provisioned media use the separate runner variable
`VITE_TEST_STREAM_BASE_URL`; see [their instructions](../tests/e2e/README.md).

The Analytics query proxy runs only in the Vite development server. A static
production build has no server endpoint; provide your own server integration
before expecting queries there. Never expose the server-side account API key
through a `VITE_*` variable or generated client code.
