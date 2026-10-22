# Releases

GitHub Pages is updated only when a formal Player Lab release is published.
Merging a pull request runs CI without changing the public site. A release
publishes the same validated Pages build retained in its GitHub release assets.

## Product and SDK versions

The root `package.json` is the product version source. App package versions,
iOS/tvOS marketing versions, Android version names and the Vega manifest follow
it. SDK versions and native build numbers are maintained separately.

Use [Semantic Versioning](https://semver.org/): patch releases fix existing
behavior, minor releases add compatible capabilities, and major releases
introduce incompatible changes to supported user workflows or configuration.
During `0.x` development, use a minor release for an incompatible change and
describe the migration in its release notes.

Do not bump the product version for each pull request. Group tested changes
into a release when they form a useful update, or release a focused fix when
users need it promptly. Keep the next release version, notes and derived app
versions together in one release pull request.

## Prepare a release

1. Update the root `package.json` version. Run:

   ```sh
   python3 scripts/product_version.py sync
   python3 scripts/product_version.py check
   ```

2. Add `docs/releases/VERSION.md` with user-visible changes, setup requirements
   and any migration steps. Update [CHANGELOG.md](../CHANGELOG.md).
3. Merge the release pull request after review and successful CI. Select a
   successful main-branch CI run for the exact source commit to release.
4. Open the **Create release** workflow on `main`. Set `version` without the `v`
   prefix, `sha` to the full source commit and `ci_run_id` to that CI run's ID.

The workflow verifies the source, version, required CI jobs, public-key setup
flags and signed build identity. It creates the tag and a draft release,
uploads the verification assets, publishes an immutable release, and requests
Pages publication. No account API secret is required for this process.

Re-running the same request can resume an interrupted publication. Different
source commits, notes or asset contents for the same version are rejected;
prepare a new version rather than replacing a published release.

## Verify publication

Check that **Create release** and **Publish release to Pages** succeed. Compare
the version and source commit shown by the public app and guide with the GitHub
release, then check playback and the settings affected by that release.

The retained archive and verification assets allow publication after temporary
CI artifacts expire. The verification workflow still requires the original CI
run and job records to be available. Keep those records for released builds.

## Restore a previous release

Open **Publish release to Pages** on `main`, set `release_id` to the immutable
published release's numeric ID, and set `allow_older_release` to `true` when
deliberately restoring an older version. Leave `producer_run_id` empty for a
manual request; it is reserved for the release producer's automatic dispatch.

Restoration verifies and deploys the retained archive without rebuilding it or
moving tags. A later publication request takes precedence over a delayed older
request. Verify the restored public version and playback after it completes.
