import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryBuffer } from '../conversation/history-buffer.js';

// 読み込み時に環境変数を検証するため、読み込む前に設定する(通信は行わない)
Object.assign(process.env, {
  LLM_PROVIDER: 'claude',
  ANTHROPIC_API_KEY: 'test-key',
  LLM_CLAUDE_MODEL: 'test-claude-model',
  LLM_EFFORT: 'low',
  LLM_MAX_TOKENS: '16000',
  LLM_WEB_SEARCH_MAX_USES: '3',
  LLM_HISTORY_CONTEXT_SIZE: '4',
  HISTORY_BUFFER_SIZE: '10',
});
const { buildRebuttalRequest } = await import('./request.js');

// 1 秒おきの時刻で発言を積む
function pushAll(history, texts) {
  return texts.map((text, i) => history.push(text, new Date(Date.UTC(2026, 9, 2, 9, 0, i))));
}

// Claude のリクエストでは、会話は最初のユーザーメッセージに入る
function conversationOf(request) {
  return request.messages[0].content;
}

test('トリガ発言を <trigger> で囲み、そのあとに届いた発言も含める', () => {
  const history = new HistoryBuffer(10);
  const [, trigger] = pushAll(history, ['こんにちは', 'ナガシマスパーランドは', '愛知県にありますか']);

  assert.equal(conversationOf(buildRebuttalRequest(history, [trigger])), [
    '<conversation>',
    '[2026-10-02T09:00:00.000Z] こんにちは',
    '<trigger>[2026-10-02T09:00:01.000Z] ナガシマスパーランドは</trigger>',
    '[2026-10-02T09:00:02.000Z] 愛知県にありますか',
    '</conversation>',
  ].join('\n'));
});

test('トリガ発言が複数あれば、すべてを <trigger> で囲む', () => {
  const history = new HistoryBuffer(10);
  const [first, , second] = pushAll(history, ['三重って何もないよね', 'そうかな', '伊勢も地味だし']);

  assert.equal(conversationOf(buildRebuttalRequest(history, [first, second])), [
    '<conversation>',
    '<trigger>[2026-10-02T09:00:00.000Z] 三重って何もないよね</trigger>',
    '[2026-10-02T09:00:01.000Z] そうかな',
    '<trigger>[2026-10-02T09:00:02.000Z] 伊勢も地味だし</trigger>',
    '</conversation>',
  ].join('\n'));
});

test('会話は直近の LLM_HISTORY_CONTEXT_SIZE 件に絞る', () => {
  const history = new HistoryBuffer(10);
  const entries = pushAll(history, ['一', '二', '三', '四', '五']);

  const lines = conversationOf(buildRebuttalRequest(history, [entries[4]])).split('\n');
  assert.equal(lines.length, 4 + 2);
  assert.match(lines[1], /二$/);
});
