# 開発用コマンド

コマンドはすべてプロジェクトルートで実行する。ホストには Node.js が入っていないため、`node` / `npm` は `backend` コンテナ内で実行する。

## セットアップ

```bash
cp .env.example .env              # その後 API キーと、値が空の項目をすべて設定する(LLM_PROVIDER で選ばなかった側のモデルは空でよい。openai を選んだ場合は ANTHROPIC_API_KEY も空でよい)
docker compose up -d              # 起動(.env / compose.yaml の変更後はコンテナの再作成も兼ねる)
```

## 起動・停止

```bash
docker compose up -d              # バックグラウンドで起動
docker compose down               # 停止してコンテナを削除
docker compose restart backend    # 再起動(依存の追加・削除後に必要)
```

## 状態・ログの確認

```bash
docker compose ps                 # コンテナの状態
docker compose logs -f backend    # ログを追従表示(Ctrl+C で終了)
curl -I http://localhost:3000/    # サーバが応答するか確認
```

サーバのプロセスが終了していても(例: `STT_MODEL` が未設定)、`node --watch` がファイル変更を待ち続けるため `docker compose ps` は `Up` と表示する。ログに `Failed running 'src/server.js'` が出ていないかで確認する。

## 依存パッケージ

```bash
docker compose exec backend npm install <package>
docker compose exec backend npm uninstall <package>
docker compose restart backend    # node_modules の変更後は --watch が監視を外すことがある
```

## シェル・デバッグ

```bash
docker compose exec backend sh              # コンテナ内のシェル
docker compose exec backend node --version  # コンテナ内の Node.js のバージョン
```

## ログの出力

「開始」から「停止」までの入力 1 回につき、`storage/logs/<開始時刻>/` を 1 つ作り、その中に文字起こしと動作レポートを書き出す。

```bash
ls -lt storage/logs/                                         # 入力ごとのディレクトリを新しい順に一覧
tail -f "$(ls -dt storage/logs/*/ | head -1)transcript.txt"  # 最新の文字起こしを追従表示
cat "$(ls -dt storage/logs/*/ | head -1)"report-1.json       # 最新の入力の 1 件目の動作レポートを表示
```

### 文字起こし

確定結果は `transcript.txt` に 1 件 1 行で書き出される。

### 動作レポート

一次フィルタに該当した確定結果があると、後続の発言を待ってから(仕様書 §8「発行の保留」)、`LLM_PROVIDER` で選んだプロバイダ(`claude` / `openai`)の API へリクエストを 1 回送る。待つ時間は `LLM_REQUEST_IDLE_MS` と `LLM_REQUEST_MAX_WAIT_MS` で指定する。モデルは `LLM_CLAUDE_MODEL` / `LLM_OPENAI_MODEL` でプロバイダごとに指定し、選んだ側だけが必須になる。`LLM_EFFORT` は共用なので、両プロバイダが受け付ける値(`low` / `medium` / `high` など)にしておけば `LLM_PROVIDER` の書き換えだけで切り替えられる。

リクエスト 1 件ごとに、処理が終わった時点(応答の受信、または音声合成の完了・失敗)で `report-<id>.json` が書き出される。`id` は入力ごとに 1 から振る。

| 項目 | 内容 |
| --- | --- |
| `id` | リクエストの番号 |
| `requestedAt` | リクエストを送った時刻 |
| `triggers` | フィルタに該当した発言(`text`)と該当語(`matchedTerms`)。保留中に複数該当すれば複数 |
| `firedBy` | 満了した待ち時間。`idle`(`LLM_REQUEST_IDLE_MS`)/ `max_wait`(`LLM_REQUEST_MAX_WAIT_MS`) |
| `context` | LLM に渡した会話(1 行 1 要素) |
| `llm.durationMs` | リクエストの送信から応答までの時間(ミリ秒) |
| `llm.result` | 判定結果(`decision` / `reason` / `rebuttal` / `sources`) |
| `llm.error` | 送信に失敗した、または応答を判定結果として読めなかった理由。読めなかった場合は `llm.text` に応答のテキストが入る |
| `tts.firstChunkMs` | 音声合成を依頼してから、最初の音声が届くまでの時間(ミリ秒)。再生が始まるまでの待ち時間にあたる |
| `tts.durationMs` | 音声合成を依頼してから、音声を最後まで受け取るまでの時間(ミリ秒)。`tts` は合成を行ったときだけ入る |
| `tts.played` | 担当の端末で再生を始めさせたか |
| `tts.error` | 合成に失敗した理由 |

判定が反論あり(`rebut`)なら、反論文を `TTS_MODEL` / `TTS_VOICE` / `TTS_SPEED`(読み上げの速さの倍率。`1.0` が等速)の設定で音声に合成し、マイクを担当している端末で再生する。音声は合成が終わるのを待たず、届いた分から順に再生する。合成した音声はファイルには残さない。口調は `src/tts/prompts/voice-instructions.md` で調整する(変更後はサーバの再起動が必要)。

## ハードウェア制御

反論の再生を始めるとき(最初の音声を端末へ送る直前)に、`src/hardware/react.js` の `react()` を呼び、サーボと効果音を動かす。動作の終了は待たずに再生を進め、失敗した場合は理由をサーバのログに出す。

`HARDWARE_CONTROL` で実機を動かすかどうかを切り替える。`on` なら起動時に I2C と GPIO を初期化し(`src/hardware/device.js`)、できなければ起動を中止する。`off` なら実機に触れず、何もせずに通過する(実機のない開発環境・コンテナ向け)。

サーボを戻す操作と一連の動作確認は、コマンドで直接実行する。

```bash
node --env-file=.env src/hardware/reset.js     # サーボを開始位置に戻す
node --env-file=.env src/hardware/test-all.js  # 反応とリセットを 3 回繰り返す
```

## テスト

```bash
docker compose exec backend npm test    # 外部サービスを呼ばない単体テストのみ
```

## 後片付け

```bash
docker compose down --rmi all     # node:24-slim イメージも削除
```
