<a id="sports-streaming-reference"></a>
# スポーツ配信リファレンス

[English](README.md) · [日本語](README.ja.md) · [実装ガイド](docs/implementation.ja.md) · [分析Web](analytics-web/README.ja.md)

Bitmovin Playerでライブイベント、クリップ、録画アーカイブを再生する独立したAndroidサンプルです。SDK標準のWeb UIとネイティブのスポーツ向け操作UIを比較し、クリップからライブへ戻る操作や、準備済みアーカイブへの視聴継続を試せます。

ライブのSourceが有限の映像になっても、再生時刻の原点が0に変わるとは限りません。WebとAndroidでは時刻APIも異なります。Unix時刻、相対位置、アーカイブへ位置を引き継ぐ条件は[時刻APIの比較](docs/implementation.ja.md#playback-position-and-unix-time)を参照してください。

Google CastにはSDKのリモート操作機能を使います。

アプリ、Gradleラッパー、設定、素材、メディア配信サーバー、分析Webはこのディレクトリ内で完結します。他のPlayer Labアプリや共通ビルド成果物は不要です。

[再生からAnalyticsでの確認まで](docs/analytics.ja.md)では、クリップのデータ収集、Bitmovin Dashboardでの確認、ローカル画面での取得を順に説明しています。

<a id="requirements-and-configuration"></a>
## 必要な環境と設定

JDK 21、Android SDK platform 37、build tools 36.0.0を使用します。Androidアプリの動作環境はAndroid 7.0以降です。Player SDKは統合Analyticsコレクターを含む**3.172.0**に固定しています。

```sh
cp android/.env.example android/.env
```

`android/.env`の`BITMOVIN_PLAYER_LICENSE_KEY`には`com.playerlab.sportsstreaming`を許可したPlayerライセンスを設定してください。再生データを収集する場合は`BITMOVIN_ANALYTICS_LICENSE_KEY`も設定します。本アプリ専用の設定ファイルを読み込み、このディレクトリ外の環境設定ファイルは読み込みません。

`MEDIA_BASE_URL`はメディアの配信元です。初期値の`http://10.0.2.2:8622/`ではAndroidエミュレーターから開発用コンピューターの配信サーバーへ接続します。実機のスマートフォンやCast受信機では同じメディアパスを提供し、それぞれから到達できるHTTPS配信元を指定してください。受信機からスマートフォンやエミュレーターのlocalhostへは接続できません。`CATALOG_URL`には本アプリ用に準備したカタログを指定できます。省略すると、メディア配信元の`catalog.json`を取得します。

「Analytics」ボタンは`ANALYTICS_URL`を開きます。初期値は`http://localhost:9052/`です。[分析Webサーバー](analytics-web/README.ja.md)を起動し、対象のスマートフォンまたはエミュレーターへポートを転送してください。

```sh
adb -s DEVICE_SERIAL reverse tcp:9052 tcp:9052
```

Androidブラウザーのlocalhostを、このコンピューターのサーバーへ接続する設定です。サーバーはlocalhostのオリジンだけを受け付けます。使用後は`adb -s DEVICE_SERIAL reverse --remove tcp:9052`で転送を解除してください。

ビルド時の設定を変えたら、アプリを再ビルドしてください。PlayerとコレクターのライセンスはAPKに含まれます。デモ専用ライセンスを使い、許可するアプリをライセンスの許可リストに登録してください。アカウントのAPIキーを置くのは分析サーバーだけです。

<a id="prepare-media-and-run"></a>
## 素材の準備と起動

ローカルの開発用配信サーバーにはPython 3.9以降と、`drawtext`フィルターを含むFFmpegを使います。このリファレンス専用の自作映像を生成し、配信サーバーを起動したままにします。

```sh
python3 tools/media/media.py generate
python3 tools/media/media.py serve
```

インストール済みのFFmpegに`drawtext`がない場合は、`FFMPEG_BIN`で対応する実行ファイルを指定してください。例えば、macOSのHomebrewで`ffmpeg-full`を導入している場合は、生成コマンドの前に`FFMPEG_BIN="$(brew --prefix ffmpeg-full)/bin/ffmpeg"`を付けて使用できます。

別のターミナルで実行します。

```sh
cd android
./gradlew :app:assembleDebug
adb -s DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s DEVICE_SERIAL shell am start -n com.playerlab.sportsstreaming/.MainActivity
```

短縮イベントは配信サーバーの起動から実時間で3分間続きます。イベントが終了した後、別の状態遷移としてアーカイブが準備完了になります。通常イベントは実時間で30分間続きます。新しい開発用の配信を始めるにはサーバーを再起動してください。時計を早送りするシナリオは耐久試験にはなりません。[素材と配信の説明](docs/fixtures.ja.md)も参照してください。

<a id="try-playback"></a>
## 再生を試す

イベント、クリップ、準備済みアーカイブの一覧を見るだけでは再生は始まりません。映像を選ぶとロードします。HLSとDASHはソースをロードする前に選択してください。標準UIとスポーツUIは再生中にも切り替えられ、Player、Source、位置、速度、字幕選択、Analyticsのimpression（計測セッション）を維持します。

| 標準UI | スポーツUI |
| --- | --- |
| <img src="docs/screenshots/standard-ui-ja.png" width="300" alt="標準Player UIによるクリップ再生"> | <img src="docs/screenshots/sports-ui-ja.png" width="300" alt="ネイティブのスポーツ向け操作UIによるクリップ再生"> |

スポーツUIでは再生／一時停止、短い区間のシーク、字幕と速度の選択、ライブ端への復帰を操作できます。ライブのシークは操作を実行する時点のシーク可能範囲を確認します。クリップへ移る前の位置に戻る操作もその位置がシーク可能な間だけ表示します。

Androidタブレットのエミュレーターで撮影した横向き画面です。映像と映像一覧を左右に配置し、操作UIも画面内に表示します。映像を大きく表示するには全画面表示を使用してください。

<img src="docs/screenshots/sports-ui-landscape-ja.png" width="760" alt="Androidタブレットで映像一覧の横にスポーツ向け操作UIを表示した横向き画面">

イベント終了とアーカイブ準備完了は別の状態です。終了通知を受けても、現在の再生は続けます。アーカイブへの視聴継続は、初期設定では利用者が明示的に選択します。自動継続には、確認済みの時刻対応が必要です。対応が不明な場合や期限切れの場合に、0秒で代用してはいけません。有効な位置引継ぎが完了した後も、一時停止していた再生は一時停止のままです。

Castでは受信機を選び、実際に受信機が再生している映像、位置、状態を確認してください。受信機アプリに接続しただけでは再生成功を確認したことにはなりません。受信位置が不明な場合は再開位置を作らず、スマートフォンへの復帰方法を利用者が選びます。

<a id="check-and-inspect"></a>
## 動作確認と記録

端末テスト用ドライバーにはPython 3.11以降が必要です。`--serial`で指定した端末だけを対象とし、エミュレーターの起動やADBサーバーの再起動は行いません。

```sh
python3 -B -m unittest discover -s tools/media -p 'test_*.py'
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
python3.11 tools/check-instrumentation-classes.py
```

HLSとDASHの実再生を確認する場合は配信サーバーを起動したままにし、ライセンスと配信到達性を確認した上で、`android`ディレクトリから実行します。

```sh
python3.11 tools/run-device-tests.py \
  --serial DEVICE_SERIAL \
  --media-base-url https://media.example/ \
  --captures --orientation both
```

例の配信元は自分の配信元に置き換えてください。ドライバーは実行件数とAPKのハッシュを記録します。Castは別途指定する検証で、正確な受信機名が必要です。[端末テストの説明](android/README.ja.md#reproducible-device-checks)を参照してください。端末テスト一式では、実際のimpressionが継続していることを確認するためにAnalyticsライセンスも必要です。アプリ自体はAnalyticsを無効にしても動作します。[検証記録](docs/validation.ja.md)ではビルド、端末再生、実時間の実行、Cast受信機での再生、クラウド素材準備の結果を分けています。

[再生品質ダッシュボード](analytics-web/README.ja.md)には[キー不要のデモ](analytics-web/README.ja.md#demo-data)と、取得ボタンで問い合わせる[実測データの画面](analytics-web/README.ja.md#measured-data)があります。
