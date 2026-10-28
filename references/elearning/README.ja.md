# 学習用リファレンス

[English](README.md) · [実装ガイド](docs/implementation.md) · [再生品質の分析Web](analytics-dashboard/README.md)

Bitmovin Playerを使ったAndroidの学習用サンプルです。教材の選択、字幕と本文の検索、連続再生、利用者ごとの途中再開を試せます。再生中に標準Web UIと学習用のネイティブUIを切り替えられます。

アプリ、設定、Gradle wrapper、素材、分析Webはこのディレクトリ内にあります。このディレクトリをコピーして個別にビルドできます。

## 起動の準備

JDK 21、Android SDK platform 37、build tools 36.0.0を使います。再生にはAndroid 6.0以降の端末または仮想端末が必要です。Player SDKは3.172.0に固定しています。

このディレクトリで設定ファイルを作成してください。

```sh
cp android/.env.example android/.env
```

`android/.env`の`BITMOVIN_PLAYER_LICENSE_KEY`にPlayerキーを設定し、そのライセンスのAndroid許可リストに`com.playerlab.elearning`を追加してください。再生品質を収集する場合は、別製品であるAnalyticsの`BITMOVIN_ANALYTICS_LICENSE_KEY`も設定します。

親ディレクトリの`.env`は自動では読み込みません。設定を変えたら再ビルドしてください。ライセンスキーはAPK（Androidアプリのインストール用ファイル）に含まれるため、配布には専用のデモ用ライセンスを使ってください。アカウントの管理APIキーは分析Webのサーバー側にだけ保存します。

`MEDIA_BASE_URL`は素材の配信元です。初期値の`http://10.0.2.2:8621/`はAndroid仮想端末からこのコンピューターへ接続するためのアドレスです。実機では、その端末から到達できるHTTPSの配信元を指定してください。

## 素材を用意して起動する

ローカル素材の生成にはPython 3.9以降と、`drawtext`フィルターを含むFFmpegが必要です。

```sh
python3 tools/media/media.py generate
python3 tools/media/media.py serve
```

素材サーバーは起動したままにします。macOSのHomebrew版FFmpegで`drawtext`が使えない場合は、`ffmpeg-full`などの対応ビルドを`FFMPEG_BIN`で指定できます。

```sh
FFMPEG_BIN="$(brew --prefix ffmpeg-full)/bin/ffmpeg" python3 tools/media/media.py generate
```

別のターミナルでビルドし、操作する端末を指定してインストールしてください。

```sh
cd android
./gradlew :app:assembleDebug
adb -s DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s DEVICE_SERIAL shell am start -n com.playerlab.elearning/.MainActivity
```

## 画面と操作

コース画面で教材と配信形式を選びます。「連続再生」は教材を開く前に選択してください。オンでは選んだ教材以降を順に再生し、オフではその教材だけを再生します。一覧を見ているだけでは再生しません。

<img src="docs/screenshots/course-ja.png" width="300" alt="教材一覧、続きからの再開、配信形式、字幕の読み込み元を選ぶコース画面">

再生画面では標準UIと学習UIを切り替えられます。教材、位置、再生・一時停止、字幕、速度を維持します。どちらのUIからも教材一覧と本文を開けます。

本文は字幕をオフにしていても検索できます。検索結果を選ぶと、その行の開始位置へ移動します。字幕はオフのままです。

| 標準UI | 学習UI |
| --- | --- |
| <img src="docs/screenshots/standard-ui-ja.png" width="300" alt="標準Player UIと映像の下の本文"> | <img src="docs/screenshots/learning-ui-ja.png" width="300" alt="日本語字幕と対応する本文を表示した学習用UI"> |

「その他」から「診断ログ」を開くと再生イベントを確認できます。字幕や映像の読み込みに失敗した場合は、再試行するか教材一覧へ戻れます。取得先のURLは画面やログへ表示しません。

途中の位置はデモ利用者A・Bと教材ごとに端末へ保存します。「続きから」を選ぶと保存した位置から再開できます。利用者を切り替えると、PlayerとAnalyticsのセッションも切り替わります。これは端末内の再開機能であり、受講完了の判定や複数端末の学習記録ではありません。

素材は自作の数直線教材です。HLSとDASHで同じ教材IDを使い、日英字幕のある教材と字幕のないまとめを用意しています。長い教材では12分34秒からの再開も試せます。[素材の説明](docs/fixtures.md)に尺と検証条件を記載しています。

## ビルドとテスト

```sh
python3 -B -m unittest discover -s tools/media -p 'test_*.py'
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

ビルド、端末での再生、実際のAnalytics照会、クラウドからの配信は、それぞれ異なる確認です。[検証結果](docs/validation.md)に対象と実行条件を記載しています。

素材へ接続できる端末でのテストには専用ドライバーを使えます。端末を明示し、HLSとDASHの再生・操作・プロセス終了後の再開を確認します。実行時はこのアプリを終了・再起動します。

```sh
cd android
python3 scripts/run-device-tests.py --serial DEVICE_SERIAL \
  --media-base-url https://media.example/ --stream-format both
```

`DEVICE_SERIAL`は対象端末の識別子、`https://media.example/`は実際の素材配信元に置き換えてください。ログとAPKのハッシュはGit管理対象外の`android/build/device-tests/`へ保存します。

再生品質の分析にはこのアプリ専用の[分析Webの設定手順](analytics-dashboard/README.md)を参照してください。分析WebにはNode.js 24.19.0が必要です。画面は日英に対応しています。
