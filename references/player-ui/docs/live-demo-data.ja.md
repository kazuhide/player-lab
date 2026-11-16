# Observabilityの再生記録から見返された区間を表示する

途中から参加したり、過去の場面へ戻ったりする視聴をデモ用に再現します。
Bitmovin PlayerとAnalytics Collectorで操作を収集し、Observability APIで取得した
再生記録をあらかじめ集計して表示します。映像はオンデマンドのHLSクリップで、
視聴行動はライブ配信を想定しています。

| 視聴の想定 | 再生の操作 | グラフの形 |
| --- | --- | --- |
| 見返しが集中する | 同じ場面へ戻って再生する | 特定の区間に山ができる |
| 見返しが分散する | それぞれ異なる場面へ戻る | 広い範囲に低い山が分布する |
| 視聴データが少ない | 少数の再生記録に巻き戻しが含まれる | 少ない記録から見返しを確認できる |

初期表示は「見返された区間」です。プレビューは共通の0〜100%スケールで表示し、
映像上のグラフは最大値に合わせて高さを拡大します。
視聴の想定を切り替えても、動画は再生を続けます。

## 再生記録を収集してDashboardで確認する

デモ専用のAnalyticsライセンスを使います。収集用のPlayerに次の項目を設定すると、
デモの記録を絞り込めます。CollectorとQueryには同じ値を指定してください。

```ts
analytics: {
  key: "<DEMO_ANALYTICS_LICENSE_KEY>",
  config: { cookiesEnabled: false },
  videoId: "player-lab-live-demo-<RUN_ID>-<SCENARIO>",
  title: "Player Lab rewatching demo",
  customData1: "player-lab-observability-demo",
  customData2: "<SCENARIO>",
  customData3: "<RUN_ID>",
}
```

