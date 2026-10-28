<a id="sports-media-fixtures"></a>
# スポーツ配信用の映像素材

[English](fixtures.md) · [日本語](fixtures.ja.md)

付属する映像は自作素材です。野球場と守備位置、投球・打球のアニメーション、得点、経過時間、UTC時刻を表示します。クラウドエンコーディングのアカウントがなくても、ライブイベント、クリップ、アーカイブの再生を試せます。PlayerとCastの組込みについては、[Androidの設定](../README.ja.md#requirements-and-configuration)と[実装ガイド](implementation.ja.md)を参照してください。

<a id="generate-and-serve"></a>
## 生成と配信

`references/sports-streaming`で次のコマンドを実行します。macOSまたはLinuxで、Python 3.9以降、`drawtext`を含むFFmpeg、`ffprobe`を使用してください。追加のPythonパッケージやアカウント認証情報は不要です。

macOSでHomebrewの`ffmpeg-full`をインストール済みの場合は、実行ファイルを次のように指定できます。

```sh
export FFMPEG_BIN="$(brew --prefix ffmpeg-full)/bin/ffmpeg"
export FFPROBE_BIN="$(brew --prefix ffmpeg-full)/bin/ffprobe"
```

指定しない場合は、`PATH`内の`ffmpeg`と`ffprobe`を使います。上の環境変数で、互換性のある別の実行ファイルを指定することもできます。使用するFFmpegの`-filters`には`drawtext`が必要です。

```sh
python3 tools/media/media.py generate
python3 tools/media/media.py verify
python3 tools/media/media.py serve --port 8622 --window 60 --archive-delay 6
```

生成を終えてから配信サーバーを起動してください。生成ファイルはGit管理対象外の`fixtures/generated/`に保存します。エンコーダーの並列数はCPUに応じて調整し、最大2つ、各エンコーダーのコーデック用スレッドも最大2つです。映像はH.264、640 × 360、毎秒25フレーム、音声はAAC、48 kHzです。HLSとDASHは、分割MP4と約2秒のセグメントを使います。

`verify`は、編集アーカイブに残した区間の境界で、デコード後の映像フレームのハッシュを比較します。確認記録には原本と出力のハッシュも残します。これは一部のフレームを抽出した確認であり、全フレームの比較、端末での再生、クラウドからの配信を確認するものではありません。

`generate --asset SP-CLIP-A`は、長いイベントを生成せずに、指定したクリップと未生成の依存元の素材を用意します。`--asset`は複数回指定できます。原本を変更したら、その原本を使うクリップと編集アーカイブも再生成してください。全体の生成ではこれらも生成します。映像を置き換えた後は配信サーバーを再起動してください。停止はCtrl-Cです。

<a id="supplied-media"></a>
## 付属する素材

| 生成する素材 | 指定尺 | 元の区間 |
| --- | --- | --- |
| `SP-ARCH-S` | 3分 | 短い練習用の原本 |
| `SP-ARCH-EVENT` | 30分 | イベント全編の原本 |
| `SP-CLIP-A` | 20秒 | 短い原本の00:30–00:50 |
| `SP-CLIP-B` | 30秒 | 短い原本の01:20–01:50 |
| `SP-ARCH-E` | 2分 | 短い原本の00:30–01:30に02:00–03:00を連結 |

`SP-LIVE-S`は`SP-ARCH-S`を、`SP-LIVE-EVENT`は`SP-ARCH-EVENT`を順次公開します。サーバー起動後、時刻の巻き戻りの影響を受けない実際の経過時間に従って配信を進めます。イベントの長さはそれぞれ3分と30分です。イベント終了とアーカイブの準備完了は別の状態です。初期設定ではイベント終了から6秒後にアーカイブを利用可能にします。

`--window`は保持期間を秒で指定するもので、範囲は6～7,200秒です。HLSでは少なくとも目標セグメント長（target duration）の3倍の期間を保持し、古いプレイリストで再生しているクライアントのために、削除対象のファイルも短時間残します。まだ配信時刻に達していないセグメントは取得できません。終了したプレイリストは最後の保持区間を残して終了を通知し、全編アーカイブのURLへ変わることはありません。サーバーの再起動は別の開発用実行を始める操作であり、実時間での連続再生テストの証拠にはなりません。

<a id="catalog-and-timing-contracts"></a>
## カタログと時刻の扱い

[`media-spec.json`](../fixtures/media-spec.json)は、生成する素材、切り出す区間、ライブ用の別IDを定義します。[`catalog.json`](../fixtures/catalog.json)は、イベント、素材の種類、固定の`sports:SP-*`映像ID、配信パス、字幕トラックを定義します。日英のWebVTTは各素材の元となる本文の字幕キューから生成します。HLSでは同じ字幕を二重に登録しないように、`media.m3u8`と外部字幕トラックを使います。DASHでも外部字幕トラックを使います。

Git管理しているカタログには指定尺を記載しています。配信サーバーの`/catalog.json`では`durationMs`を確認済みの映像尺へ置き換え、`expectedDurationMs`に指定尺を、`measuredDurationMs`にコンテナの尺を残します。ファイルの確認記録がない場合や、記録とファイルが一致しない場合、実際の時刻情報は不明のままです。

[ローカルでの解析記録](../fixtures/local-media-validation.json)では映像、音声、コンテナの時間を分けて記録しています。この素材のAACパケットは48 kHzで1,024サンプルを含み、1パケットは約21.33ミリ秒です。再エンコードしない切り出しでは圧縮パケットの境界が保たれるため、20秒を指定したクリップでも音声やコンテナの末尾が少し長くなることがあります。その伸びを、UTCの対応付けに使う確認済みの映像区間へ加えることはできません。指定尺と完全に一致すると仮定せず、生成ごとの計測値を使ってください。

切り出し前の原本には生成時に合成したUTCの基準時刻を設定します。映像内のUTC表示にはFFmpegの[フレーム時刻に基づく`gmtime`展開](https://ffmpeg.org/ffmpeg-filters.html#Text-expansion)を使います。実際の放送時刻を表すものではありません。`renderUtcStartMs`、描画方式、原本のハッシュを生成記録に残します。連続した区間のクリップは原本の基準時刻に切り出し位置を加えた時刻を引き継ぎます。複数区間を連結した編集アーカイブには単一のUTC開始時刻はありません。

配信サーバーは対応する原本の基準時刻をHLSのプログラム日時、DASHの配信開始・時計情報、イベント状態の時刻対応に使います。`mediaUtcNow`は合成した時計に沿って進み、`observedAt`は実際に要求を受けた時刻を示します。映像内の時計に対応するメタデータがない場合は、UTC範囲と対応情報を不明のままにし、ライブマニフェストも配信しません。現在の実時刻で時計を置き換えることはありません。

[`mapping-validation.json`](../fixtures/mapping-validation.json)には、編集アーカイブの境界フレームを抽出して確認した結果を記録します。UTC区間は開始を含み、終了を含まない`[utcStartMs, utcEndMs)`で、`archiveStartMs`へ対応付けます。確認済みの区間を超える映像末尾には対応情報を設定しません。削除した区間や不明な位置を、0秒への引き継ぎとして扱わないでください。

`/api/events/<eventId>`は、イベントとアーカイブの状態、識別情報、任意の`archiveMapping`、`seekableUtcStartMs`と`seekableUtcEndMs`を返します。範囲は公開済みの完全なHLS/DASHトラックから求め、不明な範囲や終了イベントの範囲はnullです。これらは利用可能範囲を判断する入力であり、Playerや受信機でシークや引き継ぎが完了した証拠ではありません。

<a id="device-and-cast-access"></a>
## 端末とCastからのアクセス

| 接続元 | 映像の配信元 |
| --- | --- |
| 開発用コンピューターのブラウザー | `http://127.0.0.1:8622/` |
| Androidエミュレーター | `http://10.0.2.2:8622/` |
| スマートフォンとCast受信機 | 両方から到達できる同じHTTPS配信元 |

`android/.env`の`MEDIA_BASE_URL`には末尾のスラッシュを含めて設定し、再ビルドしてください。開発用のHTTPSリバースプロキシで`http://127.0.0.1:8622/`へ転送できます。配信サーバー自体はループバックアドレスだけで待ち受けるため、ホスト名を書き換えるだけではネットワークに公開されません。

送信側と受信側の両方からマニフェスト、セグメント、字幕へ到達でき、両方がTLS証明書を信頼している必要があります。プロキシでも、クロスオリジンとバイト範囲の応答を維持してください。受信機からはスマートフォンやエミュレーターのlocalhost、USB経由のポート転送は利用できません。この配信サーバーには認証がないため、必要な素材のルートだけを公開してください。開発用ツールは`/prepared/<ID>/source.mp4`から生成済みMP4を取得できます。これは通常のライブ再生用のパスとは別です。

<a id="separately-prepared-cloud-media"></a>
## 別途用意するクラウドの素材

クラウドでの素材準備はこのローカル生成処理とは別です。公開されているbitovpのガイドには[APIトークン](https://kazuhide.github.io/bitovp/guide/access-and-administration/)、[VODエンコーディング](https://kazuhide.github.io/bitovp/guide/vod-encoding/)、[ライブエンコーディング](https://kazuhide.github.io/bitovp/guide/live-encoding/)、[録画とLive-to-VOD](https://kazuhide.github.io/bitovp/guide/programs-and-recording/)の手順があります。ジョブの作成、URLの取得、これらのリンクだけでは、再生や受信機との互換性を確認したことにはなりません。

`CATALOG_URL`にはHTTP(S)のカタログを指定できます。指定しない場合、Androidは`MEDIA_BASE_URL`から`catalog.json`を要求し、取得できなければアプリに含めたカタログへ切り替えることができます。カタログを別の場所で配信する場合も、その中の相対URLは`MEDIA_BASE_URL`を基準に解決します。スポーツ配信のカタログではユーザー名とパスワードを埋め込んでいないHTTP(S)の絶対配信URLも使えます。

エンコーダーが作成したマニフェストだけでは、このアプリが必要とするイベント状態の情報や、確認済みのアーカイブ区間は得られません。ライブからアーカイブへの引き継ぎを試す場合は、互換性のある状態・対応情報を用意するか、利用できない対応情報を不明のままにしてください。ローカル配信サーバーは生成済みファイルを配信するもので、クラウドへのプロキシではありません。

アカウントトークン、ストレージ認証情報、私有URLや署名付き配信URLを、コミットするカタログ、確認記録、コマンド例、キャプチャへ含めないでください。この素材生成CLIはクラウドの認証情報を受け付けません。アプリ用ライセンスは[Androidの設定](../README.ja.md#requirements-and-configuration)で説明する非公開の設定ファイルに保存してください。
