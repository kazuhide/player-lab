# Android TV

[English](TV.md) · [日本語](TV.ja.md)

スマートフォンとテレビには同じ APK をインストールします。テレビのランチャーからアプリを開き、リモコンの方向キーでライブ、クリップ、アーカイブから見たい映像を選んでください。中央の決定ボタンで選択した項目を開きます。

標準 UI では Bitmovin のテレビ向けコントロールを使います。戻るボタンを押すとフォーカスがアプリに戻ります。全画面表示も戻るボタンで終了できます。スポーツ用 UI に切り替えると、同じ Player と Source のままアプリの操作画面を使えます。

リモコンの再生、一時停止、再生／一時停止ボタンで再生中の映像を操作できます。早戻しと早送りは、ライブまたは VOD で移動できる範囲を15秒ずつ移動します。テレビでは映像を直接再生します。Cast で受信機に送るときはモバイル版を使ってください。

[設定手順](../README.ja.md)に従ってライセンスと配信元を設定し、このディレクトリで次のコマンドを実行してください。

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
adb -s TV_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s TV_SERIAL shell am start -a android.intent.action.MAIN \
  -c android.intent.category.LEANBACK_LAUNCHER -n com.playerlab.sportsstreaming/.MainActivity
```
