import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { failStartup, requireEnv, requireOneOf, requirePositiveInt } from '../lib/env.js';

const CONFIG_DIR = import.meta.dirname;

const model = requireEnv('LLM_MODEL');
const maxTokens = requirePositiveInt('LLM_MAX_TOKENS');
const effort = requireOneOf('LLM_EFFORT', ['low', 'medium', 'high', 'xhigh', 'max']);
const webSearchMaxUses = requirePositiveInt('LLM_WEB_SEARCH_MAX_USES');
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

// 会話履歴を 1 行 1 発言で並べ、判定対象の発言を <trigger> で囲む
function renderConversation(entries, trigger) {
  const lines = entries.map((entry) => {
    const line = `[${entry.timestamp.toISOString()}] ${entry.text}`;
    return entry === trigger ? `<trigger>${line}</trigger>` : line;
  });
  return `<conversation>\n${lines.join('\n')}\n</conversation>`;
}

/**
 * 連鎖の起点となる反論リクエスト(Messages API のリクエスト本文)を組み立てる。
 * トリガ発言 + 会話履歴バッファの直近履歴を含める。
 * @param {import('../conversation/history-buffer.js').HistoryBuffer} history トリガ発言を追記済みのバッファ
 * @param {{ timestamp: Date, text: string }} trigger history.push() が返したトリガ発言
 */
export function buildRebuttalRequest(history, trigger) {
  return {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: renderConversation(history.recent(contextSize), trigger) },
    ],
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: webSearchMaxUses },
    ],
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema: responseSchema },
    },
  };
}
