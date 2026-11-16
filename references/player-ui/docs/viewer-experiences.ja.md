# 見どころ、保存済み履歴、前回の設定を使う

[English](viewer-experiences.md) · [日本語](viewer-experiences.ja.md) · [起動方法](../README.ja.md)

動画の下にある操作パネルで、見どころの短時間再生、履歴からの再開、字幕・音声の設定復元を試せます。
標準デモは60秒のBig Buck Bunny、合成した保存済み履歴、編集者が決めた区間を使います。
現在の再生で履歴を書き換えたり、Analyticsへイベントを送ったりする機能はありません。
AnalyticsライセンスやアカウントAPIキーは不要です。

## 短い時間で見どころを見る

「見どころ」で「再生時間の上限」を選び、表示された区間を確認してから「見どころを再生」を押します。
同じPlayerとHTMLのvideo要素で、選んだ区間を動画の順に再生します。
標準の`sparse`データでは上限20秒に対して合計12秒の2区間を選びます。

「通常再生に戻る」を押すと、その位置で自動移動を解除します。手動シークでも解除されます。
最後の区間が終わると一時停止します。データや上限を変えた場合も、区間の連続再生を解除します。
ソース切替、広告、Cast、エラー、Playerの破棄でも自動移動を解除します。

![2区間を選んだ見どころの画面](screenshots/viewer-highlights-ja.png)

候補の開始・終了位置と名前は、コンテンツ管理システム（CMS）で扱う情報としてサンプルに指定しています。
Analyticsの見返し割合で候補を順位付けしますが、その値が場面の重要性や面白さを証明するわけではありません。

## 保存済みの履歴から再開する

「視聴履歴」で「保存済みの履歴」を選び、「続きから再生」を押すと0:12から再開します。
これは最新の妥当な再生サンプルの末尾です。以前の視聴では0:46まで進んでいますが、最大位置は使いません。

「記録のない区間へ」を押すと0:32から再生します。
章ごとに「記録あり」「一部記録あり」「記録なし」「不明」を表示し、章のボタンを押すとその先頭から再生します。
「一部だけの履歴」では記録済みの範囲を残しますが、履歴にない範囲は不明なので「記録のない区間へ」は使えません。

![保存済みの履歴と章ごとの状態](screenshots/viewer-history-ja.png)

「初回の視聴」「全編の視聴記録」「履歴を利用できない場合」でも、状態の違いを確認できます。
「保存済み履歴を使う」を外すと、履歴を使う操作を無効にします。
「削除」は選択中の例を画面から取り除く操作です。例を選び直すと再び読み込みます。
サーバーの記録を削除したり、新しい再生位置を保存したりする操作ではありません。

## 前回の字幕・音声設定を使う

「保存済みの履歴」を選んだまま「字幕・音声」を開き、「利用できる設定を適用」を押します。
この例の設定は日本語字幕と英語音声です。現在のソースで利用できる設定だけをPlayerへ適用します。
「元に戻す」を押すと、適用する直前に退避した設定へ戻します。

![前回の字幕・音声設定](screenshots/viewer-preferences-ja.png)

「前回は字幕オフ」では字幕を無効にします。「字幕・音声の設定記録なし」では両方を情報なしとして扱います。
ソースにない言語は利用できない状態で表示し、架空のトラックで補いません。
履歴やソースを変えると、以前の「元に戻す」は使えなくなります。

日英のWebVTT字幕はこのリファレンス用に作った映像の説明です。台詞の書き起こしや翻訳ではありません。
ソースの音声は英語です。多言語の音声トラックは追加していません。

## 公式部品と追加部分の役割

