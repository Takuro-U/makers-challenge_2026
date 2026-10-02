import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { failStartup, requirePositiveInt } from '../lib/env.js';
import { provider } from './provider.js';

const CONFIG_DIR = import.meta.dirname;

const contextSize = requirePositiveInt('LLM_HISTORY_CONTEXT_SIZE');
if (contextSize > requirePositiveInt('HISTORY_BUFFER_SIZE')) {
  failStartup('LLM_HISTORY_CONTEXT_SIZE は HISTORY_BUFFER_SIZE 以下で指定してください');
}

function readConfig(relativePath, parse = (text) => text) {
  const path = join(CONFIG_DIR, relativePath);
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (err) {
    failStartup(`設定ファイルを読み込めません(${path}): ${err.message}`);
  }
}

const systemPrompt = readConfig('prompts/rebuttal-system.md');
const responseSchema = readConfig('schemas/rebuttal-response.json', JSON.parse);

// 会話履歴を 1 行 1 発言で並べ、トリガ発言を <trigger> で囲む
function renderConversation(entries, triggers) {
  const lines = entries.map((entry) => {
    const line = `[${entry.timestamp.toISOString()}] ${entry.text}`;
    return triggers.includes(entry) ? `<trigger>${line}</trigger>` : line;
  });
  return `<conversation>\n${lines.join('\n')}\n</conversation>`;
}

/**
 * 連鎖の起点となる反論リクエスト(選択中のプロバイダのリクエスト本文)を組み立てる。
 * 呼び出した時点の会話履歴バッファの直近履歴を含めるため、トリガのあとに届いた発言も入る。
 * @param {import('../history-buffer.js').HistoryBuffer} history トリガ発言を追記済みのバッファ
 * @param {Array<{ timestamp: Date, text: string }>} triggers history.push() が返したトリガ発言
 */
export function buildRebuttalRequest(history, triggers) {
  return provider.buildRequest({
    system: systemPrompt,
    conversation: renderConversation(history.recent(contextSize), triggers),
    schema: responseSchema,
  });
}
