export type Locale = "en" | "ja";

const en = {
  synthetic: "Synthetic data", sourceCaption: "60-second HLS", retry: "Retry",
  viewingData: "Viewing data", scenario: "Sample", metric: "Graph",
  replayed: "Replayed portions", watched: "Watched portions", showGraph: "Show on the timeline",
  appearance: "Accent", blue: "Blue", white: "White", jumpTo: "Jump to a section",
  snapshotFile: "Snapshot JSON", samplesFile: "Sample JSON", integrationCode: "Integration code",
  codeCaption: "Player configuration and the added UI component", copy: "Copy", copied: "Copied",
  measuredValues: "Underlying values", interval: "Interval", replayCoverage: "Replay coverage",
  watchCoverage: "Watched coverage", sessions: "Sessions", sampleRecords: "Analytics-style sample records",
  sampleCaption: "Synthetic records use the public Analytics sample fields. This wrapper is specific to this reference.",
  footerNote: "Synthetic data. No Analytics account or API key is used.", guide: "Guide and source",
  loading: "Loading", ready: "Ready", playing: "Playing", paused: "Paused", error: "Could not load data",
  videoError: "Could not load the video", empty: "No viewing data", noPeaks: "No distinct peak",
  unobserved: "No record", sessionCount: "sessions", changeLanguage: "Change language",
  replayNote: "Relative to this video. Session counts are shown in Underlying values.",
  reachNote: "Watched portions. No replay was recorded in this sample.",
  watchedNote: "Watched coverage, relative to this video.",
  mismatch: "The video does not match the timeline data", copyError: "Select and copy the code",
  sourceError: "Could not load the sample records", dataPending: "Loading a new sample",
} as const;

const ja: Record<keyof typeof en, string> = {
  synthetic: "合成データ", sourceCaption: "60秒のHLS", retry: "再試行",
  viewingData: "視聴データ", scenario: "サンプル", metric: "グラフ",
  replayed: "再視聴", watched: "視聴分布", showGraph: "タイムラインに表示",
  appearance: "アクセント", blue: "青", white: "白", jumpTo: "区間へ移動",
  snapshotFile: "集計済みJSON", samplesFile: "サンプルJSON", integrationCode: "組み込みコード",
  codeCaption: "Playerの設定と追加するUIコンポーネント", copy: "コピー", copied: "コピーしました",
  measuredValues: "集計値", interval: "区間", replayCoverage: "再視聴の割合",
  watchCoverage: "視聴した割合", sessions: "セッション", sampleRecords: "Analytics形式のサンプル記録",
  sampleCaption: "Analyticsの公開フィールドに合わせた合成データです。外側の構造はこのリファレンス専用です。",
  footerNote: "合成データを使用。AnalyticsのアカウントやAPIキーは不要です。", guide: "ガイドとソース",
  loading: "読み込み中", ready: "準備完了", playing: "再生中", paused: "一時停止", error: "データを読み込めません",
  videoError: "動画を読み込めません", empty: "視聴データなし", noPeaks: "ピークなし",
  unobserved: "記録なし", sessionCount: "セッション", changeLanguage: "表示言語を変更",
  replayNote: "高さはこの動画内の相対値です。区間ごとの件数は集計値で確認できます。",
  reachNote: "視聴分布を表示。このサンプルには再視聴の記録がありません。",
  watchedNote: "この動画内の視聴分布を表示しています。",
  mismatch: "動画とタイムラインのデータが一致しません", copyError: "コードを選択してコピーしてください",
  sourceError: "サンプル記録を読み込めません", dataPending: "サンプルを読み込み中",
};

export type TextKey = keyof typeof en;
export const text = (locale: Locale, key: TextKey): string => (locale === "ja" ? ja : en)[key];

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
