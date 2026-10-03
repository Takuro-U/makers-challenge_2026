// 対象: src/rebuttal-output.js
// 反論を音声にして担当の端末で再生させる手順(合成 → 最初の音声で出力モードへ切り替え → 届いた順に送信 → 終わりの通知)を確かめる
// (音声合成は代役に差し替え、外部通信なし)

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { speakRebuttal } from '../rebuttal-output.js';

const first = Buffer.from([1, 2]);
const second = Buffer.from([3, 4]);

let events;
let logs;
let output;

beforeEach(() => {
  events = [];
  logs = [];
  output = {
    accept: true,
    // 何個目の音声まで送れるか(出力モードが途中で終わる場合を模擬する)
    playable: Infinity,
    begin() {
      events.push('begin');
      return this.accept;
    },
    play(data) {
      if (this.playable <= 0) return false;
      this.playable -= 1;
      events.push(['play', data]);
      return true;
    },
    end() {
      events.push('end');
    },
  };
});

function speak(synthesize) {
  return speakRebuttal({ text: '反論文', synthesize, output, log: (message) => logs.push(message) });
}

test('届いた音声を、出力モードに切り替えてから順に担当の端末へ送り、最後に終わりを知らせる', async () => {
  const spoken = await speak(async function* (text) {
    events.push(['synthesize', text]);
    yield first;
    yield second;
  });

  assert.equal(spoken, true);
  assert.deepEqual(events, [['synthesize', '反論文'], 'begin', ['play', first], ['play', second], 'end']);
});

test('最初の音声が届くまでは出力モードに切り替えず、届いたら合成の完了を待たずに送る', async () => {
  let release;
  const speaking = speak(async function* () {
    await new Promise((resolve) => { release = resolve; });
    yield first;
    await new Promise((resolve) => { release = resolve; });
    yield second;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);

  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['begin', ['play', first]]);

  release();
  await speaking;
  assert.deepEqual(events, ['begin', ['play', first], ['play', second], 'end']);
});

test('出力モードに切り替えたら、再生開始時の処理が終わるのを待ってから最初の音声を送る', async () => {
  let finishStart;
  const speaking = speakRebuttal({
    text: '反論文',
    synthesize: async function* () {
      yield first;
      yield second;
    },
    output,
    log: (message) => logs.push(message),
    onStart: () => {
      events.push('start');
      return new Promise((resolve) => { finishStart = resolve; });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['begin', 'start']);

  finishStart();
  assert.equal(await speaking, true);
  assert.deepEqual(events, ['begin', 'start', ['play', first], ['play', second], 'end']);
});

test('再生開始時の処理に失敗したら、音声を送らずに終わりを知らせ、残りの合成を打ち切る', async () => {
  let finished = false;
  const spoken = await speakRebuttal({
    text: '反論文',
    synthesize: async function* () {
      try {
        yield first;
        yield second;
      } finally {
        finished = true;
      }
    },
    output,
    log: (message) => logs.push(message),
    onStart: async () => {
      throw new Error('サーボが応答しません');
    },
  });

  assert.equal(spoken, false);
  assert.equal(finished, true);
  assert.deepEqual(events, ['begin', 'end']);
  assert.match(logs.join('\n'), /サーボが応答しません/);
});

test('出力モードに切り替えられなければ、再生の開始を知らせない', async () => {
  output.accept = false;
  await speakRebuttal({
    text: '反論文',
    synthesize: async function* () {
      yield first;
    },
    output,
    log: (message) => logs.push(message),
    onStart: () => events.push('start'),
  });

  assert.deepEqual(events, ['begin']);
});

test('合成に失敗したら、出力モードに切り替えずに理由をログに出す', async () => {
  const spoken = await speak(async function* () {
    throw new Error('合成できません');
  });

  assert.equal(spoken, false);
  assert.deepEqual(events, []);
  assert.match(logs.join('\n'), /合成できません/);
});

test('合成が途中で失敗したら、送った分で終わりを知らせて理由をログに出す', async () => {
  const spoken = await speak(async function* () {
    yield first;
    throw new Error('途中で切れました');
  });

  assert.equal(spoken, true);
  assert.deepEqual(events, ['begin', ['play', first], 'end']);
  assert.match(logs.join('\n'), /途中で切れました/);
});

test('出力モードに切り替えられなければ、音声を送らずに破棄する', async () => {
  output.accept = false;
  const spoken = await speak(async function* () {
    yield first;
  });

  assert.equal(spoken, false);
  assert.deepEqual(events, ['begin']);
  assert.match(logs.join('\n'), /破棄/);
});

test('途中で送れなくなったら、残りの合成を打ち切る', async () => {
  output.playable = 1;
  let finished = false;
  const spoken = await speak(async function* () {
    try {
      yield first;
      yield second;
      yield Buffer.from([5, 6]);
    } finally {
      finished = true;
    }
  });

  assert.equal(spoken, true);
  assert.equal(finished, true);
  assert.deepEqual(events, ['begin', ['play', first], 'end']);
});
