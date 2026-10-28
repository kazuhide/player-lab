<a id="sports-streaming-for-android"></a>
# Android向けスポーツ配信サンプル

[English](README.md) · [日本語](README.ja.md)

Bitmovin Playerを使い、ライブイベント、クリップ、アーカイブを扱う独立した実装です。標準Player UIとスポーツ向け操作UIは、同じPlayerとSourceを使用します。

<a id="requirements"></a>
## 必要な環境

- JDK 21、Android SDK Platform 37.0、Android SDK build tools。
- Android 7.0（API 24）以降の端末またはエミュレーター。
- `com.playerlab.sportsstreaming`を許可したBitmovin Playerライセンス。
- impression（計測セッション）の継続確認と再生品質データの収集には、Analyticsコレクターのライセンス。

Player、統合Analytics、標準Web UIは公開Android SDKの`3.172.0`に固定しています。Google CastにはSDKのCast managerとGoogle Cast Framework（CAF）を使います。Castでの再生には対応する受信機とその受信機から到達できるメディアURLが必要です。

<a id="local-configuration"></a>
## ローカル設定

このディレクトリから実行してください。

```sh
cp .env.example .env
```

`.env`に`BITMOVIN_PLAYER_LICENSE_KEY`を設定してください。統合コレクターを有効にするには`BITMOVIN_ANALYTICS_LICENSE_KEY`も設定します。両方の値がアプリに組み込まれるため、このサンプル用のライセンスを使ってください。このファイルにアカウントのAPIキーを置いてはいけません。アカウントのAPIキーはAnalytics照会用の専用サーバー（BFF）だけに保持します。

`MEDIA_BASE_URL`を基準に、このリファレンスのカタログと相対メディアURLを解決します。初期値の`http://10.0.2.2:8622/`ではAndroidエミュレーターから開発用コンピューターへ接続します。実機やCast受信機では同じネットワーク上で到達できるホストを使用してください。暗号化していないHTTPはdebugビルドだけで有効です。カタログの取得先は任意の`CATALOG_URL`設定で上書きできます。

設定ファイルはアプリごとに独立しています。他のアプリの環境設定やGradleプロジェクトは読み込みません。

