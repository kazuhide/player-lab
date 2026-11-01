import { pick, userGuideHref, type L } from "./i18n";
import { clearProfiles, deleteProfile, readProfiles, saveProfile, writeProfiles, ProfileError,
  type ConfigurationProfiles, type ProfileErrorCode, type ProfileRules } from "./configurationProfiles";

interface Options {
  rules: ProfileRules;
  sdkVersion: string;
  busy: () => boolean;
  capture: () => Record<string, unknown>;
  restore: (values: Record<string, string | number | boolean | null>) => void;
}
const messages: Record<ProfileErrorCode, L> = {
  format: { ja: "保存形式を読み込めません。保存した設定を消去すると作り直せます。", en: "The saved format is unsupported or damaged. Clear saved profiles to start again." },
  platform: { ja: "Web版以外の設定は読み込めません。保存した設定を消去すると作り直せます。", en: "Profiles from another platform cannot be loaded. Clear saved profiles to start again." },
  setting: { ja: "保存できない項目や値が含まれています。設定ガイドで対象項目を確認してください。", en: "A setting or value is unsupported. See the configuration guide for supported fields." },
  name: { ja: "名前は1〜48文字で指定してください。改行や制御文字は使えません。", en: "Use a name of 1–48 characters without line breaks or control characters." },
  limit: { ja: "保存件数または容量の上限を超えています。不要な設定を削除してください。", en: "The profile count or size limit was exceeded. Delete profiles you no longer need." },
  storage: { ja: "ブラウザーに設定を保存できません。ストレージへのアクセスや空き容量を確認してください。", en: "Browser storage is unavailable or full. Check storage access and available space." },
  busy: { ja: "設定を適用しています。完了してから操作してください。", en: "Settings are being applied. Wait for the operation to finish." },
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); if (className) element.className = className; return element;
}

