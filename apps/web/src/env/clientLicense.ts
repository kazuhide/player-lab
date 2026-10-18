/**
 * Resolution rule for the client-side license keys (used by vite.config.ts,
 * unit-tested in test/clientLicense.test.ts):
 *
 *   explicit VITE_* value  >  canonical repo-root name  >  ""
 *
 * An explicit VITE_ var is the web-only override; the canonical
 * BITMOVIN_*_LICENSE_KEY from the repo-root .env is the shared default
 * (docs/SETUP.md). Empty strings count as unset so that the E2E pins —
 * which set BOTH names to "" — deterministically turn a key off.
 */
export function resolveClientLicenseKey(
  explicitVite: string | undefined,
  canonical: string | undefined,
): string {
  return explicitVite || canonical || "";
}
