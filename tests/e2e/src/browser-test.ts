import { expect, test as base } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { collectBrowserDiagnostics, type DiagnosticBuffer } from "./browser-diagnostics";

export { expect };
export const test = base.extend<{ browserDiagnostics: DiagnosticBuffer }>({
  browserDiagnostics: [async ({ page }, use, testInfo) => {
    const diagnostics = collectBrowserDiagnostics(page);
    try {
      await use(diagnostics.buffer);
    } finally {
      diagnostics.dispose();
      if (testInfo.status !== testInfo.expectedStatus || diagnostics.buffer.uncaughtErrors > 0) {
        const report = testInfo.outputPath("browser-diagnostics.json");
        await writeFile(report, JSON.stringify(diagnostics.buffer.snapshot(), null, 2), { flag: "wx", mode: 0o600 });
        await testInfo.attach("browser-diagnostics", {
          path: report,
          contentType: "application/json",
        });
      }
      expect(diagnostics.buffer.uncaughtErrors, "the browser must not raise uncaught errors; see sanitized diagnostics").toBe(0);
    }
  }, { auto: true }],
});