/** Saving and restoring never invoke a player operation. Only the existing draft owner is called. */
export function mountConfigurationProfiles(container: HTMLElement, options: Options): { refresh: () => void; relocalize: () => void } {
  const details = node("details", "config-profiles"); const summary = node("summary");
  const fields = node("div", "config-profile-fields");
  const nameLabel = node("label"); const nameText = node("span"); const name = node("input"); name.type = "text"; name.maxLength = 96; name.autocomplete = "off";
  const savedLabel = node("label"); const savedText = node("span"); const saved = node("select");
  nameLabel.append(nameText, name); savedLabel.append(savedText, saved);
  const actions = node("div", "config-profile-actions");
  const save = node("button"); const restore = node("button"); const remove = node("button"); const clear = node("button");
  for (const button of [save, restore, remove, clear]) button.type = "button";
  actions.append(save, restore, remove, clear); fields.append(nameLabel, savedLabel);
  const help = node("p", "config-profile-help"); const guide = node("a"); const status = node("p", "config-profile-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const confirmation = node("div"); confirmation.setAttribute("role", "group");
  const confirmationText = node("p", "config-profile-help");
  const confirmationActions = node("div", "config-profile-actions");
  const confirm = node("button"); const cancel = node("button"); confirm.type = cancel.type = "button";
  confirmationActions.append(confirm, cancel); confirmation.append(confirmationText, confirmationActions);
  details.append(summary, fields, actions, confirmation, help, guide, status); container.append(details);
  const storage = () => window.localStorage;
  let collection: ConfigurationProfiles = { schemaVersion: 1, platform: "web", profiles: [] };
  let selected = ""; let invalid = false; let unavailable = false; let message: L | undefined;
  let pending: { text: L; label: L; origin: HTMLButtonElement; action: () => void } | undefined;
  function failure(error: unknown, reading = false): void {
    const code = error instanceof ProfileError ? error.code : "setting";
    message = messages[code];
    if (reading) { invalid = code !== "storage"; unavailable = code === "storage"; }
    render();
  }
  function reload(): void {
    try { collection = readProfiles(storage, options.rules); }
    catch (error) { invalid = error instanceof ProfileError && error.code !== "storage"; unavailable = !invalid; throw error; }
    invalid = false; unavailable = false;
    if (!collection.profiles.some(profile => profile.id === selected)) selected = "";
  }
  function refreshControls(): void {
    const blocked = options.busy() || !!pending;
    save.disabled = blocked || invalid || unavailable;
    restore.disabled = remove.disabled = blocked || invalid || unavailable || !selected;
    saved.disabled = blocked || invalid || unavailable || !collection.profiles.length;
    name.disabled = !!pending;
    clear.hidden = !invalid; clear.disabled = blocked;
  }
  function render(): void {
    summary.textContent = pick({ ja: "設定の保存と復元", en: "Saved configurations" });
    nameText.textContent = pick({ ja: "設定の名前", en: "Configuration name" });
    savedText.textContent = pick({ ja: "保存した設定", en: "Saved configuration" });
    save.textContent = pick({ ja: "保存", en: "Save" }); restore.textContent = pick({ ja: "下書きへ復元", en: "Restore draft" });
    remove.textContent = pick({ ja: "削除", en: "Delete" }); clear.textContent = pick({ ja: "保存した設定を消去", en: "Clear saved profiles" });
    confirmation.hidden = !pending;
    confirmation.setAttribute("aria-label", pick({ ja: "操作の確認", en: "Confirm action" }));
    confirmationText.textContent = pending ? pick(pending.text) : "";
    confirm.textContent = pending ? pick(pending.label) : "";
    cancel.textContent = pick({ ja: "キャンセル", en: "Cancel" });
    help.textContent = pick({ ja: "通常パネルの再読み込み・再生成の設定を保存します。URL、自由な文字列、認証情報、即時操作、テーマ選択、詳細APIの編集内容は保存しません。復元後の適用は別の操作です。", en: "Saves the basic reload/recreate settings. URLs, free text, credentials, runtime controls, theme selection and detailed API edits are excluded. Apply separately after restoring." });
    guide.textContent = pick({ ja: "保存対象と制限", en: "Supported fields and limits" }); guide.href = userGuideHref("web-player-config") + "#saved-configurations";
    saved.replaceChildren(new Option(pick({ ja: "選択してください", en: "Choose a configuration" }), ""), ...collection.profiles.map(profile => new Option(profile.name, profile.id)));
    saved.value = selected;
    refreshControls();
    const profile = collection.profiles.find(profile => profile.id === selected);
    status.textContent = message ? pick(message) : profile && profile.sdkVersion !== options.sdkVersion
      ? pick({ ja: `保存時のSDKは${profile.sdkVersion}です。現在のSDK ${options.sdkVersion}の入力項目と型を確認してから、下書きへ復元します。`, en: `Saved with SDK ${profile.sdkVersion}; current SDK ${options.sdkVersion}. Supported fields are validated before restoration.` }) : "";
  }
  function ready(): void { if (options.busy() || pending) throw new ProfileError("busy"); reload(); }
  function requestConfirmation(text: L, label: L, origin: HTMLButtonElement, action: () => void): void {
    pending = { text, label, origin, action }; render(); cancel.focus();
  }
  function cancelConfirmation(): void {
    const origin = pending?.origin; pending = undefined; render(); origin?.focus();
  }
  cancel.addEventListener("click", cancelConfirmation);
  confirmation.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); cancelConfirmation(); } });
  confirm.addEventListener("click", () => {
    const requested = pending; if (!requested) return;
    pending = undefined;
    try { requested.action(); } catch (error) { failure(error); }
    render(); requested.origin.focus();
  });
  saved.addEventListener("change", () => {
    selected = saved.value; const profile = collection.profiles.find(entry => entry.id === selected);
    if (profile) name.value = profile.name; message = undefined; render();
  });
  save.addEventListener("click", () => {
    try {
      ready();
      const next = saveProfile(collection, name.value, options.capture(), options.sdkVersion, options.rules, crypto.randomUUID());
      const target = next.profiles.find(profile => profile.name.toLowerCase() === name.value.trim().toLowerCase())!;
      const commit = () => {
        writeProfiles(storage, next, options.rules); collection = next; selected = target.id;
        message = { ja: "通常パネルの対象設定を保存しました。", en: "Saved the supported basic settings." }; render();
      };
      if (collection.profiles.some(profile => profile.id === target.id)) {
        const expected = JSON.stringify(collection);
        requestConfirmation({ ja: "同じ名前の保存済み設定を置き換えますか？", en: "Replace the saved configuration with this name?" },
          { ja: "設定を置き換える", en: "Replace configuration" }, save, () => {
            ready(); if (JSON.stringify(collection) !== expected) throw new ProfileError("setting"); commit();
          });
      } else { commit(); }
    } catch (error) { failure(error); }
  });
  restore.addEventListener("click", () => {
    try {
      const requested = selected; ready();
      const profile = collection.profiles.find(entry => entry.id === requested);
      if (!profile) throw new ProfileError("setting");
      const restoreDraft = () => {
        options.restore({ ...profile.values });
        message = profile.sdkVersion === options.sdkVersion
          ? { ja: "下書きへ復元しました。差分を確認し、必要な設定を適用してください。", en: "Restored into drafts. Review the differences and apply the settings you need." }
          : { ja: `SDK ${profile.sdkVersion}で保存した設定を下書きへ復元しました。現在のSDK ${options.sdkVersion}の項目と型を確認済みです。適用は別の操作です。`, en: `Validated SDK ${profile.sdkVersion} settings against current SDK ${options.sdkVersion} and restored drafts. Apply separately.` };
        render();
      };
      if (profile.sdkVersion !== options.sdkVersion) {
        const expected = JSON.stringify(collection);
        requestConfirmation({ ja: "SDKのバージョンが異なります。対応項目を再検証して下書きへ復元しますか？", en: "This profile uses a different SDK. Revalidate its supported fields and restore the draft?" },
          { ja: "再検証して復元", en: "Revalidate and restore" }, restore, () => {
            ready(); if (JSON.stringify(collection) !== expected) throw new ProfileError("setting"); restoreDraft();
          });
      } else { restoreDraft(); }
    } catch (error) { failure(error); }
  });
  remove.addEventListener("click", () => {
    try {
      const requested = selected; ready(); const next = deleteProfile(collection, requested);
      writeProfiles(storage, next, options.rules); collection = next; selected = "";
      message = { ja: "保存した設定を削除しました。現在の下書きはそのままです。", en: "Deleted the saved configuration. Current drafts are unchanged." }; render();
    } catch (error) { failure(error); }
  });
  clear.addEventListener("click", () => {
    try {
      if (options.busy() || pending) throw new ProfileError("busy");
      clearProfiles(storage); reload(); selected = "";
      message = { ja: "保存した設定を消去しました。現在の下書きはそのままです。", en: "Cleared saved profiles. Current drafts are unchanged." }; render();
    } catch (error) { failure(error); }
  });
  try { reload(); } catch (error) { failure(error, true); }
  render(); return { refresh: refreshControls, relocalize: render };
}
