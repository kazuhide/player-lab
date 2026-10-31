# 教材の再生データをAnalyticsで確認する

[English](analytics.md) · [日本語](analytics.ja.md)

Androidで再生した教材のデータを、Bitmovin Dashboardと本リファレンスのローカルダッシュボードで確認する手順です。Androidのコレクターが再生イベントを送信し、ローカルサーバーは収集済みのデータを照会します。アカウントやAndroidのビルドを用意せずに画面を試す場合は、[キー不要のデモ](../analytics-dashboard/README.ja.md#demo-data)を利用してください。

<a id="configure-android"></a>
## Androidを設定する

[Androidの設定と起動](../README.ja.md#configure-and-run-android)に従い、素材の準備、`android/.env`の作成、アプリのビルドとインストールを行ってください。キーの用途は次のとおりです。

| 設定 | 使用する場所 | 用途 |
| --- | --- | --- |
| `BITMOVIN_PLAYER_LICENSE_KEY` | `android/.env` | `com.playerlab.elearning`でのPlayer再生を許可する。 |
| `BITMOVIN_ANALYTICS_LICENSE_KEY` | `android/.env`と`analytics-dashboard/.env` | Androidでデータを収集し、ローカル照会でも同じライセンスのデータを指定する。 |
| `BITMOVIN_API_KEY` | `analytics-dashboard/.env`のみ | そのAnalyticsライセンスを持つアカウントで、サーバーからAnalyticsを照会する。 |

PlayerとAnalyticsの両方のライセンスで`com.playerlab.elearning`を許可してください。AnalyticsのライセンスはBitmovin Dashboardの「Observability」から「Licenses」を開くと確認できます。[公式のライセンス設定](https://developer.bitmovin.com/playback/docs/setup-analytics)も参照してください。サンプル用のライセンスを使います。AndroidアプリにはPlayerとAnalyticsのライセンスが含まれますが、アカウントのAPIキーを置くのはローカルサーバーだけです。

それぞれの`.env`は独立しています。Androidのビルドは分析サーバーのファイルを読み込まず、分析サーバーもAndroidのファイルを読み込みません。Androidのキーを変更したら再ビルドしてインストールし、サーバーの設定を変更したら再起動してください。Analyticsが無効でも再生できるため、再生の成功だけではデータ収集が有効かどうかは分かりません。

<a id="play-a-known-lesson"></a>
## 確認する教材を再生する

コースから「数直線の基本」を開き、映像が動いて再生位置が進むことを確認してから一時停止してください。再生した時刻も控えます。教材一覧を見るだけでは再生セッションは始まりません。

<img src="screenshots/learning-ui-ja.png" width="300" alt="学習用の操作UIと本文を表示した数直線教材の再生画面">

同梱の[カタログ](../fixtures/catalog.json)と[ダッシュボードの設定](../analytics-dashboard/config.mjs)では、次のIDを使います。

| 教材 | Analyticsの`VIDEO_ID` |
| --- | --- |
| 数直線の基本 | `EDU-FX-01` |
| 数直線の練習 | `EDU-FX-02` |
| まとめ | `EDU-FX-03` |

HLSとDASHで教材のIDは共通です。再生の開始方法は別の項目で、一覧から開く操作や途中再開は`CUSTOM_DATA_1 = catalog`、自動で次の教材へ進む場合も含めた教材の前後移動は`playlist`になります。これはデモ利用者A・Bの区別ではありません。ローカルダッシュボードの「再生の開始方法」は、この項目で絞り込みます。

<a id="find-the-playback-in-bitmovin-dashboard"></a>
## Bitmovin Dashboardで確認する

1. Analyticsライセンスを持つアカウントで[Bitmovin Dashboard](https://dashboard.bitmovin.com/analytics)を開いてください。
2. Androidに設定したものと同じAnalyticsライセンスを選び、控えた再生時刻を含む期間を指定してください。
3. AndroidとVideo ID `EDU-FX-01`で絞り込み、再生開始数、開始待ち時間、再バッファを確認してください。

画面を比較するときはタイムゾーンも合わせてください。ローカルダッシュボードの時刻表示と期間の手入力は、協定世界時（UTC）です。例えば日本時間の12:00はUTCの03:00です。「過去24時間」の終了は現在の分の先頭になります。収集したイベントの反映には時間がかかる場合があります。取得時刻は応答を受信した時刻であり、最新の再生イベントの時刻ではありません。

Dashboardの指標は[公式の指標定義](https://developer.bitmovin.com/playback/docs/analytics-dashboard-metrics-reference)、ローカル画面の集計方法は[取得できるデータ](../analytics-dashboard/README.ja.md#available-data)を参照してください。同じ指標、ライセンス、期間、絞り込み条件で比較します。

<a id="fetch-the-same-data-locally"></a>
## ローカルの実測画面で取得する

ダッシュボードの[実測データの設定](../analytics-dashboard/README.ja.md#measured-data)に従い、`analytics-dashboard/.env`にアカウントのAPIキーと同じAnalyticsライセンスを設定して、サーバーを起動してください。設定ファイルの作成と起動コマンドはリンク先にあります。APIキーにはAnalyticsを照会する権限が必要です。

開発用コンピューターで`http://127.0.0.1:9051/#measured`を開き、「過去24時間」、教材「数直線の基本」、再生の開始方法「すべて」を選んで「取得する」を押してください。画面を開いたり条件を変えたりするだけでは照会しません。新しい結果を取得するには、もう一度「取得する」を押します。

実測の照会対象はAndroidと設定済みの教材IDです。アカウント内のすべての映像を照会したり、再生イベントを作成したりはしません。「デモデータ」は架空のセッションで、アカウントの計測結果には加算されません。最初は開始方法を「すべて」にし、結果を確認してから実際に教材を開いた方法へ絞り込んでください。

<a id="when-results-are-missing"></a>
## データが見つからない場合

| 状態 | 確認すること |
| --- | --- |
| Androidで再生できない | [Androidの設定](../README.ja.md#configure-and-run-android)で、Playerキー、アプリIDの許可、素材への接続を確認してください。設定変更後は再ビルドとインストールが必要です。 |
| 再生できるがDashboardにデータがない | AndroidのAnalyticsキーと、そのライセンスでのアプリIDの許可を確認してください。端末が収集先へ接続できるかを確認し、アプリの[診断ログ](../README.ja.md#try-the-learning-flow)も参照してください。 |
| Dashboardにデータがあるがローカルで取得できない | `analytics-dashboard/.env`のアカウントAPIキーとAnalyticsキーを確認し、そのサーバーを再起動してください。Androidの`.env`では設定できません。 |
| ローカルの照会は成功するがデータがない | Analyticsライセンス、期間、Video IDを合わせ、再生の開始方法は「すべて」から確認してください。ダッシュボードの設定に含まれない独自の教材IDは照会対象外です。 |
| 直前の再生だけが表示されない | 収集結果の反映と、指定期間にその再生時刻が含まれるのを待ってから、再度取得してください。未収集のデータをゼロで補うことはありません。 |
| 照会に失敗する、または一部しか取得できない | 表示された状態を読み、APIの権限と接続を確認してください。部分取得やタイムアウトの場合は、期間を短くして再度取得してください。照会回数の制限では、画面に表示された再試行時刻まで待ちます。前回の成功結果を残す場合は、その旨を表示します。 |

有効なゼロ、データなし、照会失敗は異なる状態です。[ダッシュボードの説明](../analytics-dashboard/README.ja.md)に、表示とサーバーの照会上限を記載しています。
