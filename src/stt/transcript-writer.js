import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

/**
 * 確定結果を 1 件 1 行のテキストで書き出す(動作確認用)。
 * 入力の処理 1 回につき 1 ファイル。
 * @param {string} dir 入力の処理 1 回分のログの置き場所
 */
export function createTranscriptWriter(dir) {
  const path = join(dir, 'transcript.txt');
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
