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

## 文字起こしの出力

確定結果は `storage/transcripts/<開始時刻>_<接続ID>.txt` に書き出される(「開始」から「停止」までの入力 1 回につき 1 ファイル。接続 ID はマイクを担当した端末のもの)。

```bash
ls -lt storage/transcripts/                             # 出力ファイルを新しい順に一覧
tail -f "$(ls -t storage/transcripts/*.txt | head -1)"  # 最新のファイルを追従表示
```

## LLM の入出力

一次フィルタに該当した確定結果があると、後続の発言を待ってから(仕様書 §8「発行の保留」)、`LLM_PROVIDER` で選んだプロバイダ(`claude` / `openai`)の API へリクエストを 1 回送る。待つ時間は `LLM_REQUEST_IDLE_MS` と `LLM_REQUEST_MAX_WAIT_MS` で指定する。モデルは `LLM_CLAUDE_MODEL` / `LLM_OPENAI_MODEL` でプロバイダごとに指定し、選んだ側だけが必須になる。`LLM_EFFORT` は共用なので、両プロバイダが受け付ける値(`low` / `medium` / `high` など)にしておけば `LLM_PROVIDER` の書き換えだけで切り替えられる。送ったリクエストは `storage/llm-requests/`、受け取った応答は `storage/llm-responses/` に、1 件 1 ファイルの JSON で書き出される。

```bash
ls -lt storage/llm-responses/                              # 出力ファイルを新しい順に一覧
cat "$(ls -t storage/llm-responses/*.json | head -1)"      # 最新の応答を表示
```

どちらのファイルも、`triggers` にフィルタに該当した発言と該当語が入る(保留中に複数該当すれば複数)。応答のファイルの `result` が判定結果、`response` が API の応答そのもの。応答を判定結果として読めなかった場合は、`result` の代わりに `error` に理由が入る。

## テスト

```bash
docker compose exec backend npm test    # 外部サービスを呼ばない単体テストのみ
```

## 後片付け

```bash
docker compose down --rmi all     # node:24-slim イメージも削除
```
