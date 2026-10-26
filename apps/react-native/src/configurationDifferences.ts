import type { ConfigurationDraft } from "./configuration";
import { configurationDifferences, type ConfigurationDifference } from "./differenceValues";

const normalized = (draft: ConfigurationDraft) => ({ ...draft,
  apiSettings: draft.apiSettings ?? {}, arraySettings: draft.arraySettings ?? {},
  scripts: { allowed: draft.scripts?.allowed ?? false, bodies: draft.scripts?.bodies ?? {} },
});

export function draftDifferences(before: ConfigurationDraft, after: ConfigurationDraft): ConfigurationDifference[] {
  return configurationDifferences(normalized(before), normalized(after));
}
