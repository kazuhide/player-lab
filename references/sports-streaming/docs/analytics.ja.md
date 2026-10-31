# スポーツ映像の再生データをAnalyticsで確認する

[English](analytics.md) · [日本語](analytics.ja.md)

Androidアプリの再生データを、Bitmovin Dashboardとローカルダッシュボードで確認する手順です。Androidのコレクターが再生イベントを送信し、ローカルサーバーは収集済みのデータを照会します。Androidのビルドやアカウントの設定なしで画面を試す場合は、[キー不要のデモ](../analytics-web/README.ja.md#demo-data)を利用してください。

<a id="configure-android"></a>
## Androidを設定する

[必要な環境と設定](../README.ja.md#requirements-and-configuration)と[素材の準備と起動](../README.ja.md#prepare-media-and-run)に従い、`android/.env`の作成、接続できる素材の準備、アプリのビルドとインストールを行ってください。

| 設定 | 使用する場所 | 用途 |
| --- | --- | --- |
| `BITMOVIN_PLAYER_LICENSE_KEY` | `android/.env` | `com.playerlab.sportsstreaming`でのPlayer再生を許可する。 |
| `BITMOVIN_ANALYTICS_LICENSE_KEY` | `android/.env`と`analytics-web/.env` | Androidでデータを収集し、ローカル照会でも同じライセンスのデータを指定する。 |
| `BITMOVIN_API_KEY` | `analytics-web/.env`のみ | そのAnalyticsライセンスを持つアカウントで、サーバーからAnalyticsを照会する。 |

PlayerとAnalyticsの両方のライセンスで`com.playerlab.sportsstreaming`を許可してください。AnalyticsのライセンスはBitmovin Dashboardの「Observability」から「Licenses」を開くと確認できます。[公式のライセンス設定](https://developer.bitmovin.com/playback/docs/setup-analytics)も参照してください。サンプル用のライセンスを使います。AndroidアプリにはPlayerとAnalyticsのライセンスが含まれます。アカウントのAPIキーはローカルサーバーだけに保存してください。

Androidのビルドと分析サーバーは、それぞれ専用の`.env`を読み込みます。相手側の設定ファイルは使いません。Androidのキーを変更したら再ビルドしてインストールし、ローカルサーバーの設定を変更したら再起動してください。データ収集が無効でも再生できるため、映像が再生できたことだけではAnalyticsの設定を確認できません。

Androidの設定はプロセスの環境変数、`android/.env`、既定値の順に優先します。Nodeサーバーも引き継いだ`BITMOVIN_API_KEY`と`BITMOVIN_ANALYTICS_LICENSE_KEY`を`analytics-web/.env`より優先します。ファイルを編集しても反映されない場合は、優先される環境変数を解除するか同じ値にそろえてから、再ビルドや再起動を行ってください。サーバーを再起動するだけでは、export済みの値は解除されません。値を表示せずに、上書きする設定の有無と設定元を確認してください。

<a id="play-a-known-clip"></a>
## 確認するクリップを再生する

「クリップ」から「序盤のクリップ」を選び、映像が動いて再生位置が進むことを確認してから一時停止してください。再生した時刻も控えます。このクリップはライブイベントの終了を待たずに利用できます。映像一覧を見るだけでは再生セッションは始まりません。

<img src="screenshots/standard-ui-ja.png" width="300" alt="標準Player UIで序盤のクリップを再生した画面">

アプリとローカルダッシュボードでは、同じVideo IDの映像に異なる表示名を使います。

| アプリの映像名 | ローカル画面の映像名 | Analyticsの`VIDEO_ID` |
| --- | --- | --- |
| 序盤のクリップ | クリップA | `sports:SP-CLIP-A` |
| 短い練習試合 | 短縮Live | `sports:SP-LIVE-S` |
| 練習試合の録画 | 短縮アーカイブ | `sports:SP-ARCH-S` |

`sports:`もVideo IDの一部です。HLSとDASHでIDは共通です。全項目は[カタログ](../fixtures/catalog.json)と[ダッシュボードの設定](../analytics-web/config.mjs)にあります。ローカル画面の「映像の種類」はLive、クリップ、アーカイブに該当する既知のIDを選択します。Analyticsの別のcustom data項目で絞り込むものではありません。

<a id="find-the-playback-in-bitmovin-dashboard"></a>
## Bitmovin Dashboardで確認する

1. Analyticsライセンスを持つアカウントで[Bitmovin Dashboard](https://dashboard.bitmovin.com/observability/home)を開いてください。
2. Androidに設定したものと同じAnalyticsライセンスを選び、控えた再生時刻を含む期間を指定してください。
3. AndroidとVideo ID `sports:SP-CLIP-A`で絞り込み、再生開始数、開始待ち時間、再バッファを確認してください。

ローカルダッシュボードの時刻表示と期間の手入力は、協定世界時（UTC）です。例えば日本時間の12:00はUTCの03:00です。画面を比較するときはタイムゾーンも合わせてください。「過去24時間」の終了は現在の分の先頭になります。収集直後のイベントはまだ表示されない場合があります。取得時刻はサーバーが応答を受信した時刻であり、最新の再生イベントの時刻ではありません。

[公式の指標定義](https://developer.bitmovin.com/playback/docs/analytics-dashboard-metrics-reference)とローカルの[集計方法](../analytics-web/README.ja.md#playback-quality)を参照し、同じ指標、ライセンス、期間、絞り込み条件で比較してください。

<a id="fetch-the-same-data-locally"></a>
## ローカルの実測画面で取得する

[実測データの設定](../analytics-web/README.ja.md#measured-data)に従い、`analytics-web/.env`にアカウントのAPIキーと同じAnalyticsライセンスを設定して、サーバーを起動してください。設定と起動コマンドはリンク先にあります。APIキーにはAnalyticsを照会する権限が必要です。

開発用コンピューターで`http://127.0.0.1:9052/#measured`を開き、「過去24時間」、映像「クリップA」、映像の種類「すべて」を選んで「取得する」を押してください。画面を開いたり条件を変えたりするだけでは照会せず、取得操作のたびに新しい結果を要求します。代わりにAndroidの「Analytics」メニューから開く場合は、[ADBのポート転送](../README.ja.md#requirements-and-configuration)を設定してください。

照会対象はAndroidと設定済みの`sports:SP-*`のVideo IDです。取得操作でイベントを収集したり、再生セッションを作成したりはしません。「デモデータ」は架空のセッションで、アカウントの計測結果には加算されません。

最初の確認ではAndroid端末上で再生します。Cast受信機の再生品質を調べるには、受信機側のコレクターと対応するメタデータの確認が必要です。Android送信側のデータだけでは、受信機の開始待ち時間、再バッファ、エラーを確認できません。

<a id="when-results-are-missing"></a>
## データが見つからない場合

| 状態 | 確認すること |
| --- | --- |
| Androidで再生できない | [Androidの設定](../README.ja.md#requirements-and-configuration)で、Playerキー、アプリIDの許可、素材への接続を確認してください。設定変更後は再ビルドとインストールが必要です。 |
| 再生できるがDashboardにデータがない | AndroidのAnalyticsキーと、そのライセンスでのアプリIDの許可を確認してください。端末が収集先へ接続できるかを調べ、「その他」から「診断」を開いて収集設定も確認してください。 |
| Dashboardにデータがあるがローカルで取得できない | `analytics-web/.env`のアカウントAPIキーとAnalyticsキーを確認し、そのサーバーを再起動してください。Androidの`.env`では設定できません。 |
| ローカルの照会は成功するがデータがない | Analyticsライセンス、期間、`sports:`を含むVideo IDを合わせ、映像の種類は「すべて」から確認してください。照会するのはダッシュボードの設定にあるIDだけです。 |
| 直前の再生だけが表示されない | 収集結果の反映と、指定期間にその再生時刻が含まれるのを待ってから、再度取得してください。未取得の値をゼロで補うことはありません。 |
| 照会に失敗する、または一部しか取得できない | 表示された状態を読み、APIの権限と接続を確認してください。部分取得やタイムアウトの場合は、期間を短くして再度取得してください。照会回数の制限では、画面に表示された再試行時刻まで待ちます。前回の成功結果を残す場合は、その旨を表示します。 |

有効なゼロ、データなし、照会失敗は異なる状態です。[ダッシュボードの説明](../analytics-web/README.ja.md)に、表示とサーバーの照会上限を記載しています。
