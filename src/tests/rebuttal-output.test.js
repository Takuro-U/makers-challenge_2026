// 対象: src/rebuttal-output.js
// 反論を音声にして担当の端末で再生させる手順(合成 → 出力モードへ切り替え → 送信)を確かめる
// (音声合成は代役に差し替え、外部通信なし)

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { speakRebuttal } from '../rebuttal-output.js';

const audio = Buffer.from([1, 2, 3]);

let events;
let logs;
let output;

beforeEach(() => {
  events = [];
  logs = [];
  output = {
    accept: true,
    begin() {
      events.push('begin');
      return this.accept;
    },
    play(data) {
      events.push(['play', data]);
    },
  };
});

function speak(synthesize) {
  return speakRebuttal({ text: '反論文', synthesize, output, log: (message) => logs.push(message) });
}

test('合成した音声を、出力モードに切り替えてから担当の端末へ送る', async () => {
  const spoken = await speak(async (text) => {
    events.push(['synthesize', text]);
    return audio;
  });

  assert.equal(spoken, true);
  assert.deepEqual(events, [['synthesize', '反論文'], 'begin', ['play', audio]]);
});

test('合成が終わるまでは出力モードに切り替えない', async () => {
  let finish;
  const speaking = speak(() => new Promise((resolve) => { finish = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);

  finish(audio);
  await speaking;
  assert.deepEqual(events, ['begin', ['play', audio]]);
});

test('合成に失敗したら、出力モードに切り替えずに理由をログに出す', async () => {
  const spoken = await speak(async () => {
    throw new Error('合成できません');
  });

  assert.equal(spoken, false);
  assert.deepEqual(events, []);
  assert.match(logs.join('\n'), /合成できません/);
});

test('出力モードに切り替えられなければ、音声を送らずに破棄する', async () => {
  output.accept = false;
  const spoken = await speak(async () => audio);

  assert.equal(spoken, false);
  assert.deepEqual(events, ['begin']);
  assert.match(logs.join('\n'), /破棄/);
});
