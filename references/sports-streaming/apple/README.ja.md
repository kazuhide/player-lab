# iPhone・iPad・Apple TV で試合を再生する

[English](README.md) · [日本語](README.ja.md)

Xcode と XcodeGen を用意し、[このアプリの起動手順](../README.ja.md)に従って素材サーバーを起動してください。iOS と tvOS は同じカタログから HLS 素材を読み込みます。

このディレクトリの `Local.xcconfig.example` を `Local.xcconfig` にコピーしてください。ファイルがない場合は XcodeGen が生成します。Player ライセンスでは `com.playerlab.sportsstreaming.ios` と `com.playerlab.sportsstreaming.tvos` を許可します。Analytics ライセンスを追加すると、統合コレクターがカタログの映像 ID を使って計測します。どちらのライセンスもビルドしたアプリに含まれるため、デモ用のものを使ってください。

```xcconfig
BITMOVIN_PLAYER_LICENSE_KEY = your-player-license
BITMOVIN_ANALYTICS_LICENSE_KEY =
```

シミュレーターは `http://127.0.0.1:8622/` に接続します。実機では、端末から接続できる HTTPS の配信元を `MEDIA_BASE_URL` に設定し、末尾にスラッシュを付けてください。`Local.xcconfig` での記入例は `MEDIA_BASE_URL = https:/$()/media.example/` です。Xcode が `$()` を空文字列に置き換えます。

このディレクトリでプロジェクトを生成し、再生ロジックのテストと両ターゲットのビルドを実行します。

```sh
xcodegen generate
swift test
xcodebuild -project Sports.xcodeproj -scheme Sports-iOS -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project Sports.xcodeproj -scheme Sports-tvOS -destination 'generic/platform=tvOS Simulator' CODE_SIGNING_ALLOWED=NO build
open Sports.xcodeproj
```

Xcode で iOS または tvOS のスキームとシミュレーターを選び、Run を実行してください。実機にインストールする場合は署名用の開発チームを選び、使うバンドル ID をライセンスで許可してください。UI テストは素材サーバーを起動してから Product メニューの Test を実行します。

イベントを選び、ライブ、クリップ、準備済みの録画から見たい映像を開きます。スポーツ用UIでは再生、一時停止、15秒送りと15秒戻しができます。クリップからライブの最新位置に戻れます。元の視聴位置がまだDVRの範囲内なら、その位置にも戻れます。「引き継ぎ先の録画」で全編録画か編集版を選びます。初期状態では全編録画が選ばれています。見ていた時刻が選んだ録画に含まれていれば、その位置から再生できます。編集でカットされた時刻にいた場合は、DVR での視聴を続けるか、「録画の最初から再生」を選んでください。自動で引き継ぐには、事前に自動継続をオンにし、イベントが終了して録画の準備ができている必要があります。録画の先頭から再生することもできます。

iOS の標準画面は SDK の Web UI を使います。Apple TV ではシステム標準のコントロールを Siri Remote で操作します。どちらも再生中にアプリの操作画面へ切り替えられます。アプリの操作画面と tvOS の標準画面では、SDK が通知する字幕キューを使って外部字幕を表示します。iOS では AirPlay の出力先も選べます。

「録画への引き継ぎ記録」で、アプリを開いてからライブの視聴時刻を録画の位置に対応づけたリクエストを直近200件まで確認できます。引き継ぎが確定した行には、再生元、再生位置、再生または一時停止の状態が入ります。再生中の引き継ぎは、移動先で再生時刻が進んだことも確認します。結果が未確認の行では確認結果が `null` になり、受信機の品質指標はすべての行で `null` です。iOS では「JSON を共有」でファイルを保存できます。Apple TV では同じ JSON が画面に表示されます。

受信機への引き継ぎやピクチャ・イン・ピクチャの利用条件は、端末とシステムの再生画面によって異なります。アプリ独自のピクチャ・イン・ピクチャボタンはありません。
