import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { generatedCodeDiagnostics } from "./generatedCodeCompiler";

it("compiles the integration guide example against the installed SDK and UI", () => {
  const example = fileURLToPath(new URL("../examples/minimal-player.ts", import.meta.url));
  expect(generatedCodeDiagnostics(readFileSync(example, "utf8"))).toEqual([]);
});
