import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TRANSCRIPTS_DIR = join(import.meta.dirname, '..', '..', 'storage', 'transcripts');

/**
 * 確定結果を 1 件 1 行のテキストで書き出す(動作確認用)。
 * WebSocket の接続 1 回につき 1 ファイル。
 */
export function createTranscriptWriter(connectionId) {
  mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(TRANSCRIPTS_DIR, `${startedAt}_${connectionId}.txt`);
  const out = createWriteStream(path, { flags: 'a' });

  return {
    path,
    write(text) {
      out.write(`${text}\n`);
    },
    close() {
      out.end();
    },
  };
}
