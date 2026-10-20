import { configurationCode, type ConfigurationCode } from "./configurationCode";
import { pick } from "./i18n";

/** Snapshots are explicit so playback updates never interrupt code selection. */
export function mountConfigurationCodeView(container: HTMLElement, snapshot: () => ConfigurationCode | undefined): void {
  const details = document.createElement("details");
  details.className = "config-code";
  const summary = document.createElement("summary");
  summary.textContent = pick({ ja: "適用済み設定をコードで表示", en: "Show applied configuration code" });
  const help = document.createElement("p");
  help.textContent = pick({
    ja: "現在のプレイヤーとソースのGUI設定を取得します。編集中の値とライセンスキーは含めません。表示後の変更は更新ボタンで取得できます。UIの組み立て方はプレイヤー横のコードを参照してください。",
    en: "Read the current player and source GUI settings. Draft edits and license keys are excluded. Refresh to capture later changes. Use the code beside the player to construct the selected UI.",
  });
  const area = document.createElement("textarea");
  area.readOnly = true;
  area.spellcheck = false;
  area.rows = 18;
  area.wrap = "off";
  area.setAttribute("aria-label", pick({ ja: "適用済み設定コード", en: "Applied configuration code" }));
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = pick({ ja: "コードをコピー", en: "Copy code" });
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = pick({ ja: "コードを更新", en: "Refresh code" });
  const capture = (): string | undefined => {
    try {
      const current = snapshot();
      if (!current) throw new Error("Configuration is not ready.");
      const code = configurationCode(current);
      area.value = code;
      copy.disabled = false;
      status.textContent = "";
      return code;
    } catch {
      area.value = "";
      copy.disabled = true;
      status.textContent = pick({ ja: "設定を取得できません。ソースの読み込み完了後に更新してください。", en: "Configuration is unavailable. Refresh after the source has loaded." });
      return undefined;
    }
  };
  const select = (): void => {
    area.focus();
    area.select();
    status.textContent = pick({ ja: "コードを選択しました。コピー操作を行ってください。", en: "Code selected. Use your device's copy command." });
  };
  refresh.addEventListener("click", capture);
  copy.addEventListener("click", () => {
    const code = capture();
    if (!code) return;
    if (!navigator.clipboard) { select(); return; }
    void navigator.clipboard.writeText(code).then(() => {
      status.textContent = pick({ ja: "コピーしました。", en: "Copied." });
    }).catch(select);
  });
  details.addEventListener("toggle", () => { if (details.open) capture(); });
  details.append(summary, help, refresh, copy, area, status);
  container.appendChild(details);
}
