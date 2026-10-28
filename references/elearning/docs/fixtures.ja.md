<a id="learning-media-fixtures"></a>

# 学習用の映像素材

[English](fixtures.md) · [日本語](fixtures.ja.md)

同梱する教材は自作の数直線映像です。HLS、DASH、字幕、時間付き本文を用意しています。このページでは素材の準備と配信方法を説明します。アプリのライセンス設定は[Androidの設定](../README.ja.md#configure-and-run-android)、Playerの組み込みは[実装ガイド](implementation.ja.md)を参照してください。

<a id="generate-and-serve"></a>

## 素材の生成と配信

`references/elearning`から次のコマンドを実行してください。macOSまたはLinuxで、Python 3.9以降、`drawtext`フィルターを含むFFmpeg、`ffprobe`を使います。補助ツールはPythonの標準ライブラリだけを使用し、ライセンスキーの読み込みやクラウドサービスへの接続は行いません。

macOSではインストール済みのHomebrew版`ffmpeg-full`を次のように指定できます。

```sh
export FFMPEG_BIN="$(brew --prefix ffmpeg-full)/bin/ffmpeg"
export FFPROBE_BIN="$(brew --prefix ffmpeg-full)/bin/ffprobe"
```

指定がなければ、`PATH`上の`ffmpeg`と`ffprobe`を使います。同じ環境変数で、ほかの対応する実行ファイルも指定できます。生成前に、選択したFFmpegの`-filters`に`drawtext`が含まれることを確認してください。

```sh
python3 tools/media/media.py generate
python3 tools/media/media.py verify
python3 tools/media/media.py serve --port 8621
```

`generate`は、Git管理対象外の`fixtures/generated/`に素材を生成します。同時に使うエンコーダーは最大2つで、CPUのコア数が少ない環境では数を減らします。各エンコーダーのコーデック用スレッドも最大2つです。映像は640 × 360、毎秒25フレームで、音声は48 kHzのAACです。HLSとDASHにはfragmented MP4を使い、セグメントは約2秒です。最後のセグメントはそれより短くなる場合があります。

`verify`は編集した素材の一部の境界を確認します。このコースには編集素材がないため、確認件数はゼロです。再生や映像全体の検証結果を示すものではありません。生成した各素材の`receipt.json`には生成ファイルのSHA-256と、各トラック・コンテナーの測定した尺を記録します。

短い素材で生成を確認する場合は、`generate --asset EDU-FX-03`を使ってください。ほかの教材はそれぞれ生成するまで配信できません。`--asset`は繰り返し指定できます。生成を完了してから素材サーバーを起動し、素材を差し替えた後はサーバーを再起動してください。停止するにはCtrl-Cを押します。

<a id="lessons-and-catalog"></a>

## 教材とカタログ

| 教材ID | 指定した尺 | 字幕 |
| --- | --- | --- |
| `EDU-FX-01` | 3分 | 英語・日本語 |
| `EDU-FX-02` | 13分。12:34に再開確認位置 | 英語・日本語 |
| `EDU-FX-03` | 8秒 | なし |

[`media-spec.json`](../fixtures/media-spec.json)は、生成時の入力を定義します。[`catalog.json`](../fixtures/catalog.json)は、コース、教材IDの順序、固定のAnalytics映像ID、相対配信パス、再開確認位置を定義します。Androidはビルド時にこのカタログと本文を同梱し、素材サーバーから別のカタログをダウンロードしません。内容を変更したら再ビルドしてください。

Gitに含めるカタログの尺は`expected`として扱います。素材サーバーの`/catalog.json`では確認できた映像の尺を`durationMs`、指定した尺を`expectedDurationMs`、コンテナーの尺を`measuredDurationMs`に返します。生成ファイルの記録がない場合や、ファイルと記録が一致しない場合は、実際の尺を不明のままにします。Androidのコースは引き続き同梱のカタログを使います。

現在の[測定記録](../fixtures/local-media-validation.json)にはローカルで生成した際の結果とファイルの識別情報を記載しています。生成やファイル解析が成功していても、端末再生やクラウド配信を確認したことにはなりません。再生成すると新しい記録が作られ、測定した尺やハッシュが変わる場合があります。

<a id="captions-and-transcripts"></a>

## 字幕と本文

`fixtures/transcripts/<ID>.json`が字幕キューの元データです。各キューは`startMs`、`endMs`、`text`、`language`を持ち、時刻は整数のミリ秒です。生成時に、このキューから言語別のJSONとWebVTTを作成します。素材のテストでは、それらの文字列と時刻が一致することを確認します。

カタログには、HLSの選択肢が二つあります。

| フィールド | プレイリスト | 字幕の配信方法 |
| --- | --- | --- |
| `streams.hls` | `<ID>/hls/media.m3u8` | アプリがカタログの外部WebVTTトラックを追加します。 |
| `streams.hlsWithSubtitles` | `<ID>/hls/master.m3u8` | マニフェストが字幕トラックを登録し、アプリは重ねて追加しません。 |

字幕の読み込み元はコースを開く前に選択してください。DASHは外部トラックを使います。まとめの教材には意図的に字幕トラックを用意していません。別に用意した不正形式やキューが重なるWebVTTは、エラーや表示を比較するための素材で、通常の教材ではありません。

測定したAACパケットは、48 kHzで1パケットあたり1,024サンプル、約21.33 msです。そのため、指定した尺、映像の尺、音声の尺、コンテナーの尺を同一と仮定せず、個別に記録しています。字幕キューの境界には元データのミリ秒値を使い、メディアセグメントの境界へ丸めません。

<a id="reach-the-publisher"></a>

## 素材サーバーへの接続

| 接続元 | 素材の配信元 |
| --- | --- |
| 開発用コンピューターのブラウザー | `http://127.0.0.1:8621/` |
| Android仮想端末 | `http://10.0.2.2:8621/` |
| 実機 | 同じパスを素材サーバーへ転送し、その端末から接続できるHTTPSの配信元 |

`android/.env`の`MEDIA_BASE_URL`に、末尾のスラッシュを含むURLを設定して再ビルドしてください。素材サーバーはループバックで待ち受けます。URLをLANのアドレスに変えるだけでは外部から接続できません。開発用のHTTPSリバースプロキシで、選択した配信元から`http://127.0.0.1:8621/`へ転送できます。端末からマニフェスト、セグメント、字幕へ接続できる状態にし、その端末が信頼する証明書を使用してください。

ローカルの補助ツールは素材用の決められたパスだけを配信し、認証機能はありません。テスト用の映像だけを公開し、リポジトリや非公開の設定を公開しないでください。生成したMP4を必要とするツールには、`/prepared/<ID>/source.mp4`を使います。通常の再生用パスからはこの元ファイルへ接続できません。

<a id="use-separately-prepared-media"></a>

## 別に用意した素材を使う

上記のローカル生成と配信は実行済みです。クラウドでの素材準備は別の手順です。bitovpの公開ドキュメントにある[VODエンコードガイド](https://kazuhide.github.io/bitovp/guide/vod-encoding/)と[APIトークンの設定](https://kazuhide.github.io/bitovp/guide/access-and-administration/)を参照してください。これらのリンクは、クラウドの出力が本リファレンスの確認を完了したことを示すものではありません。

このアプリでは一つの`MEDIA_BASE_URL`を基準とする相対パスを使います。`CATALOG_URL`の設定はなく、教材カタログには絶対パスやクエリ文字列を含むパスを指定できません。クラウドで準備した素材を使うには、その配信元に必要なディレクトリ構成で公開し、本アプリのカタログ・本文の入力を更新して再ビルドしてください。教材として使う前に、HLS／DASHでの配信、字幕の時刻、実際の尺を確認します。

素材用のコマンドラインツールが受け取るのは、素材IDとローカルサーバーの起動オプションです。アカウントの認証情報は受け取りません。トークン、非公開URLや署名付きURL、ストレージ認証情報を、コミットするカタログ、記録、コマンド、キャプチャへ含めないでください。アプリのライセンス設定は[Androidの手順](../README.ja.md#configure-and-run-android)を参照してください。
