// 対象: src/llm/providers/claude.js
// Claude 用のリクエストの組み立てと、応答からの結果の取り出しを確かめる(外部通信なし)

import assert from 'node:assert/strict';
import { test } from 'node:test';

// プロバイダは読み込み時に環境変数を検証するため、読み込む前に設定する(通信は行わない)
Object.assign(process.env, {
  ANTHROPIC_API_KEY: 'test-key',
  LLM_CLAUDE_MODEL: 'test-claude-model',
  LLM_OPENAI_MODEL: 'test-openai-model',
  LLM_EFFORT: 'low',
  LLM_MAX_TOKENS: '16000',
  LLM_WEB_SEARCH_MAX_USES: '3',
});
const { buildRequest, extractText } = await import('../llm/providers/claude.js');

const schema = { type: 'object' };

// Messages API の応答のうち、取り出しに使う部分だけを持つオブジェクトを作る
function message(content, stopReason = 'end_turn') {
  return { stop_reason: stopReason, content };
}

test('設定と入力から Messages API のリクエストを組み立てる', () => {
  assert.deepEqual(buildRequest({ system: 'システム指示', conversation: '会話', schema }), {
    model: 'test-claude-model',
    max_tokens: 16000,
    system: 'システム指示',
    messages: [{ role: 'user', content: '会話' }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema },
    },
  });
});

test('完了した応答からテキストを取り出す', () => {
  assert.equal(extractText(message([{ type: 'text', text: '{"a":1}' }])), '{"a":1}');
});

test('検索のブロックや前置きの文があっても、最後のテキストを取り出す', () => {
  const content = [
    { type: 'text', text: '検索して確認します。' },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: '三重県 地方区分' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
    { type: 'text', text: '{"a":1}' },
  ];
  assert.equal(extractText(message(content)), '{"a":1}');
});

for (const stopReason of ['refusal', 'max_tokens', 'pause_turn']) {
  test(`stop_reason が ${stopReason} の応答は失敗にする`, () => {
    assert.throws(
      () => extractText(message([{ type: 'text', text: '{"a":1}' }], stopReason)),
      new RegExp(stopReason),
    );
  });
}

test('テキストのない応答は失敗にする', () => {
  assert.throws(() => extractText(message([])), /テキスト/);
});
