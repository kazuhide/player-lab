import { describe, expect, it } from "vitest";
import { resolveClientLicenseKey } from "../src/env/clientLicense";

// The precedence contract behind vite.config.ts's canonical→VITE_ mapping
// (docs/SETUP.md): explicit VITE_ override > canonical repo-root name > "".
describe("resolveClientLicenseKey", () => {
  it("falls back to the canonical repo-root name", () => {
    expect(resolveClientLicenseKey(undefined, "canonical")).toBe("canonical");
  });

  it("lets an explicit VITE_ value win over the canonical name", () => {
    expect(resolveClientLicenseKey("vite-wins", "canonical")).toBe("vite-wins");
  });

  it("treats an empty VITE_ value as unset (fresh .env.example copies)", () => {
    expect(resolveClientLicenseKey("", "canonical")).toBe("canonical");
  });

  it("resolves to '' when both are empty — the E2E collector-off pin", () => {
    expect(resolveClientLicenseKey("", "")).toBe("");
  });

  it("resolves to '' when nothing is configured", () => {
    expect(resolveClientLicenseKey(undefined, undefined)).toBe("");
  });
});