<a id="build-and-unit-tests"></a>
## ビルドと単体テスト

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon --max-workers=2
```

debug APKは`app/build/outputs/apk/debug/app-debug.apk`、テストAPKは`app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`です。本リファレンスの`../fixtures/catalog.json`もアプリに含めます。素材の準備とローカルサーバーについては[リファレンスのREADME](../README.ja.md)を参照してください。

再生動作とUIの所有関係は[端末テスト](#reproducible-device-checks)で確認します。ドライバーはメディアと字幕の両方の素材を指定し、対象端末を一つ明示する必要があります。

<a id="controls-and-implementation"></a>
## 操作と実装

イベントまたはクリップを選ぶと再生を開始します。「アーカイブ」タブにはイベント側で公開済みとなったアーカイブを表示します。HLS／DASHの選択では新しいSourceを作成します。UIの切替では既存のPlayer、Source、位置、Analyticsのimpressionを維持します。スポーツUIにはシーク、字幕、速度、全画面表示、ピクチャーインピクチャーの操作があります。現在の状態で使用できない再生操作は無効になります。

ライブイベントが終了しても、アーカイブの準備中は再生を続けます。再生オプションから「アーカイブ」を開き、対象の選択、時刻対応を使った位置継続、先頭からの再生、自動継続の有効化を操作できます。自動継続は初期設定では無効です。一時停止中のセッションで位置を引き継いだ場合は、一時停止のままになります。ソースのロード要求が受け付けられただけでは、引継ぎ成功とは判断しません。

初期設定ではクリップからライブ端に戻ります。以前の位置に戻る操作は、配信サーバーがその位置を現在のシーク可能範囲内と報告している場合だけ表示します。アプリはシーク直前にSDKの範囲も再確認します。位置が範囲外になった場合、ライブ端や0秒で代用しません。

VODの位置はソースの先頭からの時間です。ライブのタイムシフト値はライブ端を0とする負のオフセットで、配信の進行に伴い変わります。負のライブオフセットをVODの開始位置としては使えません。アプリは公開仕様のオフセットでSDKの再生時刻をUTCへ変換し、確認済みの連続した時刻原点、または編集アーカイブ用の区間対応表を適用します。時刻対応が不明な場合やアーカイブの終端を理由に、再生を自動でやり直すことはありません。

標準UIとカスタムUIは[PlaybackSession.kt](app/src/main/java/com/playerlab/sportsstreaming/PlaybackSession.kt)の所有者を共有します。[PlayerSurfaceHost.kt](app/src/main/java/com/playerlab/sportsstreaming/PlayerSurfaceHost.kt)は古いViewを一時停止、停止、破棄する前にPlayerを切り離します。これらのライフサイクルメソッドは接続中のPlayerにも作用するためです。

両方の操作モードは同じネイティブ字幕描画を使います。補助CSSで標準HTML UIの字幕レイヤーを隠し、字幕の二重表示を防ぎます。一時停止中の操作UI切替やActivityの再生成でも、現在のネイティブ字幕を保持します。映像の終端では公開メソッド`setPlayer(player)`で字幕描画をリセットし、明示的なソースロードのたびに、致命的エラー後のイベント購読を復元します。

Castには`BitmovinCastManager.initialize()`と既定のCAF受信機を使います。受信機は明示的に選択する必要があります。メディアURLは受信機から到達できるものを使い、エミュレーター専用のアドレスは拒否します。受信機のソース、位置、再生／一時停止の状態はCAFのmedia statusで確認します。切断後はローカル再生を一時停止し、復帰方法を利用者に選んでもらいます。不明な受信位置は不明のままにします。受信機の品質データには受信機側のコレクターと、確認済みの識別方法が必要です。Android側のコレクターから推定しません。

<a id="reproducible-device-checks"></a>
## 端末テストの実行

Python 3.11以降とAndroid SDK build toolsが必要です。先にアプリAPKとテストAPKをビルドし、対象の端末を一つ指定してください。

```sh
python3 tools/check-instrumentation-classes.py
python3 tools/run-device-tests.py \
  --serial YOUR_DEVICE_SERIAL \
  --media-base-url https://YOUR_MEDIA_HOST/ \
  --captures --orientation both
```

既存の開発用サーバーで特定のADBクライアントやポートを使う場合は、`--adb PATH --adb-port PORT`を指定してください。ドライバーは端末を自動選択せず、端末やサーバーの起動・停止も行いません。未完了のインストールを確認し、インストール済みのbase APKのハッシュが一致すれば同じバイト列を再利用します。APKが変わった場合はインストール後に再照合します。split APKは受け付けません。機密情報を除いた記録は`build/device-tests/`に保存します。

標準の検証にはHLSとDASHの実再生、英語字幕の選択、初期値以外の速度、一時停止中と再生中のUI切替、ネイティブ字幕の文字描画、ソース選択の動作を含みます。`--captures`を付けると、実際の日英画面を撮影します。`--font-scale 1.3`は、本アプリだけで文字を拡大して確認する設定です。ネイティブ画面のキャプチャにはシステムバーを含めません。ウィンドウのコピーに独立した映像サーフェスが含まれない場合は、`--capture-method display`で合成済みの表示を撮影し、実際のアプリ領域で切り出してください。

debug専用のIntent／instrumentation引数`mediaBaseUrl`を使うと、ローカルライセンス入りAPKを再ビルドせずにメディアのホストを上書きできます。releaseビルドはこの設定を無視します。キャプチャと実行記録はビルド成果物として扱います。

Castは別途指定した場合だけ検証します。

```sh
python3 tools/run-device-tests.py \
  --serial YOUR_DEVICE_SERIAL \
  --media-base-url https://YOUR_RECEIVER_REACHABLE_HOST/ \
  --cast-receiver 'YOUR_AUTHORIZED_RECEIVER_NAME'
