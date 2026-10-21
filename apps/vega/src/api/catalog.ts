import data from "./schema.json";
import type { ApiSchema } from "./types";

// This metadata is generated and checked against this app's exact SDK pin.
export const catalog = data as ApiSchema;
if (catalog.schemaVersion !== 1 || catalog.playerVersion !== "8.138.0-beta.28") throw new Error("Vega API editor metadata does not match its SDK.");