| 部品・ファイル | 役割 |
| --- | --- |
| 公式の`UIFactory`レイアウト、`SeekBar` | 通常の再生操作、設定、シーク |
| 公式の`UIManager.timelineMarkers` | CMSの区間・章の範囲と名前をシークバーに表示 |
| 公式の`SubtitleOverlay`、`SubtitleSelectBox`、`AudioTrackSelectBox` | 字幕の描画、利用可能なトラックと選択状態の反映 |
| [viewer-data.ts](../src/viewer-data.ts) | 入力の検証、見どころの選択、履歴・設定・章の状態の導出 |
| [viewer-playback.ts](../src/viewer-playback.ts) | 明示操作で始めた区間再生、設定の適用・復元、古い非同期操作の解除 |
| [viewer-experience-view.ts](../src/viewer-experience-view.ts) | 用途のタブ、履歴例の選択、ボタン、状態、データ詳細 |
| [viewer-markers.ts](../src/viewer-markers.ts) | ミリ秒を公式マーカー用の秒へ変換し、この機能が追加したマーカーだけを更新 |
| [viewer-fixtures.ts](../src/viewer-fixtures.ts) | 編集者が決めた区間・章と、互いに独立した合成履歴の例 |

[create-player-ui.ts](../src/create-player-ui.ts)で公式レイアウトに追加部分を組み込んでいます。
シーク操作は公式のシークバーが担当します。用途のタブに合わせてマーカーを切り替えても、グラフの元の値は変えません。
公式UIの仕様は使用中のバージョンの[設定](https://github.com/bitmovin/bitmovin-player-ui/blob/v4.23.1/src/ts/UIConfig.ts)、
[音声選択](https://github.com/bitmovin/bitmovin-player-ui/blob/v4.23.1/src/ts/components/settings/AudioTrackSelectBox.ts)、
[字幕選択](https://github.com/bitmovin/bitmovin-player-ui/blob/v4.23.1/src/ts/components/settings/SubtitleSelectBox.ts)を参照してください。

## 表示値の求め方

| 型 | 内容 |
| --- | --- |
| `ViewerCatalog`、`ViewerSection` | コンテンツID、動画のバージョン（revision）、長さ、編集者が決めた章・区間、多言語の名前 |
| `ViewerHistoryInput`、`ViewerHistorySample` | 保存済み履歴の対象範囲、`asOf`、完全性、元のサンプルと最終番号、任意のトラック項目 |
| `ViewerHistory` | 記録がある範囲、記録にない範囲、続きの位置、前回の設定、利用状態 |

`startMs`と`endMs`は開始・終了位置をミリ秒単位で表します。

`selectHighlights(snapshot, catalog, budgetMs)`は、カタログとコンテンツID・revision・長さが一致する
合成または観測済みの見返し範囲の割合を受け取ります。Queryだけの区間到達件数からは見返し割合を求めません。
CMSの候補区間ごとに、次の値を計算します。

```text
score = sum(候補とバケットの重なり時間ms × bucket.replay) / 候補の長さms
```

重なるすべての集計区間（バケット）に観測の裏付けがあり、replayがnullでないことが条件です。
正のscoreで順位付けし、選択済みの候補と重なる区間や残り時間に収まらない区間は除きます。
選んだ区間を動画の順に並べ、`HighlightQueue.scores`へ判断と最小supportを残します。
supportは、その集計区間に視聴範囲がある記録数です。表には候補と重なる区間の最小値を示します。

| 標準`sparse`の候補 | 計算 | score | 最小support | 上限20秒での結果 |
| --- | --- | --- | --- | --- |
| 18–24秒 | `(2000×0.65 + 2000×0.8 + 2000×0.7) / 6000` | 約71.7% | 5 | 選択 |
| 40–46秒 | `(2000×0.5 + 2000×0.6 + 2000×0.55) / 6000` | 55% | 3 | 選択 |
| 28–34秒 | 重なるreplayがすべて0 | 0 | 4 | 見返しなし |

`deriveViewerHistory(input)`は、元の`sequence_number`と最終番号の記録を照合し、同じ再送を除いてから広告を外します。
内部の広告なしデータへ`client_time`、`state`、`played`、`seeked`、`videotime_start`、`videotime_end`を写し、
[既存の観測済みreplay計算](../src/observed-replay.ts)へ渡します。
元のサンプル値は変えません。内部データに付ける通し番号は、APIが返したsequence番号とは別です。
既存の計算が再生範囲と認めた区間だけを、個人の履歴へ加えます。

保存済みの例では各視聴の範囲をまとめるとミリ秒単位で`[0,32000]`と`[40000,46000]`になり、合計38秒です。
最新の妥当な再生サンプルは8–12秒なので、`resumeMs`は`12000`です。
完全な履歴では補集合の`[32000,40000]`と`[46000,60000]`を求めます。
`chapterProgress(history, catalog)`は15秒ずつの4章と記録範囲を重ね、各章の記録時間を15秒、15秒、7秒、1秒と求めます。

設定には`audio_language`、`subtitle_enabled`、`subtitle_language`の実値を持つ最新の広告以外のサンプルを使います。
`ViewerPreferences`では順に`string | null`、`boolean | null`、`string | null`で表します。
字幕の`false`はオフ、`null`は情報なしです。ブラウザーの`language`をトラックの設定へ流用しません。
Exportが文字列を返す場合は、入力用アダプターで明示的に変換してください。
`Boolean("false")`は`true`になるため使えません。
複数の視聴記録で最新サンプルの`client_time`が同じでも、位置・設定が食い違う場合は不明とします。
デモのクライアント時刻は比較できるように作ってあります。実際の端末間では時計のずれにより順序が逆転する場合があります。
本番のバックエンドで信頼できる順序の決め方を定め、順序が不明なら位置・設定の復元を見送ってください。

元の項目は公開の[Analytics fields](https://developer.bitmovin.com/playback/docs/analytics-api-fields)と
[impression sample model](https://bitmovin.github.io/bitmovin-api-sdk-python/_modules/bitmovin_api_sdk/models/analytics_impression_sample.html)で確認できます。
取得方法、単位、見返し割合の式は[計算とAnalyticsデータ](analytics-data.ja.md)と
[Observabilityデモガイド](live-demo-data.ja.md)を参照してください。

## アプリへ組み込む

次は対応するソースを読み込んだ標準デモで、ボタンへ割り当てる処理の例です。
各処理は明示的なボタン操作で呼び出してください。`playback`は`createPlayback`の戻り値、
`snapshot`はそのソースに対応する検証済みのデータ、`locale`は選択したUI言語の`"en"`または`"ja"`です。

```ts
import { deriveViewerHistory, selectHighlights } from "./src/viewer-data.ts";
import { VIEWER_CATALOG, VIEWER_HISTORY_EXAMPLES } from "./src/viewer-fixtures.ts";

const queue = selectHighlights(snapshot, VIEWER_CATALOG, 20_000);
const history = deriveViewerHistory(VIEWER_HISTORY_EXAMPLES[0].input);
playback.ui.setViewerMarkers(queue.items.map(clip => ({
  id: clip.id, startMs: clip.startMs, endMs: clip.endMs, title: clip.title[locale],
})));
playback.viewer.offerPreferences(history.preferences);
const playHighlights = () => queue.status === "ready"
  ? playback.viewer.startHighlights(queue.items) : Promise.resolve(false);
const stopHighlights = () => playback.viewer.stopHighlights();
const continueWatching = () => history.resumeMs !== null && history.status !== "completed"
  ? playback.viewer.playFrom(history.resumeMs) : Promise.resolve(false);
const applySettings = () => playback.viewer.restorePreferences(history.preferences);
const undoSettings = () => playback.viewer.undoPreferences();
```

画面との接続は[main.ts](../src/main.ts)と[viewer-experience-view.ts](../src/viewer-experience-view.ts)にあります。
別のアプリでは読み込んだコンテンツの一致を確認してから操作を許可し、履歴を変えたら候補の設定も更新してください。
Playerを破棄するときは、再生操作を管理するcontrollerも解放します。

本番では、バージョン付きの集計済みデータと編集者が決めた区間をCMSから配信します。
個人履歴は現在の視聴者に対する権限をバックエンドで確認して別に渡します。
アカウントAPIキー、加入者ID、ほかの視聴者の生データをブラウザーへ渡さないでください。
このデモには、そのバックエンドの実装は含まれていません。

`complete`では、権限を確認した保存済み履歴の対象範囲と`asOf`の時点に限って補集合を求めます。
その対象範囲や保存期間の外で視聴したことがない、と証明する値ではありません。
`partial`と`unavailable`では記録にない範囲を不明のまま残し、パケットが欠けている入力は拒否します。
付属の例はあらかじめ保存したデータです。現在の視聴を収集する機能や、本番用の履歴保存先ではありません。