Bitmovin Dashboardでそのライセンスと収集した時間帯を選びます。
動画ID、デモを示す`customData1`、収集単位を示す`customData3`で絞り込み、
再生記録の詳細を開くと再生区間やシークを確認できます。
項目とフィルターの設定は公式の[Collector設定](https://developer.bitmovin.com/playback/docs/configuration-analytics)を参照してください。

再生操作を自動化するときは`PlayerEvent.Seeked`を待ち、Playerの現在位置が
シーク先に到達したことを確認してから次の操作へ進みます。
データ収集では再生速度を上げています。起動時間やシーク時間などの性能評価には使いません。
このリファレンスの表示画面ではAnalyticsへの送信を無効にしています。

## サーバーで再生記録を取得する

Query APIで再生IDを探し、Impression Detailsで詳細を取得して再生区間を集計します。
その結果を保存し、ブラウザーへ配信します。アカウントのAPIキーはサーバー側で管理してください。
以下はサーバー側のスクリプトを作るためのリクエスト例です。
このアプリには汎用のAnalytics取得コマンドは含まれていません。

`POST https://api.bitmovin.com/v1/analytics/queries/count`に、
`X-Api-Key: <SERVER_API_KEY>`ヘッダーと次のJSONを送ります。

```json
{
  "licenseKey": "<DEMO_ANALYTICS_LICENSE_KEY>",
  "start": "2026-01-01T00:00:00.000Z",
  "end": "2026-01-01T00:10:00.000Z",
  "dimension": "IMPRESSION_ID",
  "groupBy": ["IMPRESSION_ID", "VIDEO_ID"],
  "filters": [
    { "name": "VIDEO_ID", "operator": "CONTAINS", "value": "player-lab-live-demo-<RUN_ID>-" },
    { "name": "CUSTOM_DATA_3", "operator": "EQ", "value": "<RUN_ID>" },
    { "name": "AD", "operator": "EQ", "value": 0 }
  ],
  "limit": 100,
  "offset": 0
}
```

時間帯は実際に収集した範囲へ変更します。応答の列は`columnLabels`のキーで特定し、
続きの行がある場合は`offset`を変えて取得します。想定した再生IDと動画IDが
すべて含まれることを確認してください。件数を取得できても、各再生のサンプルが
最後まで到着しているとは限りません。ページ分割の項目と1ページの上限は
公式の[Queryリクエストの定義](https://bitmovin.github.io/bitmovin-api-sdk-javascript/classes/AnalyticsQueryRequest.html)を参照してください。

対象の再生ごとに、`POST https://api.bitmovin.com/v1/analytics/impressions/<IMPRESSION_ID>`へ
同じAPIキーヘッダーとJSON `{"licenseKey":"<DEMO_ANALYTICS_LICENSE_KEY>"}`を送ります。
成功応答の`data.result`がサンプルの配列であることを確認します。
変換前に`impression_id`、`video_id`、デモ用の項目、ソースURL、`ad`が
収集時の想定と一致することを確かめてください。

応答の項目名はスネークケースです。次の項目だけを
[`ObservedSample`](../src/observed-replay.ts)へ対応させます。

| API応答の項目 | 集計入力の項目 | 意味 |
| --- | --- | --- |
| `sequence_number` | `sequenceNumber` | 0から始まるサンプルの連番 |
| `client_time` | `clientTime` | クライアントの時刻。ミリ秒単位 |
| `state` | `state` | 収集された再生状態 |
| `ad` | `ad` | コンテンツ再生は`0` |
| `played` | `played` | 再生した時間。ミリ秒単位 |
| `seeked` | `seeked` | シークにかかった時間。ミリ秒単位 |
| `videotime_start` | `videotimeStart` | コンテンツ内の開始位置。ミリ秒単位 |
| `videotime_end` | `videotimeEnd` | コンテンツ内の終了位置。ミリ秒単位 |
| `video_duration` | `videoDuration` | コンテンツの長さ。ミリ秒単位 |
| `video_id` | `videoId` | 収集された動画ID |
| `m3u8_url` | `sourceUrl` | 収集されたHLSのソースURL |

`seeked`はシークにかかった時間です。移動した距離や巻き戻し回数ではありません。
時間の項目は公式の[サンプル項目リファレンス](https://bitmovin.github.io/bitmovin-api-sdk-php/classes/BitmovinApiSdk_Models_AnalyticsImpressionSample.html)で確認できます。
ユーザー、ネットワーク、ライセンスの情報を集計入力やブラウザー用のデータに含めないでください。

## 集計したグラフを保存する

集計はブラウザーの外で実行します。Node.js 24.xの24.19以降が必要です。
次の例では、`rawSamples`が検証済みのImpression Detailsの配列、
`capturedFinalSequence`が収集終了時に記録した最後の連番です。
最後の連番は別に記録してください。APIから返った連番の最大値だけでは、
末尾のサンプルが欠けているかどうかを判別できません。

```js
import { computeObservedReplay } from "../src/observed-replay.ts";
import { validatePrivateData } from "../src/private-data.ts";

const projectSample = row => ({
  sequenceNumber: row.sequence_number, clientTime: row.client_time,
  state: row.state, ad: row.ad, played: row.played, seeked: row.seeked,
  videotimeStart: row.videotime_start, videotimeEnd: row.videotime_end,
  videoDuration: row.video_duration, videoId: row.video_id,
  sourceUrl: row.m3u8_url,
});
const snapshot = computeObservedReplay({
  content: { id: "demo-clip", revision: "demo-v1", durationMs: 60_000 },
  period: {
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-01T00:10:00.000Z",
  },
  videoId: "player-lab-live-demo-<RUN_ID>-<SCENARIO>",
  sourceUrl: "/__private/media/master.m3u8",
  sessions: [{
    id: "demo-record-1",
    expectedLastSequence: capturedFinalSequence,
    samples: rawSamples.map(projectSample),
  }],
}, 2_000);

const pack = validatePrivateData({
  schemaVersion: 1,
  kind: "observability-replay-demo",
  source: { hls: "/__private/media/master.m3u8" },
  profiles: [{
    id: "focused",
    title: { en: "Concentrated rewatching", ja: "見返しが集中する" },
    snapshot,
  }],
});
```

長さ、ソース、動画ID、時間帯を収集したクリップに合わせます。
完全な再生記録を視聴の想定ごとに分けて集計すると、選択肢を追加できます。
選択肢の間でコンテンツのリビジョン、長さ、時間帯、生成時刻を揃えてください。
検証処理は連番の欠落、内容が異なる再送、コンテンツの不一致、
シークを伴わない不明な再生位置の逆行を拒否します。

検証に使ったクリップには、APIの`video_duration`を5ミリ秒超える終了位置のサンプルがありました。
独立した計測では、再生完了後の`HTMLMediaElement.duration`もSDKが返す長さを超えていました。
この差を扱うため、次の条件に限って終端を許容します。
`mediaDurationMs`には、独立に計測して小数点以下を切り捨てたミリ秒値を任意で渡せます。
値は宣言した長さ以上、その5ミリ秒先までの範囲です。想定した最後の連番に限り、
終了位置がこの計測値以内なら扱えます。`playing`状態で`played`が正、`seeked`が0、
開始位置が宣言した終端より前であることも条件です。
集計範囲は宣言した長さまでに制限し、元の値は変更しません。
計測した長さを渡さない場合は、宣言した長さを超える位置を拒否します。
詳細な条件は[`computeObservedReplay`](../src/observed-replay.ts)を参照してください。

`JSON.stringify(pack)`をチェックアウト外へ保存し、ファイルの読み取り権限を制限します。
`PLAYER_UI_PRIVATE_QUERY_FILE`にそのファイルを指定し、
[ローカル再生の手順](private-query-data.ja.md#ダウンロードしたhlsを再生する)に従ってHLSのディレクトリを設定します。
`/?data=private`を開くと「Observability API · デモ視聴データ」と表示されます。
視聴の想定を選び、見返しと視聴範囲のグラフを切り替えられます。

実際のサービスではコンテンツ管理システム（CMS）へコンテンツのリビジョンごとに
集計結果を保存し、動画と一緒に配信できます。ブラウザーに必要なのは集計済みのデータです。
アカウントのAPIキーや再生ごとのAnalytics Queryは必要ありません。
集計結果は`metricVersion: "observed-replay-coverage-v1"`、`synthetic: false`となり、
[`validatePrivateData`](../src/private-data.ts)もこの区別を保ちます。

## グラフが示すもの

再生記録ごとに、実際に再生した区間をまとめたものが視聴範囲です。
後方へのシークで再生を区切り、別々の再生で重なった範囲を見返しとして数えます。
シークで飛び越えた区間や、シーク直前の位置が曖昧な区間は視聴範囲に含めません。
同じ再生記録で何度見返しても、各位置で1件分を超えて数えることはありません。

各区間では再生記録ごとにその区間を再生した範囲の長さを足し、区間の長さ×再生記録数で割ります。
未観測は`null`のまま残し、視聴はあるものの見返しがない区間は見返しを`0`とします。
少ない記録からでもグラフを描けますが、視聴者全体の好みを示すものとは限りません。

これはPlayer Lab独自の指標です。Bitmovin DashboardのEngagementグラフとは定義が異なります。
Query APIの件数だけでは同じ記録内の再生の重なりを復元できないため、
[Queryのみの表示](private-query-data.ja.md)では見返しを利用できません。

Analyticsに接続せずに試す場合は、[`createLiveDemoScenarios`](../tools/live-demo.ts)で
オフライン用の視聴記録を生成できます。この別の経路では`kind: "synthetic-live-demo"`、
`synthetic: true`を使い、画面にも仮想データと表示します。
