# 開発用コマンド

コマンドはすべてプロジェクトルートで実行する。ホストには Node.js が入っていないため、`node` / `npm` は `backend` コンテナ内で実行する。

## セットアップ

```bash
cp .env.example .env              # その後 OPENAI_API_KEY と STT_MODEL を設定する
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

確定結果は `storage/transcripts/<開始時刻>_<接続ID>.txt` に書き出される(WebSocket の接続 1 回につき 1 ファイル)。

```bash
ls -lt storage/transcripts/                             # 出力ファイルを新しい順に一覧
tail -f "$(ls -t storage/transcripts/*.txt | head -1)"  # 最新のファイルを追従表示
```

## 後片付け

```bash
docker compose down --rmi all     # node:24-slim イメージも削除
```
