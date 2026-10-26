import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

/** Compile the emitted module itself, resolving the actual pinned SDK declarations. */
export function generatedCodeDiagnostics(code: string, repository = resolve(process.cwd(), "../..")): string[] {
  const uiRequire = createRequire(join(repository, "packages/ui-shared/package.json"));
  const uiPackage = uiRequire.resolve("bitmovin-player-ui/package.json");
  const uiTypes = join(dirname(uiPackage), uiRequire("bitmovin-player-ui/package.json").types);
  const file = join(repository, "apps/web/node_modules/.cache/generated-code.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    noEmit: true, skipLibCheck: true, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    paths: { "bitmovin-player-ui": [uiTypes], "bitmovin-player-ui/*": [join(dirname(uiPackage), "*")] },
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = path => path === file ? code : read(path);
  host.fileExists = path => path === file || exists(path);
  const program = ts.createProgram([file], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return `${diagnostic.file?.fileName ?? "compiler"}:${position ? position.line + 1 : 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}
