# iPhone・iPad・Apple TV で試合を再生する

[English](README.md) · [日本語](README.ja.md)

Xcode と XcodeGen を用意し、[このアプリの起動手順](../README.ja.md)に従って素材サーバーを起動してください。iOS と tvOS は同じカタログから HLS 素材を読み込みます。

このディレクトリに `Local.xcconfig` を作成してください。Player ライセンスでは `com.playerlab.sportsstreaming.ios` と `com.playerlab.sportsstreaming.tvos` を許可します。Analytics ライセンスを追加すると、統合コレクターがカタログの映像 ID を使って計測します。どちらのライセンスもビルドしたアプリに含まれるため、デモ用のものを使ってください。

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

イベントを選び、ライブ、クリップ、準備済みの録画から見たい映像を開きます。スポーツ用UIでは再生、一時停止、15秒送りと15秒戻しができます。クリップからライブの最新位置に戻れます。元の視聴位置がまだDVRの範囲内なら、その位置にも戻れます。録画の再生時刻とライブの時刻の対応が確認できた場合は、見ていた位置から録画を再生できます。自動で引き継ぐには、事前に自動継続をオンにし、イベントが終了して録画の準備ができている必要があります。録画の先頭から再生することもできます。

iOS の標準画面は SDK の Web UI を使います。Apple TV ではシステム標準のコントロールを Siri Remote で操作します。どちらも再生中にアプリの操作画面へ切り替えられます。アプリの操作画面と tvOS の標準画面では、SDK が通知する字幕キューを使って外部字幕を表示します。iOS では AirPlay の出力先も選べます。
