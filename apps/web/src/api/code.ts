import { inputCode } from "./materialize";
import type { ConfigRoot, PathPart } from "./types";

export function configurationCode(root: ConfigRoot, entries: { path: PathPart[]; value: unknown }[]): string {
  const target = root === "PlayerConfig" ? "playerConfig" : root === "SourceConfig" ? "sourceConfig" : "uiConfig";
  return [
    'import * as PlayerUI from "bitmovin-player-ui";',
    'import { EventDispatcher } from "bitmovin-player-ui/dist/js/framework/EventDispatcher";',
    'import { DOM as PlayerUIDOM } from "bitmovin-player-ui/dist/js/framework/DOM";',
    '// GUI-owned overrides. License values and unedited base settings are omitted.',
    '// Callbacks can use lab.ui and lab.getPlayer(); supply your current player.',
    'const lab = { ui: { ...PlayerUI, EventDispatcher, DOM: PlayerUIDOM }, getPlayer: () => player };',
    '// If an SDK instance was selected, replace resources[id] with that instance.',
    '// Apply these edits to your existing base configuration.',
    'function setConfigValue(config, path, value) {',
    '  let current = config;',
    '  for (let index = 0; index < path.length; index++) {',
    '    const key = path[index];',
    '    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Reserved property name");',
    '    if (Array.isArray(current) && key > current.length) throw new Error("Keep the base array entries or add them in order");',
    '    if (index === path.length - 1) current[key] = value;',
    '    else {',
    '      const array = typeof path[index + 1] === "number";',
    '      if (array ? !Array.isArray(current[key]) : !current[key] || typeof current[key] !== "object") current[key] = array ? [] : {};',
    '      current = current[key];',
    '    }',
    '  }',
    '}',
    ...entries.map(entry => `setConfigValue(${target}, ${JSON.stringify(entry.path)}, ${inputCode(entry.value, entry.path.filter(part => typeof part === "string"))});`),
    `// Now use ${target} with ${root === "PlayerConfig" ? "new Player(...)" : root === "SourceConfig" ? "player.load(...)" : "the selected UI factory"}.`,
  ].join("\n");
}
