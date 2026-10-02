// 対象: src/llm/providers/openai.js
// OpenAI 用のリクエストの組み立てと、応答からの結果の取り出しを確かめる(外部通信なし)

import assert from 'node:assert/strict';
import { test } from 'node:test';

// プロバイダは読み込み時に環境変数を検証するため、読み込む前に設定する(通信は行わない)
Object.assign(process.env, {
  OPENAI_API_KEY: 'test-key',
  LLM_CLAUDE_MODEL: 'test-claude-model',
  LLM_OPENAI_MODEL: 'test-openai-model',
  LLM_EFFORT: 'low',
  LLM_MAX_TOKENS: '16000',
  LLM_WEB_SEARCH_MAX_USES: '3',
});
const { buildRequest, extractText } = await import('../llm/providers/openai.js');

const schema = { type: 'object' };

function outputMessage(...content) {
  return { type: 'message', role: 'assistant', status: 'completed', content };
}

function outputText(text) {
  return { type: 'output_text', text, annotations: [] };
}

// Responses API の応答のうち、取り出しに使う部分だけを持つオブジェクトを作る
function response(output, extra = {}) {
  return { status: 'completed', incomplete_details: null, output, ...extra };
}

test('設定と入力から Responses API のリクエストを組み立てる', () => {
  assert.deepEqual(buildRequest({ system: 'システム指示', conversation: '会話', schema }), {
    model: 'test-openai-model',
    instructions: 'システム指示',
    input: '会話',
    max_output_tokens: 16000,
    max_tool_calls: 3,
    tools: [{ type: 'web_search' }],
    reasoning: { effort: 'low' },
    text: {
      format: { type: 'json_schema', name: 'rebuttal_response', schema, strict: true },
    },
    store: false,
  });
});

test('完了した応答からテキストを取り出す', () => {
  assert.equal(extractText(response([outputMessage(outputText('{"a":1}'))])), '{"a":1}');
});

test('推論や検索の項目、途中経過のメッセージがあっても、最後のメッセージのテキストを取り出す', () => {
  const output = [
    { type: 'reasoning', summary: [] },
    outputMessage(outputText('検索して確認します。')),
    { type: 'web_search_call', status: 'completed' },
    outputMessage(outputText('{"a":1}')),
  ];
  assert.equal(extractText(response(output)), '{"a":1}');
});

test('打ち切られた応答は、理由を添えて失敗にする', () => {
  const incomplete = response([outputMessage(outputText('{"a":'))], {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
  });
  assert.throws(() => extractText(incomplete), /incomplete.*max_output_tokens/);
});

test('失敗した応答は失敗にする', () => {
  assert.throws(() => extractText(response([], { status: 'failed' })), /failed/);
});

test('拒否された応答は、拒否の文を添えて失敗にする', () => {
  const refused = response([outputMessage({ type: 'refusal', refusal: 'お手伝いできません。' })]);
  assert.throws(() => extractText(refused), /拒否.*お手伝いできません。/);
});

test('テキストのない応答は失敗にする', () => {
  assert.throws(() => extractText(response([{ type: 'reasoning', summary: [] }])), /テキスト/);
});
