import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REQUESTS_DIR = join(import.meta.dirname, '..', 'storage', 'llm-requests');

/**
 * 組み立てた LLM リクエストを 1 リクエスト 1 ファイルの JSON で書き出す(動作確認用)。
 * @returns {Promise<string>} 書き出したファイルのパス
 */
export async function writeLlmRequest(connectionId, record) {
  mkdirSync(REQUESTS_DIR, { recursive: true });
  const createdAt = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(REQUESTS_DIR, `${createdAt}_${connectionId}.json`);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}
