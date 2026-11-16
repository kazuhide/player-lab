# ライブ配信の見返しを想定したデモ

保存済みのHLSクリップにライブ配信を想定した架空の視聴記録を組み合わせます。
視聴者は共通の配信時刻を持ち、途中で参加し、過去の場面へ戻って再生した後、
進み続けるライブ位置へ復帰します。映像自体はオンデマンドのクリップです。

## 視聴の想定

| 想定 | 視聴者の操作 | グラフの形 |
| --- | --- | --- |
| 見返しが集中する | 同じ場面へ戻って再生する | 特定の区間に山ができる |
| 見返しが分散する | それぞれ異なる場面へ戻る | 広い範囲に低い山が分布する |
| 視聴データが少ない | 少数の再生記録に巻き戻しが含まれる | 少ない記録から見返しを確認できる |

視聴記録を生成し、ほかの合成データと同じ[集計処理](../src/engagement.ts)で
再生区間を計算します。再生IDもデモ用に生成します。
巻き戻す前と後の両方で再生した範囲を見返しとして数えます。
同じ再生記録で何度見返しても、視聴者が増えたようには数えません。

初期表示は「見返された区間」です。小さなプレビューは共通の0〜100%スケールで表示し、
映像上のグラフは最大値に合わせて高さを拡大します。
視聴の想定を切り替えても、動画は再生を続けます。

## ローカル用のデータを作る

Node.js 24.x（24.19以降）が必要です。このアプリのディレクトリで実行してください。
動画の長さをクリップに合わせ、出力先にはチェックアウト外のパスを指定してください。

```sh
node --input-type=module <<'NODE'
import { writeFile } from "node:fs/promises";
import { createLiveDemoScenarios } from "./tools/live-demo.ts";

const content = { id: "live-demo-window", revision: "demo-v1", durationMs: 60_000 };
const period = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-01-01T00:10:00.000Z",
};
const profiles = createLiveDemoScenarios(content, period)
  .map(({ id, title, snapshot }) => ({ id, title, snapshot }));
const pack = {
  schemaVersion: 1,
  kind: "synthetic-live-demo",
  source: { hls: "/__private/media/master.m3u8" },
  profiles,
};
await writeFile("/absolute/private/path/live-demo.json", JSON.stringify(pack), { mode: 0o600 });
NODE
```

`PLAYER_UI_PRIVATE_QUERY_FILE`にこのファイルを指定し、
[ローカル再生の手順](private-query-data.ja.md#ダウンロードしたhlsを再生する)に従って
保存済みHLSのディレクトリも設定します。
`/?data=private`を開くと、仮想ライブのデモデータと表示されます。
視聴の想定を選び、見返しと視聴範囲のグラフを切り替えられます。

## Bitmovin Dashboardでデモの再生記録を確認する

デモ専用のAnalyticsライセンスを使います。
別のPlayerインスタンスで次を設定すると、通常の再生・一時停止・シーク操作を収集できます。

```ts
analytics: {
  key: "<DEMO_ANALYTICS_LICENSE_KEY>",
  config: { cookiesEnabled: false },
  videoId: "player-lab-live-demo-<RUN_ID>",
  title: "Player Lab simulated live demo",
  customData1: "synthetic-live-demo",
  customData2: "live-focused",
  customData3: "<RUN_ID>",
}
```

Dashboardでそのライセンスと収集した時間帯を選び、動画IDやデモ用の項目で絞り込みます。
再生記録の詳細で収集された再生区間やシークを確認できます。
Player Labの見返しグラフはその区間から独自に計算します。
DashboardのEngagementグラフには別の定義があります。

上のJSONはオフライン用のデモ素材です。Analyticsへの取り込み要求ではありません。
通常のデモ画面ではAnalyticsへの送信は無効です。収集用のPlayerで有効にしてください。
設定の詳細は公式の[Collector設定](https://developer.bitmovin.com/playback/docs/configuration-analytics)と
[開発用ライセンスの設定](https://developer.bitmovin.com/playback/docs/setup-analytics)を参照してください。
