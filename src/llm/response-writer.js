import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RESPONSES_DIR = join(import.meta.dirname, '..', '..', 'storage', 'llm-responses');

/**
 * 受け取った LLM の応答を 1 応答 1 ファイルの JSON で書き出す(動作確認用)。
 * @returns {Promise<string>} 書き出したファイルのパス
 */
export async function writeLlmResponse(connectionId, record) {
  mkdirSync(RESPONSES_DIR, { recursive: true });
  const createdAt = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(RESPONSES_DIR, `${createdAt}_${connectionId}.json`);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}
