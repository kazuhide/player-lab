<a id="implementing-the-learning-player"></a>

# 学習用プレイヤーの実装

[English](implementation.md) · [日本語](implementation.ja.md)

まず[設定手順](../README.ja.md#configure-and-run-android)を確認してください。Androidアプリは統合版Bitmovin Player SDKを使います。任意の分析用Webアプリは専用のサーバー経由でAnalyticsを読み取ります。

<a id="player-and-source-configuration"></a>

## PlayerとSourceの設定

[`PlayerEngine`](../android/app/src/main/java/com/playerlab/elearning/PlayerEngine.kt)がPlayerを所有します。現在の利用者に対してPlayerを一度設定し、選択した教材のHLSまたはDASHのURLからSourceを作成します。SourceのAnalyticsメタデータには、配信URLや形式とは独立した固定の教材IDを使います。

コースの連続再生はアプリ側の動作です。有効な場合は、選択した教材からコースの最後までを含むPlaylistを読み込みます。無効な場合は、選択した教材だけを読み込みます。手動の前後移動では教材を選び、その設定に応じた新しい読み込みを作成します。Playlistによる自動遷移とは別の操作です。最後の教材には字幕がないため、Sourceが変わるたびに字幕の選択肢を取得し直す必要があります。

[`PlaybackPlan`](../android/app/src/main/java/com/playerlab/elearning/PlaybackPlan.kt)で、これらの選択を明示的に扱います。`PlaybackFinished`が示すのはPlaylistの最後のSourceの終了です。個々の教材の終了や、学習評価の完了を示すものではありません。

<a id="switching-the-interface"></a>

## UIの切替

[`PlayerSurface`](../android/app/src/main/java/com/playerlab/elearning/PlayerSurface.kt)は、標準UIに`UiConfig.WebUi`を使い、学習UIには`UiConfig.Disabled`とネイティブの操作部品を使います。UIだけを変える場合は、既存のPlayerとSourceを再利用します。教材の再読み込み、保存位置への移動、Analyticsのimpression（再生の計測単位）の作成は行いません。

古い`PlayerView`を破棄する前に、PlayerをそのViewから切り離してください。Playerの生存期間は一時的な表示用Viewではなく、アプリ側の所有者が管理します。両方のUIで、アプリが所有する一つのSDK `SubtitleView`を使います。`UiConfig.WebUi.supplementalCssLocation`で非表示にするのはHTMLの字幕表示部分だけです。標準の再生操作とトラック選択は引き続き使えます。

Android 3.172.0の確認では、一時停止中にHTML UIを新しく作ると、すでに表示中だった字幕キューが再表示されませんでした。一つのネイティブ字幕表示部品で購読を続けることで、再読み込み、位置移動、字幕トラックの切替をせずに、そのキューを維持しています。表示部品はApplication Contextを使い、Activityの再生成後は新しい親Viewへ付け直します。古い表示領域がそのViewを切り離したり、スタイルを変更したりできるのは、まだそのViewを所有している間だけです。遅れて実行された後始末が、新しい表示領域へ影響することを防ぎます。

字幕はアプリの文字サイズ設定に応じて拡大する固定サイズで表示します。字幕表示領域の高さに対する割合でサイズを決めると、上下に黒帯がある縦長のタブレット画面で字幕が大きくなりすぎました。配置には`SubtitleView.setBottomPaddingFraction`を使います。字幕ファイルで指定したキューの配置も有効なので、すべての字幕をすべての操作部品より上に強制配置するものではありません。SDKの外側のViewへ余白を付ける方法では、端末の確認時に実際の字幕文字が欠けました。英語・日本語を別々に確認し、現在の字幕の描画、HTML字幕の重複がないこと、標準UIの再生・一時停止の実操作、UI切替とActivity再生成時の一時停止の継続を調べています。

ネイティブの字幕表示は実際の`PlaybackFinished`イベントで消去します。確認したSDKでは、最後の`CueExit`がなく、最終字幕が残る場合があります。消去するのは、アプリが所有する表示部品と表示中キューのキャッシュだけです。PlayerやSourceの置換、素材の再読み込み、位置移動は行いません。致命的なPlayerエラーによって、SDKの字幕表示部品が切り離される場合があります。利用者が「再試行」を選んだ場合は、新しいSourceを読み込む際に[`SubtitleView.setPlayer`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player/-subtitle-view/set-player.html)で接続し直します。UIだけの変更では、この再読み込みは行いません。

Viewのライフサイクルを変更したら、実際の素材で再生の継続を確認してください。オブジェクトが同一であるだけでは、映像フレームと音声が続いていることは確認できません。

<a id="transcript-and-subtitles"></a>

## 本文と字幕

[`Transcript`](../android/app/src/main/java/com/playerlab/elearning/Transcript.kt)は、字幕素材と同じ時間付きキューを検索します。キューの時刻は整数のミリ秒で保持し、SDKのAPIを呼ぶときだけ秒へ変換してください。行を選択すると、その行の元の開始位置へ移動します。検索結果の絞り込みや並べ替えで、この時刻を別の値に置き換えないでください。

この元の時刻情報と、一時的なSDKのキューイベントを分けて扱います。確認したSDKでは、イベントとして届くキューの時刻が元のWebVTTの区間と一致せず、例えば[`Cue.end`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api.media.subtitle/-cue/end.html)が`0`になる場合がありました。表示中の字幕は`CueEnter`と`CueExit`で追跡し、検索用の時刻には本文データを使います。端末の確認では実際に届くキューと描画した字幕を、字幕のない区間や再生終了時も含めて再生時計と比較しています。

位置移動は非同期です。更新された位置と、まだ表示されている字幕が、移動処理の異なる段階を示す場合があります。回転やUI切替の前後で一時停止中の字幕を確認するテストでは、対象Sourceの`Seeked`、期待したキューの内容、実際の字幕の描画を待ちます。移動前の字幕の描画を認めてしまうと、テストの準備が正しくできたと誤認します。

字幕オフは利用者の明示的な選択です。新しい教材の読み込みや本文からの移動で、既定の言語に置き換えないでください。トラックIDはSourceごとに異なるため、希望する言語のトラックを新しいSourceから取得し直します。

字幕トラックは、`Loaded`や`Ready`の後に追加される場合があります。端末の確認では、最初のコールバック時にはトラック一覧が空で、その後に`SourceEvent.SubtitleTracksChanged`が届くことがありました。そのため、初回の読み込み時だけ言語設定を適用すると、字幕が選択されないままになりました。エンジンは、このイベントが現在のSourceに対応する場合にも、保存した選択とトラックを照合します。明示的なオフ設定を維持し、置き換えたSourceや先読み中のSourceから届く変更は無視します。

<a id="caption-errors"></a>

### 字幕のエラー

[`PlayerEngine`](../android/app/src/main/java/com/playerlab/elearning/PlayerEngine.kt)は、[`TweaksConfig.parseSubtitlesDuringExtraction = false`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api/-tweaks-config/parse-subtitles-during-extraction.html)を明示的に設定します。SDKの初期値は`true`です。Android SDK 3.172.0の条件を固定したテストでは、抽出時に解析する初期設定の場合、字幕ファイルの欠落と不正なWebVTT識別行が、SDKの致命的なエラー`2203`と`2001`になりました。描画時に解析すると映像は継続しましたが、字幕の警告`2004`と`2005`はどちらも発生しませんでした。

そのため、アプリは[`SourceEvent.DownloadFinished`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api.event/-source-event/-download-finished/index.html)で実際の字幕のHTTPエラーを報告し、SDKの既存の[`preprocessHttpResponseCallback`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api.network/-network-config/preprocess-http-response-callback.html)でWebVTTの識別行を調べます。追加のダウンロードや応答の変更は行いません。外部から追加した字幕のリクエスト種別が`Unknown`になる場合があるため、Sourceに登録した字幕URLとの完全一致で識別します。前処理の対象は`MediaSubtitles`と`Unknown`だけで、`MediaAudio`と`MediaVideo`は対象外です。

これは長さを制限した識別行の確認であり、WebVTT全体の検証ではありません。先頭の最大16バイトを調べ、応答が1 MiBを超える場合は未対応として報告します。この時点ではSDKがすでに応答をバッファーへ読み込んでいるため、この確認はダウンロード量やメモリ使用量を制限するものではありません。HTTPステータスコードとSDKの診断コードを別々に扱い、SDKの生メッセージ、応答本文、URLは診断ログへ含めません。エラー表示では「再試行」と教材一覧へ戻る操作を選べます。「再試行」は、利用者が明示的に行う新しいSourceの読み込みです。字幕のエラーだけで教材を再読み込みすることはありません。

<a id="resume-learner-identity-and-lifecycle"></a>

## 途中再開、利用者の識別、ライフサイクル

[`ProgressRepository`](../android/app/src/main/java/com/playerlab/elearning/ProgressRepository.kt)は、利用者と教材の組み合わせごとに再開情報を保存します。保存処理をメインスレッドの外へ渡す前に、両方の識別子と再生位置を取得してください。古い保存処理やコールバックで、新しく選択した利用者の画面を更新しないようにします。

再生中は定期的に保存し、一時停止、教材変更、バックグラウンドへの移行時にも保存します。プロセスを強制終了した場合に復元できるのは、最後に保存できた状態だけです。保存後に素材が変わり、保存位置がその尺の範囲外になった場合は、自動で範囲内に収めず、最初からの再生を明示的に選べるようにしてください。

教材を差し替えると、カタログの尺が実際の尺と合わなくなる場合があります。そのため、本アプリは選択したSourceを位置ゼロ・一時停止で読み込み、Playerの準備完了と、読み込んだSourceの実際の尺の両方を待ちます。保存した位置を確認してから位置移動を実行し、その初回の移動が完了してから再生を始めます。保存位置が実際の終端以降の場合は再生を開始せず、「最初から」または「教材」を選べる状態にします。利用者が最初からの再生を選ぶまで、保存位置は保持します。

[`PlaybackCheckpoint`](../android/app/src/main/java/com/playerlab/elearning/PlaybackCheckpoint.kt)は、読み込み中やエラー後も、選択した位置または最後に使えた位置を保持します。SDKの時計を取得できないときに、再開位置をゼロ秒で更新してはいけません。再試行には保持した位置を使います。現在のSourceの準備が整った後は、実際の再生・位置移動イベントで保持した位置を更新します。意図的なゼロ秒への移動は有効です。ネイティブのタッチ操作、キーボード、アクセシビリティによるスライダー変更も、同じ条件確認付きの位置移動処理を使います。

保存した位置からの再開では、その教材に保存した設定を復元します。通常の手動・自動の教材遷移では現在の字幕と再生速度の選択を引き継ぎます。利用者を切り替える場合は、Player、保存先の範囲、Analyticsの識別情報を意図的に置き換えます。

Player、Source、collectorの操作はメインスレッドで行い、ディスクとネットワークの処理は非同期で行います。`DownloadFinished`は読み込み用のスレッドで届く場合があります。[`SourceIssues`](../android/app/src/main/java/com/playerlab/elearning/SourceIssues.kt)で後から変更されない形のリクエスト情報を取得し、エンジンはメインスレッドへ結果を渡してから、Sourceの状態を参照したりViewを更新したりします。置き換えたSourceから遅れて届くコールバックは無視します。回転時は所有者を維持し、バックグラウンドへ移ると再生を一時停止して保存します。診断出力には上限を設け、決められたイベント名、固定の教材ID、別々のHTTP・SDKコードを記録します。入力した検索語や任意のSDKメッセージは記録しません。

<a id="analytics-and-observability"></a>

## AnalyticsとObservability

Playerの再生とAnalyticsの送信は別製品として設定します。統合collectorは一度だけ接続してください。Sourceを読み込む前に、`videoId`を教材ID、`customUserId`をデモ用の利用者IDに設定します。この利用者IDはSDKの`userId`とは異なります。

任意で使える再生開始経路の比較は、`customData1`を利用します。カタログからの教材選択・途中再開は`catalog`、手動・自動の教材遷移は`playlist`です。UIモードは端末内だけで扱い、UI切替では新しいimpressionを開始しません。本実装では、ブックマーク操作のデータや利用者のメモは送信しません。

[専用ダッシュボード](../analytics-dashboard/README.ja.md)では再生開始数、視聴時間、再生開始までの時間の中央値と95パーセンタイル、再バッファ割合、エラー率を取得します。パーセンタイルは分布を要約する値です。時間別のパーセンタイルを平均して、選択期間全体のパーセンタイルにすることはできません。アカウントの認証情報はlocalhostサーバーにだけ保持します。

公式ドキュメント：[Playlist API](https://developer.bitmovin.com/playback/docs/using-the-playlist-api-for-seamless-source-switching)、[字幕](https://developer.bitmovin.com/playback/docs/subtitles-captions)、[Analyticsの設定](https://developer.bitmovin.com/playback/docs/configuration-analytics)、[Dashboardの照会定義](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1)。
