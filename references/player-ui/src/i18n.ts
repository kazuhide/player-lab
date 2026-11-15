export type Locale = "en" | "ja";

const en = {
  synthetic: "Synthetic data", sourceCaption: "60-second HLS", retry: "Retry",
  viewingData: "Viewing data", scenario: "Sample", metric: "Graph on the video",
  replayed: "Rewatched sections", watched: "Watched sections", showGraph: "Show on the timeline",
  watchDefinition: "At least once", replayDefinition: "Twice or more in one record",
  previewScale: "Previews use the same 0–100% scale.", noRewatch: "No rewatch", noRecords: "No records",
  sampleSparse: "These records include rewatching the same sections.",
  sampleSingle: "One playback record includes repeated sections.",
  sampleBroader: "A similar pattern to the 5-record sample, based on 25 records.",
  sampleWatched: "The video was watched, but no section was replayed.",
  sampleEmpty: "This sample contains no playback records.",
  appearance: "Accent", blue: "Blue", white: "White", jumpTo: "Jump to a section",
  snapshotFile: "Snapshot JSON", samplesFile: "Sample JSON", integrationCode: "Integration code",
  codeCaption: "Player configuration and the added UI component", copy: "Copy", copied: "Copied",
  measuredValues: "Underlying values", interval: "Interval", replayCoverage: "Replay coverage",
  watchCoverage: "Watched coverage", sessions: "Playback records", sampleRecords: "Analytics-style sample records",
  sampleCaption: "Synthetic records use the public Analytics sample fields. This wrapper is specific to this reference.",
  footerNote: "Synthetic data. No Analytics account or API key is used.", guide: "Guide and source",
  loading: "Loading", ready: "Ready", playing: "Playing", paused: "Paused", error: "Could not load data",
  videoError: "Could not load the video", empty: "No viewing data", noPeaks: "No distinct peak",
  unobserved: "No record", changeLanguage: "Change language",
  relativeNote: "The video overlay scales its highest value to the full graph height.",
  noRewatchNote: "No rewatch in this sample. Select Watched sections to see what was watched.",
  mismatch: "The video does not match the timeline data", copyError: "Select and copy the code",
  sourceError: "Could not load the sample records", dataPending: "Loading a new sample",
} as const;

const ja: Record<keyof typeof en, string> = {
  synthetic: "合成データ", sourceCaption: "60秒のHLS", retry: "再試行",
  viewingData: "視聴データ", scenario: "サンプル", metric: "映像に重ねるグラフ",
  replayed: "見返された区間", watched: "見られた区間", showGraph: "タイムラインに表示",
  watchDefinition: "1回以上", replayDefinition: "同じ記録で2回以上",
  previewScale: "小グラフは同じ目盛（0–100%）です。", noRewatch: "見返しなし", noRecords: "記録なし",
  sampleSparse: "同じ区間を見返した記録を含む例です。",
  sampleSingle: "1件の再生記録で、同じ区間を見返した例です。",
  sampleBroader: "5件の例に近い視聴傾向を、25件の記録で表示します。",
  sampleWatched: "見た記録はありますが、見返しはありません。",
  sampleEmpty: "再生記録がない例です。",
  appearance: "アクセント", blue: "青", white: "白", jumpTo: "区間へ移動",
  snapshotFile: "集計済みJSON", samplesFile: "サンプルJSON", integrationCode: "組み込みコード",
  codeCaption: "Playerの設定と追加するUIコンポーネント", copy: "コピー", copied: "コピーしました",
  measuredValues: "集計値", interval: "区間", replayCoverage: "見返された割合",
  watchCoverage: "見られた割合", sessions: "再生記録", sampleRecords: "Analytics形式のサンプル記録",
  sampleCaption: "Analyticsの公開フィールドに合わせた合成データです。外側の構造はこのリファレンス専用です。",
  footerNote: "合成データを使用。AnalyticsのアカウントやAPIキーは不要です。", guide: "ガイドとソース",
  loading: "読み込み中", ready: "準備完了", playing: "再生中", paused: "一時停止", error: "データを読み込めません",
  videoError: "動画を読み込めません", empty: "視聴データなし", noPeaks: "ピークなし",
  unobserved: "記録なし", changeLanguage: "表示言語を変更",
  relativeNote: "映像上のグラフは選んだ分布に合わせて高さを拡大しています。",
  noRewatchNote: "この例には見返しがありません。「見られた区間」で視聴範囲を確認できます。",
  mismatch: "動画とタイムラインのデータが一致しません", copyError: "コードを選択してコピーしてください",
  sourceError: "サンプル記録を読み込めません", dataPending: "サンプルを読み込み中",
};

export type TextKey = keyof typeof en;
export const text = (locale: Locale, key: TextKey): string => (locale === "ja" ? ja : en)[key];

export const recordCount = (locale: Locale, count: number): string => locale === "ja" ? `${count}件の再生記録` : `${count} playback ${count === 1 ? "record" : "records"}`;

export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n as TextKey;
    element.textContent = text(locale, key);
  }
  const button = document.querySelector<HTMLButtonElement>("#language")!;
  button.textContent = locale === "ja" ? "English" : "日本語";
  button.lang = locale === "ja" ? "en" : "ja";
  button.setAttribute("aria-label", text(locale, "changeLanguage"));
}

export function timeLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
