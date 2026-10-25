import { mountConfigPanel } from "../../../apps/web/src/configPanel";
import { ApiExplorer } from "../../../apps/web/src/api/explorer";
import { setLang } from "../../../apps/web/src/i18n";
import { deepMerge, settleApply } from "../../../apps/web/src/configState";
import type { SourceConfig } from "bitmovin-player";
import type { ConfigRoot } from "../../../apps/web/src/api/types";
import "../../../apps/web/src/styles.css";

const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
const submissions: { root: ConfigRoot; value: unknown }[] = [];
let owner = 0;
let source: SourceConfig = { title: "Applied title" };
const submit = (root: ConfigRoot, value: unknown): Promise<void> => {
  submissions.push({ root, value });
  return new Promise((resolve, reject) => pending.push({ resolve, reject }));
};
setLang("en");
const panel = mountConfigPanel(document.getElementById("config")!, {
  getPlayer: () => undefined,
  getSource: () => source,
  getUiConfig: () => ({}),
  onRecreate: value => {
    const generation = owner;
    return settleApply(submit("PlayerConfig", value), () => generation === owner);
  },
  onReload: async value => {
    const generation = owner;
    const outcome = await settleApply(submit("SourceConfig", value), () => generation === owner);
    if (outcome === "applied") source = deepMerge(source, value);
    return outcome;
  },
});
const explorer: ApiExplorer = new ApiExplorer(document.getElementById("explorer")!, {
  getPlayer: () => undefined,
  getUi: () => undefined,
  apply: root => {
    const generation = owner;
    return settleApply(submit(root, explorer.overrides.entries(root)), () => generation === owner);
  },
  load: async () => undefined,
  destroy: async () => undefined,
  releaseUi: () => undefined,
  recreate: async () => undefined,
});

declare global {
  interface Window {
    settingsFixture: {
      submissions: typeof submissions;
      resolve: () => void;
      reject: () => void;
      refresh: () => void;
      retire: () => void;
      language: (language: "en" | "ja") => void;
    };
  }
}
window.settingsFixture = {
  submissions,
  resolve: () => pending.shift()?.resolve(),
  reject: () => pending.shift()?.reject(new Error("Fixture load failed")),
  refresh: () => panel.refresh(),
  retire: () => { owner++; explorer.beginPlayerChange()(); },
  language: language => {
    setLang(language);
    panel.relocalize();
    explorer.relocalize();
  },
};
