import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import catalog from "../src/api/schema.json";

it("keeps the configured SDK-managed UI assets on the installed UI version", () => {
  const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const uiPackage = JSON.parse(readFileSync(new URL("../../../packages/ui-shared/node_modules/bitmovin-player-ui/package.json", import.meta.url), "utf8"));
  expect(catalog.uiVersion).toBe(uiPackage.version);
  expect(source).toContain(`bitmovin-player-ui@${uiPackage.version}/dist/js/bitmovinplayer-ui.js`);
  expect(source).toContain(`bitmovin-player-ui@${uiPackage.version}/dist/css/bitmovinplayer-ui.css`);
});

it("retains a real boolean editor for SDK Boolean wrappers and a typed callback return graph", () => {
  const row = catalog.rows.find(row => row.id === "UIComponentConfigMap.SettingsPanelPage.removeOnPop")!;
  const nodes = catalog.nodes as Record<string, { kind: string; options?: string[] }>;
  const schema = nodes[row.schema!]!;
  expect(schema.kind).toBe("union");
  expect(schema.options!.map(id => nodes[id]!.kind)).toContain("boolean");
  expect(Object.values(nodes).some(node => node.kind === "RecursiveInput")).toBe(false);
});

it("keeps all generated type references resolvable, including factory overloads", () => {
  const nodes = catalog.nodes as Record<string, { options?: string[]; item?: string; items?: string[]; additional?: string;
    kind: string; value?: unknown; properties?: { schema: string }[];
    signatures?: { parameters: { schema: string }[]; returns: string }[] }>;
  for (const node of [...Object.values(nodes), ...Object.values(catalog.constructors)]) {
    for (const id of [
      ...("options" in node ? node.options ?? [] : []), ...("items" in node ? node.items ?? [] : []),
      ...("item" in node && node.item ? [node.item] : []), ...("additional" in node && node.additional ? [node.additional] : []),
      ...("properties" in node ? node.properties?.map(property => property.schema) ?? [] : []),
      ...(node.signatures?.flatMap(signature => [...signature.parameters.map(p => p.schema), signature.returns]) ?? []),
    ]) expect(nodes[id], id).toBeDefined();
  }
});
