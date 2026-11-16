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
  calculationGuide: "Calculation and data sources",
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
  queryData: "Query API", privateProfile: "Saved Analytics data", privateScenario: "Data", privateQueryFile: "Query JSON",
  privateVideo: "Demo video", privateSourceCaption: "HLS",
  privateHint: "Saved Query API results.",
  privateWatched: "Playback records reaching this section", privateWatchDefinition: "Share of playback records",
  privateReplayDefinition: "Not measured in this batch", unavailable: "Not available",
  privatePreviewScale: "Playback-record share (0–100%).",
  privateMetricNote: "Counts records per interval, not length-weighted coverage. The overlay scales its highest value to full height.",
  privateFooter: "Saved Query API results. Playback does not query Analytics.",
  liveDemoData: "Simulated live data", liveDemoScenario: "Viewing scenario", liveDemoSnapshot: "Demo data JSON",
  liveDemoSourceCaption: "Saved HLS clip",
  liveDemoHint: "A live audience returning to earlier moments in the broadcast.",
  liveDemoFooter: "Fictional viewing records generated for a live-stream scenario.",
  observedDemoData: "Demo viewing data · Observability API",
  observedDemoHint: "Aggregated playback records retrieved through the API.",
  observedDemoFooter: "Playback records collected for this demo. Retrieved through the Observability API and aggregated for this graph.",
  apiEvidence: "API response and calculation", apiExcerpt: "Fields used in the calculation",
  apiScope: "Original API field names and values retained for this calculation. Other fields, including user, network and license metadata, are omitted.",
  apiRecord: "Playback record", apiSample: "API sample", apiField: "API field", apiMeaning: "Meaning", apiValue: "Original value",
  apiJson: "API response for this record (calculation fields)", apiDecisions: "How the samples contribute", apiPass: "Pass", apiRange: "Counted range", apiReason: "Decision",
  apiPasses: "Played ranges by pass", apiContributions: "Record contributions to the graph", apiBucket: "Graph interval",
  apiWatchedMs: "Watched range (ms)", apiReplayMs: "Replayed range (ms)", apiFetchedAt: "Retrieved", apiLastSequence: "Expected final sequence",
  apiUnits: "Times and positions are milliseconds. seeked is seek latency, not distance.",
  apiRangeRule: "Candidates have state=playing, played>0 and seeked=0. Ambiguous pre-seek ranges are excluded. Range length comes from content positions; played only establishes that playback occurred.",
  apiMethod: "Backward seeks separate passes. Replay is their overlap; each record counts at most once per position.",
  apiAsyncSeek: "Automated seeks wait for Seeked and the target position before continuing.",
  apiFormula: "Covered content milliseconds / (interval length × eligible playback records).",
  apiDrawing: "Missing observations stay blank; observed sections with no replay are zero. Smoothing and relative height affect only the drawing.",
  apiMissing: "API sample evidence is not included in this saved pack. The aggregate graph remains available.",
  apiError: "The saved API evidence could not be inspected.",
  apiNoEligible: "No eligible playback records",
  apiReasonPlayed: "Counted playback", apiReasonBackward: "Backward seek; starts another pass",
  apiReasonForward: "Forward or same-position seek; jump excluded", apiReasonAmbiguous: "Ambiguous interval before a seek; excluded",
  apiReasonCarried: "Carried seek target; no played interval", apiReasonNotPlaying: "Not playing; excluded", apiReasonNoRange: "No measurable played range",
  apiSequenceMeaning: "Sequence from 0", apiClockMeaning: "Client timestamp", apiStateMeaning: "Playback state", apiAdMeaning: "Content = 0",
  apiPlayedMeaning: "Playback time", apiSeekedMeaning: "Seek latency", apiStartMeaning: "Content start position", apiEndMeaning: "Content end position",
  apiDurationMeaning: "Declared duration", apiVideoMeaning: "Video identity", apiSourceMeaning: "HLS source",
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
  calculationGuide: "計算とデータの取得",
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
  queryData: "Query API", privateProfile: "Analyticsの集計データ", privateScenario: "データ", privateQueryFile: "Query集計JSON",
  privateVideo: "検証用動画", privateSourceCaption: "HLS",
  privateHint: "保存済みのQuery API集計です。",
  privateWatched: "区間を見た再生記録", privateWatchDefinition: "再生記録全体に対する割合",
  privateReplayDefinition: "この集計では取得していません", unavailable: "取得なし",
  privatePreviewScale: "再生記録の割合（0–100%）です。",
  privateMetricNote: "区間ごとの再生記録数を集計しています。視聴した長さで重み付けする割合とは異なります。映像上では最大値に合わせて高さを拡大します。",
  privateFooter: "保存済みのQuery API集計を表示しています。再生のたびにAnalyticsへ問い合わせることはありません。",
  liveDemoData: "仮想ライブのデモデータ", liveDemoScenario: "視聴の想定", liveDemoSnapshot: "デモデータJSON",
  liveDemoSourceCaption: "保存済みのHLSクリップ",
  liveDemoHint: "ライブ配信で直前の場面へ戻る視聴を想定しています。",
  liveDemoFooter: "記録はライブ配信を想定して生成したデモデータです。",
  observedDemoData: "Observability API · デモ視聴データ",
  observedDemoHint: "APIで取得した再生記録を集計しています。",
  observedDemoFooter: "デモ用に収集した再生記録をObservability APIで取得して集計しています。",
  apiEvidence: "API応答と計算過程", apiExcerpt: "計算に使う項目の抜粋",
  apiScope: "計算に使うAPIの項目名と値を元のまま残しています。ユーザー、ネットワーク、ライセンスなどの項目は含めていません。",
  apiRecord: "再生記録", apiSample: "APIサンプル", apiField: "APIの項目", apiMeaning: "意味", apiValue: "元の値",
  apiJson: "この再生記録のAPI応答（計算に使う項目）", apiDecisions: "サンプルの採用・除外", apiPass: "再生区分", apiRange: "採用した範囲", apiReason: "判断",
  apiPasses: "区切りごとの再生範囲", apiContributions: "グラフへの寄与", apiBucket: "グラフの区間",
  apiWatchedMs: "視聴範囲（ms）", apiReplayMs: "見返し範囲（ms）", apiFetchedAt: "取得日時", apiLastSequence: "想定した最後の連番",
  apiUnits: "時刻・位置・時間はミリ秒単位です。seekedはシークにかかった時間で、移動した距離ではありません。",
  apiRangeRule: "集計対象はstateがplaying、playedが正、seekedが0の再生範囲です。シーク直前の曖昧な範囲は除外します。長さはコンテンツ内の位置から計算し、playedは正かどうかの判定に使います。",
  apiMethod: "後方シークの前後で重なる再生範囲を見返しとして数えます。同じ記録は各位置で1件分までです。",
  apiAsyncSeek: "再生の自動化ではSeekedと到達位置の両方を確認して次へ進みます。",
  apiFormula: "再生した範囲の長さ（ミリ秒）÷（区間の長さ×集計対象の再生記録数）です。",
  apiDrawing: "未観測は空白、視聴はあっても見返しがなければ0です。曲線の平滑化と高さの拡大は描画だけに適用します。",
  apiMissing: "この集計ファイルにはAPIサンプルが含まれていません。集計済みのグラフは表示できます。",
  apiError: "保存したAPIの記録を確認できません。",
  apiNoEligible: "集計対象の再生記録なし",
  apiReasonPlayed: "再生範囲として採用", apiReasonBackward: "後方シーク・再生を区切る",
  apiReasonForward: "前方・同位置シーク・移動範囲は除外", apiReasonAmbiguous: "シーク直前で位置が曖昧なため除外",
  apiReasonCarried: "シーク先の値のみ・再生範囲なし", apiReasonNotPlaying: "再生中ではないため除外", apiReasonNoRange: "再生範囲がないため除外",
  apiSequenceMeaning: "0から始まる連番", apiClockMeaning: "クライアントの時刻", apiStateMeaning: "再生状態", apiAdMeaning: "コンテンツは0",
  apiPlayedMeaning: "再生した時間", apiSeekedMeaning: "シークにかかった時間", apiStartMeaning: "コンテンツ内の開始位置", apiEndMeaning: "コンテンツ内の終了位置",
  apiDurationMeaning: "宣言された長さ", apiVideoMeaning: "動画ID", apiSourceMeaning: "HLSソース",
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
  document.querySelector<HTMLAnchorElement>("#calculation-link")!.href =
    `https://github.com/kazuhide/player-lab/blob/main/references/player-ui/docs/analytics-data${locale === "ja" ? ".ja" : ""}.md`;
}

export function timeLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
