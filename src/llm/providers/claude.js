import Anthropic from '@anthropic-ai/sdk';
import { requireEnv, requireOneOf, requirePositiveInt } from '../../lib/env.js';

const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });

const model = requireEnv('LLM_CLAUDE_MODEL');
const maxTokens = requirePositiveInt('LLM_MAX_TOKENS');
const effort = requireOneOf('LLM_EFFORT', ['low', 'medium', 'high', 'xhigh', 'max']);
const webSearchMaxUses = requirePositiveInt('LLM_WEB_SEARCH_MAX_USES');

/**
 * Messages API のリクエスト本文を組み立てる。
 * @param {{ system: string, conversation: string, schema: object }} input
 */
export function buildRequest({ system, conversation, schema }) {
  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: [
      { role: 'user', content: conversation },
    ],
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: webSearchMaxUses },
    ],
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
  };
}

/**
 * リクエストを 1 回だけ送り、完了した応答(Message)を返す。
 * Web 検索と思考で応答に時間がかかるため、タイムアウトを避けてストリーミングで受ける。
 * 応答が pause_turn で止まっても再開のリクエストは送らない。
 */
export function send(request) {
  return client.messages.stream(request).finalMessage();
}

/**
 * 応答から結果の JSON 文字列を取り出す。
 * 完了していない応答(拒否・打ち切り・中断)は例外にする。
 * @param {{ stop_reason: string | null, content: Array<{ type: string, text?: string }> }} message
 */
export function extractText(message) {
  if (message.stop_reason !== 'end_turn') {
    throw new Error(`応答が完了していません(stop_reason: ${message.stop_reason})`);
  }
  // Web 検索のブロックや前置きの文が先に並ぶため、結果の JSON は最後のテキストにある
  const text = message.content.findLast((block) => block.type === 'text')?.text;
  if (!text) throw new Error('応答にテキストがありません');
  return text;
}
