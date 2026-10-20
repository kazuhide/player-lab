# Player versions and API coverage

The **SDK updates** GitHub Actions workflow checks the official release channels
weekly and can also be started manually. It records version metadata and the
current public declaration inventory. Available releases create a draft update
PR with exact dependency edits, JavaScript declaration differences when they
can be extracted, and the required validation steps. A failed download,
dependency resolution or extraction is reported as a failure, never as a
successful compatibility check. An existing update PR is left intact.

The draft must resolve the workspace, Expo host and native dependency locks,
refresh this inventory and review GUI mappings before it can be merged. Native
wrapper dependencies and the version-specific UI ownership patch need their
own compatibility review. The workflow dispatches CI explicitly and does not
approve, mark ready or merge its update PR. Licensed device playback and the two
independent code reviews remain required. The workflow uses repository-scoped
GitHub permissions; it does not use Player or account keys.

The bilingual user guide presents the version table, category totals, scope
notes, full API lists, and exclusions. The JSON files in this directory are its
data source. A software development kit (SDK) provides the player library and its
API declarations. These files contain public API names, references and source hashes; no SDK
implementation or account configuration is included.

The normalized report, computed totals and SDK snapshots are marked as generated
in GitHub to keep code reviews readable. Their complete contents remain available
in the repository and guide. GUI exposure statuses still require a source review.

`checkedAt` records when the versions and mappings were reviewed. It is not a
claim that no later release exists. React Native uses the latest wrapper's
supported native dependencies. Vega uses the release channel supported by its
official sample, rather than the general Web release.

## What a percentage means

An application programming interface (API) is the set of settings, operations,
and events that the SDK exposes to application code. Coverage here asks which
of those interfaces the sample uses in configuration code, graphical controls or
visible output. Configuration usage and GUI access are reported separately.
The available API inventory is extracted from the public SDK before the app
mapping is applied.

Each platform has explicit scopes. Configuration, operations, state reads and
events use different units and are never combined into one percentage. The
scopes are not identical between SDKs, so the numbers are not a platform ranking
or a percentage of every symbol shipped in the SDK.

| Status | Meaning |
| --- | --- |
| `direct` | A control edits the field or invokes the operation with its supported GUI arguments. |
| `preset` | The GUI selects fixed source, value, or layout choices. |
| `observed` | A state read or event contributes to a visible display, log, or refresh of displayed state. |
| `internal` | Lifecycle or internal application work; no GUI coverage credit. |
| `code-only` | Present in code or setup, without an audited GUI control or visible consumer. |
| `sdk-ui-unverified` | A possible embedded SDK UI route has not been qualified through its native bridge. No credit is given. |
| `missing` | No exposed route was found in the audited scope. |

Configuration tables show the API entries used by application code: the sum of
`direct`, `preset` and `code-only` configuration rows. Individual GUI edits, GUI
presets and code-only entries are displayed separately. A zero direct count does
not mean that the app has no `PlayerConfig` or `SourceConfig` implementation.
These are SDK API entries, including configuration-object access and nested
properties, rather than independent editable fields. Code-only entries include
fixed values and helpers without GUI wiring; changing fixed values requires
editing the source and rebuilding. SDK defaults are not counted as app settings.

Operation tables show direct coverage and direct plus preset coverage separately.
State and event tables show confirmed visible use. Fixed constructor values,
environment settings, and unused reads do not earn GUI credit. A theme selector
does not expose every constant in that theme's source.

Configuration paths count array element shapes once, not individual array
elements or JavaScript array methods. Dynamic maps, callbacks, and opaque
objects have explicit boundaries. Method names count once across overloads;
native overload details and exclusions are retained. Deprecated callable APIs
remain in the denominator. Platform-unavailable declarations are excluded with
a reason. OS-version requirements still apply to a platform-family inventory.

Some SDK types describe a list as an interface extending `Array`, rather than a
plain array type. The extractor follows that element type and ignores inherited
`map`, `push`, and other JavaScript list operations. They are not player settings.

Field coverage does not promise every argument, independent combination of
values, or SDK feature prerequisite. Static source mapping does not establish
successful playback, event delivery, device support, or external service receipt.
Recorded build and playback results remain separate evidence in the guide.

## Check the report

From the repository root, install the pinned dependencies and run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 scripts/check-api-coverage.py
python3 scripts/test-api-coverage.py
```

The check compares manifest versions, the SDK inventory, the mapped API IDs,
tracked app-source hashes, the declared source revision, and the recomputed
summary. It rejects stale or edited totals. JavaScript declaration inventories
are also checked against the installed SDK distributions. The check uses no
network, license values, environment files, or native local configuration.

Updating application controls or SDK versions requires reviewing and refreshing
their mappings; changing a percentage in `summary.json` cannot update coverage.
The report deliberately fails when a cited source file changes.

## Refresh public SDK inventories

The scripts in `scripts/api-coverage/` read public declaration distributions.
Keep downloaded SDK documentation and source archives in a separate local cache;
do not add them to this repository. Native refreshes fetch only the exact public
versions named by their pinned metadata. They do not configure accounts or run
licensed players.

The Apple snapshot preserves per-member platform and OS introduction information
from its versioned DocC documentation. The Android generator compares selected
public source-archive declarations with the versioned Dokka documentation and
records overload and alias exclusions. Both are documentation formats used by
the vendor to publish API references.

DocC checksums use explicit `sha256` records. Some API filenames contain `key`;
mapping those names directly to bare hashes resembles credential assignments to
generic secret scanners. Structured checksum records preserve the same path and
digest without disabling secret detection.

For the installed Web, UI, React Native and Vega packages, the independent
extractor can write a fresh inventory to standard output:

```sh
node -e 'process.stdout.write(JSON.stringify(require("./scripts/api-coverage/extract-installed.cjs").extractInstalled(process.cwd()), null, 2) + "\n")'
```

The native generators accept an external cache and output directory. Replace
the example paths below with directories outside the checkout, and replace
`SOURCE_COMMIT` with the full commit whose app sources are being measured.

```sh
python3 scripts/api-coverage/apple/normalize_apple.py \
  --repo . --source-revision SOURCE_COMMIT \
  --sdk-root /path/to/public-sdk-cache/apple --fetch \
  --output /path/to/api-refresh/apple
python3 scripts/api-coverage/android/regenerate.py \
  --repo . --version 3.171.0 --output /path/to/api-refresh/android
```

The Apple manifest pins the documentation files and their hashes. A new SDK
version needs a reviewed manifest and scope update, not an unverified version
substitution. The Android generator's `--offline` option can reuse complete
public caches; see `--help` for their layouts.

The GUI mapping is a source review, not an inference from method-name matches.
For each changed member, review the control, arguments and final consumer before
editing its status and app evidence in `coverage.json`. Merge newly reviewed SDK
member facts into the report and `inventory.json`, retain exclusion reasons, and
set `sourceRevision` to the measured app commit. After reviewing those inputs,
regenerate the category totals with:

```sh
python3 scripts/coverage_report.py \
  --input docs/api-coverage/coverage.json \
  --summary docs/api-coverage/summary.json --repo . \
  --bindings docs/api-coverage/bindings.json \
  --inventory docs/api-coverage/inventory.json --write
python3 scripts/check-api-coverage.py
```

The guide reads these same inputs; no percentage is maintained separately in
HTML. Update both language editions when scope notes or exclusions change, then
run `python3 scripts/test-user-guide.py` and the Pages build.