```

テストは表示名が完全一致する受信機だけを選びます。クリップ、ライブと巻き戻し、アーカイブ、再生／一時停止、切断復帰について、実際の受信機の状態が必要です。新しい通常イベントを開始し、短縮版のアーカイブが実時間で準備完了になるまで待ってください。必要な機器がない場合、受信機が見つからない場合、ストリームを使用できない場合は失敗します。模擬的な成功結果は作りません。この検証はガイドに記載したイベント全尺と温度の別検証を代替するものではありません。

準備済みのVOD（ビデオオンデマンド）ソースを使う場合、`CastPlaybackTest`に明示的なinstrumentation引数`-e vodOnly true`を指定できます。このモードはクリップ、受信機の再生／一時停止、アーカイブ、切断の確認を維持し、ライブと巻き戻しの処理を除きます。公開の端末テスト用ドライバーは常にすべての処理を含む既定のモードを使います。

<a id="normal-event-endurance-check"></a>
## 通常イベントの耐久試験

`EnduranceTest`は別途指定した場合だけ実行するテストです。このリファレンスのメディアサーバーで新しい通常イベントを開始してください。テストはその開始から最初の1分以内に参加する必要があります。温度を観測する場合は実機を使ってください。エミュレーターで機能は確認できますが、スマートフォンの温度特性は再現できません。

アプリAPKとテストAPKを一つの指定端末へビルド・インストールした後、配信サーバーを新しく起動するたびに、一つの配信形式を実行します。

```sh
adb -s YOUR_DEVICE_SERIAL shell am instrument -w -r \
  -e class com.playerlab.sportsstreaming.EnduranceTest \
  -e mediaBaseUrl https://YOUR_MEDIA_HOST/ \
  -e protocol HLS \
  -e expectedLiveAssetId SP-LIVE-EVENT \
  -e targetDurationSeconds 1800 \
  com.playerlab.sportsstreaming.test/androidx.test.runner.AndroidJUnitRunner
```

もう一方の形式には`DASH`を指定してください。`targetDurationSeconds`の範囲は1800〜7200です。最小値でも実時間での実行が必要で、素材の時計を早送りして短縮することはできません。短いイベントや、メディア時刻が実時間より速く進む配信サーバーは拒否します。画面のスリープ抑止は本アプリのウィンドウだけに設定し、終了後に元へ戻します。

テストでは実際の映像サーフェスの画素と再生時刻、ライブ端より前へのシーク、再生／一時停止を確認し、保存したUTCが配信サーバーの保持範囲を外れるまで実際に一時停止します。ライブ端へ明示的に戻る前に最新のSDKの範囲を読み取り、同じSourceとimpressionを維持します。イベント終端付近では位置を一時停止したまま保持し、ソースを再ロードせずにイベント終了とアーカイブ準備完了が別状態になっていることを確認します。その後、対応するアーカイブ位置、一時停止の指定、新しいimpressionを確認します。SDKがライブから終了済みプレイリストへ移る挙動は、観測した値を記録します。

テスト後、本アプリの件数上限付きの記録を取得します。

```sh
adb -s YOUR_DEVICE_SERIAL exec-out run-as com.playerlab.sportsstreaming \
  cat files/endurance/hls.json > hls-endurance.json
```

DASHでは`dash.json`を取得してください。記録には最大200件の観測、実経過時間、ライブ中／プレイリスト終了後／アーカイブでの時刻の進行、変化した映像フレーム、本プロセスのメモリ、取得可能な端末の温度状態を保存します。一時停止区間も手順に含むため、テストの経過時間はライブを連続視聴した時間とは異なります。これらの観測だけではメモリリークの不在を確認できず、受信機の品質や温度特性も保証しません。クラッシュで記録を書けなくなった場合でも、プロセスのクラッシュはinstrumentationの失敗になります。

映像サンプルは実際の`SurfaceView`にAndroidの[PixelCopy](https://developer.android.com/reference/android/view/PixelCopy)を使って取得します。温度状態はAndroid 10以降の[PowerManager](https://developer.android.com/reference/android/os/PowerManager#getCurrentThermalStatus())から読み取り、古いバージョンでは取得不可と記録します。

<a id="sdk-references"></a>
## SDKの参照先

- [Android Player API](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api/-player/index.html)
- [再生タイムスタンプの変換](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api/-player/current-time.html)
- [Sourceの開始オフセット](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.source/-source-options/start-offset.html)
- [CAFの設定と受信機の動作](https://developer.bitmovin.com/playback/docs/caf-support)
