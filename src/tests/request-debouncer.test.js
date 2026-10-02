// 対象: src/llm/request-debouncer.js
// トリガから LLM リクエスト発行までの保留(猶予・上限・複数トリガの統合)を確かめる(模擬タイマーを使用)

import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { RequestDebouncer } from '../llm/request-debouncer.js';

const IDLE_MS = 2000;
const MAX_WAIT_MS = 8000;

let fired;
let debouncer;

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  fired = [];
  debouncer = new RequestDebouncer({
    idleMs: IDLE_MS,
    maxWaitMs: MAX_WAIT_MS,
    onFire: (triggers) => fired.push(triggers),
  });
});

// 発話 1 件ぶん(発話の開始から確定結果の到着まで)を、所要時間 ms で進める
function utterance(ms) {
  debouncer.hold();
  mock.timers.tick(ms);
  debouncer.release();
}

test('トリガから猶予が過ぎるまでは発行しない', () => {
  debouncer.trigger('a');
  mock.timers.tick(IDLE_MS - 1);
  assert.deepEqual(fired, []);
});

test('トリガから猶予が過ぎたら、そのトリガで発行する', () => {
  debouncer.trigger('a');
  mock.timers.tick(IDLE_MS);
  assert.deepEqual(fired, [['a']]);
});

test('新しい確定結果が届いたら、猶予を計り直す', () => {
  debouncer.trigger('a');
  mock.timers.tick(1500);
  debouncer.release();
  mock.timers.tick(IDLE_MS - 1);
  assert.deepEqual(fired, []);
  mock.timers.tick(1);
  assert.deepEqual(fired, [['a']]);
});

test('発話が続いている間は、猶予より長くても発行しない', () => {
  debouncer.trigger('a');
  debouncer.hold();
  mock.timers.tick(IDLE_MS * 2);
  assert.deepEqual(fired, []);
});

test('発話の確定結果が届いてから猶予が過ぎたら発行する', () => {
  debouncer.trigger('a');
  utterance(IDLE_MS * 2);
  mock.timers.tick(IDLE_MS - 1);
  assert.deepEqual(fired, []);
  mock.timers.tick(1);
  assert.deepEqual(fired, [['a']]);
});

test('保留中に立ったトリガは、1 回の発行に到着順でまとめる', () => {
  debouncer.trigger('a');
  mock.timers.tick(1000);
  debouncer.trigger('b');
  mock.timers.tick(IDLE_MS - 1);
  assert.deepEqual(fired, []);
  mock.timers.tick(1);
  assert.deepEqual(fired, [['a', 'b']]);
});

test('確定結果が届き続けても、最初のトリガから上限が過ぎたら打ち切って発行する', () => {
  debouncer.trigger('a');
  for (let elapsed = 0; elapsed < MAX_WAIT_MS - 1000; elapsed += 1000) utterance(1000);
  assert.deepEqual(fired, []);
  utterance(1000);
  assert.deepEqual(fired, [['a']]);
});

test('発話が途切れないままでも、上限が過ぎたら打ち切って発行する', () => {
  debouncer.trigger('a');
  debouncer.hold();
  mock.timers.tick(MAX_WAIT_MS);
  assert.deepEqual(fired, [['a']]);
});

test('発行したあとのトリガは、新しい保留として上限を計り直す', () => {
  debouncer.trigger('a');
  mock.timers.tick(IDLE_MS);
  debouncer.trigger('b');
  debouncer.hold();
  mock.timers.tick(MAX_WAIT_MS - 1);
  assert.deepEqual(fired, [['a']]);
  mock.timers.tick(1);
  assert.deepEqual(fired, [['a'], ['b']]);
});

test('保留がなければ、確定結果が届いても発行しない', () => {
  utterance(1000);
  mock.timers.tick(MAX_WAIT_MS);
  assert.deepEqual(fired, []);
});

test('取り消したら発行しない', () => {
  debouncer.trigger('a');
  debouncer.cancel();
  mock.timers.tick(MAX_WAIT_MS);
  assert.deepEqual(fired, []);
});
