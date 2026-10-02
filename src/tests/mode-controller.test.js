// 対象: src/mode-controller.js
// 待機・入力・出力のモード遷移と、マイク担当の割り当て・解放を確かめる(模擬タイマーを使用)

import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ModeController } from '../mode-controller.js';

const OUTPUT_TIMEOUT_MS = 60000;

// クライアントは同一性だけで区別されるので、目印のオブジェクトで足りる
const alice = { name: 'alice' };
const bob = { name: 'bob' };

let controller;
let changes;

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  changes = 0;
  controller = new ModeController({
    outputTimeoutMs: OUTPUT_TIMEOUT_MS,
    onChange: () => { changes += 1; },
  });
});

test('最初は待機モードで、担当はいない', () => {
  assert.equal(controller.mode, 'standby');
  assert.equal(controller.owner, null);
});

test('待機モードで開始したクライアントが担当になり、入力モードに移る', () => {
  assert.equal(controller.start(alice), true);
  assert.equal(controller.mode, 'input');
  assert.equal(controller.owner, alice);
  assert.equal(changes, 1);
});

test('担当がいる間の開始は断り、担当を変えない', () => {
  controller.start(alice);
  assert.equal(controller.start(bob), false);
  assert.equal(controller.owner, alice);
  assert.equal(changes, 1);
});

test('担当が停止すると、待機モードに戻り担当を外す', () => {
  controller.start(alice);
  controller.stop(alice);
  assert.equal(controller.mode, 'standby');
  assert.equal(controller.owner, null);
  assert.equal(changes, 2);
});

test('担当以外の停止は無視する', () => {
  controller.start(alice);
  controller.stop(bob);
  assert.equal(controller.mode, 'input');
  assert.equal(controller.owner, alice);
  assert.equal(changes, 1);
});

test('担当が切断すると、待機モードに戻り担当を外す', () => {
  controller.start(alice);
  controller.disconnect(alice);
  assert.equal(controller.mode, 'standby');
  assert.equal(controller.owner, null);
});

test('担当以外の切断では何も変わらない', () => {
  controller.start(alice);
  controller.disconnect(bob);
  assert.equal(controller.mode, 'input');
  assert.equal(changes, 1);
});

test('入力モードから出力モードに移れ、担当は変わらない', () => {
  controller.start(alice);
  assert.equal(controller.beginOutput(), true);
  assert.equal(controller.mode, 'output');
  assert.equal(controller.owner, alice);
});

test('待機モードからは出力モードに移れない', () => {
  assert.equal(controller.beginOutput(), false);
  assert.equal(controller.mode, 'standby');
  assert.equal(changes, 0);
});

test('担当が再生の終了を報告すると、入力モードに戻る', () => {
  controller.start(alice);
  controller.beginOutput();
  controller.endOutput(alice);
  assert.equal(controller.mode, 'input');
  assert.equal(controller.owner, alice);
});

test('担当以外からの再生終了の報告は無視する', () => {
  controller.start(alice);
  controller.beginOutput();
  controller.endOutput(bob);
  assert.equal(controller.mode, 'output');
});

test('再生終了の報告が届かなくても、時間切れで入力モードに戻る', () => {
  controller.start(alice);
  controller.beginOutput();
  mock.timers.tick(OUTPUT_TIMEOUT_MS - 1);
  assert.equal(controller.mode, 'output');
  mock.timers.tick(1);
  assert.equal(controller.mode, 'input');
  assert.equal(controller.owner, alice);
});

test('出力モード中に担当が停止したら待機モードに戻り、時間切れでは変わらない', () => {
  controller.start(alice);
  controller.beginOutput();
  controller.stop(alice);
  mock.timers.tick(OUTPUT_TIMEOUT_MS);
  assert.equal(controller.mode, 'standby');
  assert.equal(changes, 3);
});

test('音声を受け付けるのは、入力モードの担当からだけ', () => {
  assert.equal(controller.acceptsAudioFrom(alice), false);
  controller.start(alice);
  assert.equal(controller.acceptsAudioFrom(alice), true);
  assert.equal(controller.acceptsAudioFrom(bob), false);
  controller.beginOutput();
  assert.equal(controller.acceptsAudioFrom(alice), false);
});
