import OpenAI from 'openai';
import { requireEnv, requirePositiveInt } from '../../lib/env.js';

const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });

const model = requireEnv('LLM_OPENAI_MODEL');
const maxTokens = requirePositiveInt('LLM_MAX_TOKENS');
// 受け付ける値がモデルによって異なるため、ここでは検証せず API に委ねる
const effort = requireEnv('LLM_EFFORT');
const webSearchMaxUses = requirePositiveInt('LLM_WEB_SEARCH_MAX_USES');

/**
 * Responses API のリクエスト本文を組み立てる。
 * @param {{ system: string, conversation: string, schema: object }} input
 */
export function buildRequest({ system, conversation, schema }) {
  return {
    model,
    instructions: system,
    input: conversation,
    max_output_tokens: maxTokens,
    max_tool_calls: webSearchMaxUses,
    tools: [
      { type: 'web_search' },
    ],
    reasoning: { effort },
    text: {
      format: { type: 'json_schema', name: 'rebuttal_response', schema, strict: true },
    },
    // 応答をあとから参照することはないため、OpenAI 側に保存させない
    store: false,
  };
}

/** リクエストを 1 回だけ送り、応答(Response)を返す */
export function send(request) {
  return client.responses.create(request);
}

/**
 * 応答から結果の JSON 文字列を取り出す。
 * 完了していない応答(打ち切り・失敗)や拒否された応答は例外にする。
 * @param {{ status: string, incomplete_details?: { reason?: string } | null, output: Array<{ type: string, content?: Array<{ type: string, text?: string, refusal?: string }> }> }} response
 */
export function extractText(response) {
  if (response.status !== 'completed') {
    const reason = response.incomplete_details?.reason;
    throw new Error(`応答が完了していません(status: ${response.status}${reason ? `, reason: ${reason}` : ''})`);
  }
  // 推論や検索の項目、途中経過のメッセージが先に並ぶため、結果の JSON は最後のメッセージにある
  const content = response.output.findLast((item) => item.type === 'message')?.content ?? [];
  const refusal = content.find((part) => part.type === 'refusal');
  if (refusal) throw new Error(`応答が拒否されました: ${refusal.refusal}`);
  const text = content.findLast((part) => part.type === 'output_text')?.text;
  if (!text) throw new Error('応答にテキストがありません');
  return text;
}
