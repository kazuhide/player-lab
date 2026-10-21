import { catalog } from "./catalog";
import { ApiMaterializer, ResourcePool, inputCode } from "./materialize";
import { ApiOverrides, apiPath, validateData } from "./values";
import { ResourceInput, type ConfigRoot } from "./types";

export interface ConfigInput { id: string; indices: number[]; value: unknown; }
const configuration = new Map(catalog.rows.filter((entry) => entry.category === "configuration").map((entry) => [entry.id, entry]));

function noRetiredResource(value: unknown): void {
  if (value instanceof ResourceInput) throw new Error("Query resources belong to the current session and cannot be carried into a recreated player. Use an approved callback's lab accessors for the new session.");
  if (Array.isArray(value)) value.forEach(noRetiredResource);
  else if (value && typeof value === "object") Object.values(value).forEach(noRetiredResource);
}

/** Syntax and input validation do not execute an edited callback or value factory. */
export function configurationOverrides(inputs: readonly ConfigInput[]): ApiOverrides {
  const overrides = new ApiOverrides();
  const pool = new ResourcePool({});
  const syntax = new ApiMaterializer(catalog, {}, pool, {}, () => {});
  try {
    for (const input of inputs) {
      const entry = configuration.get(input.id);
      if (!entry?.schema || (entry.root !== "PlayerConfig" && entry.root !== "SourceConfig")) throw new Error("Select a measured Vega configuration API.");
      noRetiredResource(input.value);
      validateData(catalog, entry.schema, input.value, input.id);
      syntax.preflight(input.value);
      overrides.set(entry.root, apiPath(input.id, input.indices), input.value);
    }
    return overrides;
  } finally { syntax.dispose(); pool.clear(); }
}

export function overrideCode(inputs: readonly ConfigInput[]): string[] {
  return inputs.map((input) => {
    const entry = configuration.get(input.id)!;
    const path = apiPath(input.id, input.indices).map((part) => typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`).join("");
    return (entry.root === "PlayerConfig" ? "playerConfig" : "sourceConfig") + path + " = " + inputCode(input.value, apiPath(input.id, input.indices).filter((part): part is string => typeof part === "string")) + ";";
  });
}

export const rootFor = (id: string): ConfigRoot => {
  const root = configuration.get(id)?.root;
  if (root !== "PlayerConfig" && root !== "SourceConfig") throw new Error("Unknown configuration root.");
  return root;
};

export function validateConfigurationShape(player: object, source: object, inputs: readonly ConfigInput[]): void {
  const overrides = configurationOverrides(inputs);
  validateData(catalog, catalog.roots.PlayerConfig!, overrides.apply("PlayerConfig", player), "PlayerConfig");
  validateData(catalog, catalog.roots.SourceConfig!, overrides.apply("SourceConfig", source), "SourceConfig");
}
