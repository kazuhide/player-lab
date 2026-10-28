<a id="implementing-live-events-clips-and-archives"></a>
# ライブイベント・クリップ・アーカイブの実装

[English](implementation.md) · [日本語](implementation.ja.md)

Playerとの接続部分を変更する前に、[必要な環境と設定](../README.ja.md#requirements-and-configuration)を確認してください。Androidアプリと分析Webでは、設定と実行の手順が分かれています。

<a id="own-the-player-and-its-display-separately"></a>
## Playerと表示Viewの寿命を分けて管理する

[`PlaybackSession`](../android/app/src/main/java/com/playerlab/sportsstreaming/PlaybackSession.kt)がSDKのPlayerを所有します。Sourceにはカタログで定義した固定の`videoId`とタイトルを設定します。配信URLを映像の識別子として使いません。別のSourceをロードすると、Analyticsの新しいimpression（計測セッション）が始まります。操作UIを変更する場合は既存のSourceとimpressionを維持します。

[`PlayerSurfaceHost`](../android/app/src/main/java/com/playerlab/sportsstreaming/PlayerSurfaceHost.kt)は一度に一つの`PlayerView`を接続します。標準モードではSDKのWeb UIを使い、スポーツモードではWeb UIを無効にしてネイティブの操作UIを使います。両モードでアプリが所有する一つのSDK `SubtitleView`を共有し、補助CSSでHTMLの字幕レイヤーだけを隠します。

HTMLの操作UIを置き換える方式では、一時停止中に表示していた字幕が再表示されませんでした。共通の字幕描画を使うことで、Sourceの再ロード、シーク、字幕トラックの切替をせずに表示を維持します。このViewはApplicationのContextで作成し、画面回転後も保持されるPlayerの所有者が管理します。古い表示領域がViewを取り外せるのはそのViewをまだ所有している場合だけです。字幕の文字サイズは、タブレットの上下に余白がある映像領域の高さではなく、アプリの文字倍率に従います。位置の調整には描画用Viewの下余白APIを使い、素材側で指定した字幕位置も尊重します。SDKのラッパーViewに余白を付ける方法は使いません。

古いViewの`onPause`、`onStop`、`onDestroy`を呼ぶ前にPlayerを切り離してください。これらのライフサイクルメソッドは接続中のPlayerにも処理を渡します。UIを繰り返し切り替えても、メディアのロード、保存位置へのシーク、追加リスナーの登録をしてはいけません。通常のActivityのライフサイクル呼出しでは、SDKの[onPause](https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/on-pause.html)、[onStop](https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/on-stop.html)、[onDestroy](https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/on-destroy.html)の仕様に従い、現在のViewとPlayerを接続したままにします。

端末での確認では、破棄直前だけ切り離す実装はSourceの同一性を維持できたものの、再生中のUI切替で再生が一時停止しました。そのため、[`PlayerOwnershipTest`](../android/app/src/androidTest/java/com/playerlab/sportsstreaming/PlayerOwnershipTest.kt)では再生中と一時停止中の両方について、字幕の実描画も含めた継続性を確認します。

SDKの操作はメインスレッドで行ってください。画面回転や全画面表示をまたいで所有者を保持します。バックグラウンドへ移る場合は、ピクチャーインピクチャー中を除き、ローカル再生を一時停止します。Cast受信機の再生は独立して続きます。

プレビュー用の文字倍率を上書きする場合は、変更する値だけを入れた`Configuration`を使ってください。現在の設定全体をコピーすると、向きやウィンドウ寸法も固定され、画面回転に応じてリソースが更新されなくなります。このサンプルは[設定を指定したContext](https://developer.android.com/reference/android/content/Context#createConfigurationContext(android.content.res.Configuration))の作成時に`fontScale`だけを変更します。

<a id="live-position-and-clip-return"></a>
## ライブの再生位置とクリップからの復帰

保存する位置と、協定世界時（UTC）のタイムスタンプは、整数のミリ秒で扱います。SDKを呼ぶときに秒へ変換してください。ライブDASH、ライブHLS、Castでは時刻の基準が異なります。負の`timeShift`はライブ端からどれだけ前にいるかを表すオフセットであり、アーカイブの先頭からの秒数ではありません。

ライブのシークを実行する直前に、現在のシーク可能範囲を読み取ってください。API呼出しは非同期処理を開始するもので、要求したオフセットが更新されただけでは、実際の再生位置がそこへ到達したとは判断できません。後続の操作は[`PlayerEvent.TimeShifted`](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.event/-player-event/-time-shifted/index.html)を待ち、実際のタイムスタンプを確認してから実行します。VOD（ビデオオンデマンド）で対応する完了イベントは`PlayerEvent.Seeked`です。

新しいSourceの`SourceEvent.Loaded`は読み込み完了を示しますが、再生準備完了は示しません。設定した開始位置の確認や後続コマンドの実行前に、`PlayerEvent.Ready`、現在のSource、現在の要求の世代番号を対応付けてください。アプリは読み込みと準備完了の両方が同じSourceに対するものと確認できるまで、ローカルの操作を使用不可にします。遅れて届いた読み込み／準備完了イベントで、失敗したSourceの状態を解除しません。Castでは後述する対象受信機に対応付けた応答を使います。

長く一時停止した後は、要求した映像が保持範囲から外れている場合があります。期限切れの位置を使用可能として扱わず、有効な復帰位置または現在のライブ端を選べるようにしてください。

クリップには別途準備したVODのSourceを使います。初期設定ではライブ端へ戻ります。以前のローカル位置へ戻るには、最新のシーク可能範囲の確認と、利用者の明示的な選択が必要です。

<a id="ended-events-and-ready-archives"></a>
## イベント終了とアーカイブ準備完了

イベントの状態（`scheduled`、`live`、`ended`、`cancelled`）と、アーカイブの状態（`not_ready`、`processing`、`ready`、`failed`）を分けてください。終了通知を受けても、過去のライブ映像を視聴している利用者の再生を中断してはいけません。

アーカイブの準備状況は回数や時間に上限を設けて再確認し、その後も手動で再試行できるようにします。各要求を、選択中のイベント、映像、再生先、要求の世代番号に対応付けてください。どれかが変わっていたら応答を破棄します。同じ終了通知が重複しても、繰り返しロードしてはいけません。

連続したアーカイブでは確認済みのメディアUTCをアーカイブ内の相対位置へ変換します。編集アーカイブでは明示的なUTC区間とオフセットが必要です。削除された区間、時刻対応が不明な状態、範囲外の位置は、それぞれ異なる条件です。いずれも0秒から開始してよいという意味にはなりません。

引継ぎを実行する時点で、現在のSourceに対応付けた最新のSDKタイムスタンプから、選択中のアーカイブの位置を求めてください。別のアーカイブ向けに表示していた位置はプレビューにすぎません。そのオフセットを、編集内容が異なるアーカイブへ再利用できません。

<a id="playback-position-and-unix-time"></a>
### 再生位置とUnix時刻

再生時間が有限になっても、SDKが再生時刻の原点を0へ変更したとは限りません。メディア内の位置、Unixタイムスタンプ、アーカイブのオフセットを分けて扱ってください。WebとAndroidでもAPIが異なります。

| SDKと状態 | 現在時刻のAPI | 絶対時刻への変換 |
| --- | --- | --- |
| Web | `getCurrentTime()`の既定値は`TimeMode.AbsoluteTime`。相対時刻には`TimeMode.RelativeTime`を明示する。 | ライブのSourceが有限になっても、Unix時刻の原点を維持する場合がある。シーク先を選ぶ前に`getSeekableRange()`を読む。 |
| Android：ライブHLS | `currentTime`は相対位置。 | 最新の`currentTime`へ`playbackTimeOffsetToAbsoluteTime`を秒単位で加算する。 |
| Android：ライブDASHまたはSmooth Streaming | `currentTime`はUnixタイムスタンプ。 | 同じオフセットAPIで変換する。イベントの開始タイムスタンプを重ねて加算しない。 |
| Android：ライブCast | 配信形式によらず、`currentTime`は相対位置。 | そのリモート再生用のオフセットを取得し直す。ローカルSourceの変換値は受信機の時計ではない。 |
| Android：VOD | 公開仕様では`currentTime`は相対位置。`TimeMode`を指定するオーバーロードはない。 | 直前のライブ用オフセットが、終了後も得られると仮定しない。 |

これらは別々のSDK仕様であり、プロパティ名を置き換えて同じようには使えません。[Webの現在時刻API](https://cdn.bitmovin.com/player/web/8/docs/interfaces/core.playerapi.html#getcurrenttime)、[Webの時刻モード](https://cdn.bitmovin.com/player/web/8/docs/enums/Core.TimeMode.html)、[Androidの現在時刻](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api/-player/current-time.html)、[Androidの絶対時刻オフセット](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api/-player/playback-time-offset-to-absolute-time.html)を参照してください。オフセットが0であることは値そのもので、APIの取得失敗を意味しません。`currentTime + offset`の意味はSourceの既知の時刻基準と照合して確認する必要があります。

制御した条件でのAndroid HLSの終了では、同じSourceが有限になっても、SDKが返す再生位置は変わりませんでした。DASHの検証では、生の値がUnix時刻から相対位置へ変わり、両方の変換オフセットが0になりました。それまでの変換式では期待するUnixタイムスタンプを得られなくなりましたが、SDKの時刻情報がすべて失われたわけではありません。

[`SourceUtcClock`](../android/app/src/main/java/com/playerlab/sportsstreaming/core/SourceUtcClock.kt)は同じライブのSDKスナップショットから両方のオフセットを読み取ります。各オフセットはSDKから直接取得した値へ一度だけ適用します。

```text
relative position = currentTime + playbackTimeOffsetToRelativeTime
UTC origin = playbackTimeOffsetToAbsoluteTime - playbackTimeOffsetToRelativeTime
Unix time = relative position + verified UTC origin
```

アプリは、SDKから最新の有効な絶対時刻への対応が得られれば、それを優先します。保持した原点はSource、再生先、要求に対応付け、ライブのSourceが有限の状態へ移るのを観測し、SDKの相対位置が連続している場合だけ使用できます。Sourceの差し替え、再生先の変更、原点が不明な場合、時刻原点の変更後の対応が未確認の場合は、位置を不明のままにします。終了後に明示的にシークした場合は、SDKから新しい有効な絶対時刻への対応が得られない限り、保持していた変換を無効にします。端末の実時計や、UIに保存した古い位置で代用しません。

Google Cast Frameworkの受信位置と、Bitmovin SDKの`currentTime`は別の座標です。SDKの変換オフセットを適用できるのは、SDKから直接読み取った値だけです。CAFの推定再生位置へ加えると、誤ったUnixタイムスタンプになる可能性があります。再生操作の確認には受信機の生の位置とシーク可能範囲を保持し、アーカイブへの引継ぎ前に、最新のSDKの絶対時刻への対応をイベントの既知の範囲と照合してください。時刻対応が不明な場合に、以前に保存した映像の再開位置を上書きしてはいけません。

現在のマニフェストを終了状態にすることと、準備済みアーカイブをロードすることは別の操作です。アーカイブは独自の相対タイムラインを持つ新しいSourceなので、確認済みのメディアUTCを、明示的な区間対応表で変換してください。Webでの結果はAndroid実装の動作確認にはならず、ローカル再生の結果はCastの動作確認にはなりません。[検証結果](validation.ja.md)では検証ごとのSDKバージョン、配信形式、実際に使った端末を示しています。

まだ再生していないVODのSourceは、`Ready`であっても`isPlaying`と`isPaused`が両方ともfalseになる場合があります。アプリが「再生しない」という指定を反映済みと扱うのは、現在の読み込み／準備完了済みSourceと要求に対して、実際の対象位置が複数回の観測で安定している場合だけです。引継ぎ記録にはSDKの生のフラグを残し、Pausedイベントを発行したり作り上げたりしません。リモートCastの確認には、引き続き受信機側の実際の再生中または一時停止中の状態が必要です。

準備済みSourceをロードするときも、利用者が指定した再生／一時停止の状態を維持してください。結果として再生している映像と位置、再生が進むか一時停止を保つかを確認します。対象の選択やロードコールバックの完了だけでは、引継ぎ成功と判断できません。

<a id="google-cast"></a>
## Google Cast

<a id="register-and-initialize-the-sender"></a>
### 送信側の登録と初期化

SDKを使うにはアプリのマニフェストへCast options providerを登録する必要があります。拡張コントローラーのActivityもSDKが提供します。サンプルの[マニフェスト全体](../android/app/src/main/AndroidManifest.xml)と、公式の[BasicCastingサンプル](https://github.com/bitmovin/bitmovin-player-android-samples/blob/main/BasicCasting/src/main/AndroidManifest.xml)を参照してください。

```xml
<meta-data
    android:name="com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME"
    android:value="com.bitmovin.player.casting.BitmovinCastOptionsProvider" />
<activity
    android:name="com.bitmovin.player.casting.ExpandedControllerActivity"
    android:exported="false"
    android:launchMode="singleTask"
    android:theme="@style/AppTheme"
    android:parentActivityName=".MainActivity" />
```

[`SportsApplication.onCreate`](../android/app/src/main/java/com/playerlab/sportsstreaming/SportsApplication.kt)から`BitmovinCastManager.initialize()`を呼び出します。[`MainActivity.onCreate`](../android/app/src/main/java/com/playerlab/sportsstreaming/MainActivity.kt)では、現在のActivityを渡して`BitmovinCastManager.getInstance().updateContext(this)`を呼び出してください。Applicationで初期化するだけでは、マニフェストのprovider登録や、受信機選択画面へのActivityのContext提供はできません。

<a id="load-and-control-the-selected-receiver"></a>
### 選択した受信機へのロードと操作

[`PlaybackSession`](../android/app/src/main/java/com/playerlab/sportsstreaming/PlaybackSession.kt)は、`player.castVideo()`でSDKの受信機選択画面を開きます。ソースのロードと再生操作のコマンドはSDKが管理します。[`CastController`](../android/app/src/main/java/com/playerlab/sportsstreaming/CastController.kt)はGoogle Cast Frameworkの状態を観測するもので、別のメディアロードを発行しません。

リモート再生の準備完了は再生先ごとに確認する必要があります。Android 3.172.0では同じURLを受信機へ再ロードした際、受信機が新しいトークン／media sessionを読み込んで一時停止していても、ローカルの`PlayerEvent.Ready`は再発行されませんでした。そのためアプリは正確なCast session、Sourceのload token、`mediaSessionId`に加え、実際の受信機が再生可能な状態であることを要求します。メタデータだけの取得、バッファリング、idle、失敗状態では準備完了と判断しません。ローカルのSDKイベントを合成したり、以前のSourceの準備完了状態を再利用したりすることもありません。

受信機のSourceを置き換える前に、アプリはSDKを通じてアンロードし、その要求と接続に対応する停止を観測するまで待ちます。保存済みのidle状態や自然な再生終了を、この停止への応答として扱ってはいけません。再生が停止しても、送信側のキューキャッシュが準備できているとは限りません。項目数が0でなくても、項目の詳細が取得できない場合があります。

アプリは欠けた項目を公開の[MediaQueue API](https://developers.google.com/android/reference/com/google/android/gms/cast/framework/media/MediaQueue)で一度だけ要求し、その後は繰り返し要求せずに更新を観測します。ロードを開始するのは、キューが空か、要求するSourceと異なることを確認できる単一の項目がキャッシュされている場合です。新しい選択があれば保留中の要求を置き換え、古いコールバックからその要求を実行することはできません。ロードには制限時間を設け、超過したら失敗を明示して回復操作を提示します。アプリ独自のCAFロードを、SDKとは別に重ねて発行しません。

リモートのソースロードは非同期です。`player.load(source)`の直後に`player.play()`を呼ぶと、新しいソースのロード前に、受信機の前の項目を操作する可能性があります。新しいロードには異なるautoplay設定が付いている場合もあります。本アプリは指定した再生／一時停止の状態を、Sourceと操作の世代番号に対応付けて保持します。受信機がその対象項目を再生中または一時停止中と報告したら、[`ReceiverLoadIntent`](../android/app/src/main/java/com/playerlab/sportsstreaming/core/ReceiverLoadIntent.kt)が必要な再生操作を一度発行し、結果の状態を待ちます。古いソースや操作に対する状態では、その要求を完了させません。

各Sourceの[`SourceConfig.metadata`](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.source/-source-config/metadata.html)には、ランダムで機密ではないロード識別子を含めます。受信機の状態にはその識別子と実際の[`mediaSessionId`](https://developers.google.com/cast/docs/media/messages#MediaStatus)、Cast sessionが返る必要があります。同じURLを照合するだけでは以前の再生と新しいロードを区別できません。識別情報がなければ未確認のままにします。このSourceのメタデータはAnalyticsの`customData`とは別で、`customData`は空のままです。

受信機のコールバックが戻った後にメインキューへ操作を登録し、SDKが内部の再生状態を更新し終えられるようにします。キューへ登録した操作は、`player.play()`または`player.pause()`を呼ぶ前に、Source、要求の世代番号、session、受信機の項目を再確認します。再生操作メソッドを呼んだだけでは、受信機がその操作を適用したとは確認できません。

ロードの保留中に再接続で要求の世代番号が変わった場合は、要求したSourceと再生／一時停止の指定を保ったまま、保留中の指定を新しい世代番号へ対応付け直します。受信機のロードエラーは明示的な新しいロードまで、そのSourceのエラー状態として保持します。後から状態が届いても、操作を再び有効にしたり、既存のSDKエラーコードを消したりしません。

明示的な切断では`BitmovinCastManager.getInstance().disconnect()`を呼びます。受信機選択のダイアログを閉じただけでは、切断を確認したことになりません。利用者が回復操作を選ぶまで、ローカル再生は一時停止を維持します。

受信機への接続と、受信機での再生は、別々に確認します。操作を確認するときは、受信機の実際のメディア情報と状態を読み取ってください。切断やプロセス再起動の後、位置が不明なら不明のままにします。架空の0秒を再開位置として用意しなくても、利用者は回復操作を選べます。

CAFの状態メッセージ内の位置はスナップショットなので、メッセージが届く間にも進み続ける値とは限りません。受信機の再生操作を継続して観測するには、`RemoteMediaClient.approximateStreamPosition`と、現在のライブのシーク可能範囲を使用します。巻き戻し、ライブへの復帰、再生継続を受け付ける前に、sessionとSourceの同一性を照合してください。ローカルSDKのシーク完了イベントだけでは、リモート側で位置が動いたことを確認できません。

制御した素材では、受信機の絶対時刻への対応がマニフェストに記した時計と異なり、CAFの`MediaInfo.startAbsoluteTime`は取得できませんでした。アプリはその時刻対応を拒否し、受信機の再生操作は使える状態を維持しました。UTCへの対応が得られない場合は、位置を引き継いでアーカイブへ移れません。アーカイブの先頭からの再生は別の明示的な選択であり、UTCの位置引継ぎではなくSourceのロードとして記録します。[時刻の実測結果](validation.ja.md#playback-clocks-at-event-finalization)と[CAFの絶対時刻API](https://developers.google.com/android/reference/com/google/android/gms/cast/MediaInfo#getStartAbsoluteTime())を参照してください。

メディア、字幕、マニフェストは受信機から到達できるものを使ってください。その受信機で、通信、コーデック、クロスオリジンアクセス、有効期限を確認します。エミュレーターでの再生や、スマートフォンのローカルURLだけでは、受信機の対応を確認したことにはなりません。

<a id="analytics-and-local-handoff-records"></a>
## Analyticsとローカルの位置引継ぎ記録

統合コレクターは一つだけ使い、Playerライセンスとは別に設定します。初版のアプリでは標準メタデータを使い、**customDataの枠は使いません**。映像の分類にはカタログの`sports:SP-LIVE-S`、`sports:SP-ARCH-S`などの固定video IDを使います。

[分析Web](../analytics-web/README.ja.md)では再生開始数、視聴時間、起動時間の中央値と95パーセンタイル、再バッファ割合、エラー割合を取得します。全期間のカードはそれぞれ専用のクエリーで集計し、時間別カードの平均値にはしません。APIキーはlocalhostサーバーだけに保持します。

ローカルの位置引継ぎ記録には要求と観測した結果を保存します。解決していない要求は保留中のままです。受信機の品質は実際の受信機側コレクターと、その識別項目を確認するまで取得不可とします。送信側の指標や0で代用してはいけません。

公式資料：[Cast対応](https://developer.bitmovin.com/playback/docs/casting-support)、[CAF受信機](https://developer.bitmovin.com/playback/docs/caf-support)、[Android送信側の実装](https://developers.google.com/cast/docs/android_sender/integrate)、[Analyticsクエリーの定義](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1)。
