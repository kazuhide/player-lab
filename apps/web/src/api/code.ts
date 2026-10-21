import { inputCode } from "./materialize";
import type { ConfigRoot, PathPart } from "./types";

/** Construct eager GUI components after their localization dispatcher exists. */
export function uiConfigurationCode(config: object): string {
  const { localization, ...rest } = config as { localization?: unknown };
  return `(() => {\n  const localization = ${inputCode(localization)};\n  PlayerUI.i18n.setConfig(localization ?? {});\n  return Object.assign(${inputCode(rest)}, ${Object.prototype.hasOwnProperty.call(config, "localization") ? "{ localization }" : "{}"});\n})()`;
}

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
    'function isConfigObject(value) {',
    '  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);',
    '}',
    'function mergeConfigValue(current, value) {',
    '  if (!isConfigObject(value)) return value;',
    '  if (!isConfigObject(current)) current = {};',
    '  for (const [key, item] of Object.entries(value)) {',
    '    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Reserved property name");',
    '    if (item === undefined) delete current[key];',
    '    else current[key] = mergeConfigValue(current[key], item);',
    '  }',
    '  return current;',
    '}',
    'function setConfigValue(config, path, value) {',
    '  let current = config;',
    '  for (let index = 0; index < path.length; index++) {',
    '    const key = path[index];',
    '    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Reserved property name");',
    '    if (Array.isArray(current) && key > current.length) throw new Error("Keep the base array entries or add them in order");',
    '    if (index === path.length - 1) {',
    '      if (value === undefined && typeof key === "string") delete current[key];',
    '      else current[key] = mergeConfigValue(current[key], value);',
    '    }',
    '    else {',
    '      const array = typeof path[index + 1] === "number";',
    '      if (array ? !Array.isArray(current[key]) : !current[key] || typeof current[key] !== "object") current[key] = array ? [] : {};',
    '      current = current[key];',
    '    }',
    '  }',
    '}',
    ...entries.filter(entry => root === "UIConfig" && entry.path[0] === "localization")
      .map(entry => `setConfigValue(${target}, ${JSON.stringify(entry.path)}, ${inputCode(entry.value, entry.path.filter(part => typeof part === "string"))});`),
    ...(root === "UIConfig" ? ['PlayerUI.i18n.setConfig(uiConfig.localization ?? {});'] : []),
    ...entries.filter(entry => root !== "UIConfig" || entry.path[0] !== "localization")
      .map(entry => `setConfigValue(${target}, ${JSON.stringify(entry.path)}, ${inputCode(entry.value, entry.path.filter(part => typeof part === "string"))});`),
    `// Now use ${target} with ${root === "PlayerConfig" ? "new Player(...)" : root === "SourceConfig" ? "player.load(...)" : "the selected UI factory"}.`,
  ].join("\n");
}
