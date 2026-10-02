// 対象: src/connection.js
// WebSocket の接続処理が、モードの通知・担当の割り当て・音声の受け付けを正しく行うことを確かめる
// (代役のソケットを使い、通信なし)

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, test } from 'node:test';
import { createConnectionHandler } from '../connection.js';

// ws の WebSocket のうち、接続の処理が使う部分だけを持つ代役
class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent = [];

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  // クライアントからの制御メッセージ(テキストフレーム)
  receive(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }

  // クライアントからの音声(バイナリフレーム)
  receiveAudio(chunk) {
    this.emit('message', chunk, true);
  }

  disconnect() {
    this.readyState = 3;
    this.emit('close');
  }
}

let sessions;
let handleConnection;

beforeEach(() => {
  sessions = [];
  handleConnection = createConnectionHandler({
    outputTimeoutMs: 60000,
    createSession: ({ beginOutput }) => {
      const session = {
        written: [],
        closed: false,
        beginOutput,
        write(chunk) { this.written.push(chunk); },
        close() { this.closed = true; },
      };
      sessions.push(session);
      return session;
    },
  });
});

function connect() {
  const socket = new FakeSocket();
  handleConnection(socket);
  return socket;
}

const mode = (name, owner) => ({ type: 'mode', mode: name, owner });

test('接続したクライアントに現在のモードを送る', () => {
  const alice = connect();
  assert.deepEqual(alice.sent, [mode('standby', false)]);
});

test('開始したクライアントを担当にし、全クライアントに入力モードを知らせる', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });

  assert.deepEqual(alice.sent.at(-1), mode('input', true));
  assert.deepEqual(bob.sent.at(-1), mode('input', false));
  assert.equal(sessions.length, 1);
});

test('入力モードの途中で接続したクライアントにも、現在のモードを送る', () => {
  connect().receive({ type: 'start' });
  const bob = connect();
  assert.deepEqual(bob.sent, [mode('input', false)]);
});

test('担当がいる間の開始は断り、断ったクライアントに現在のモードを送り直す', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  const aliceCount = alice.sent.length;
  const bobCount = bob.sent.length;
  bob.receive({ type: 'start' });

  assert.equal(bob.sent.length, bobCount + 1);
  assert.deepEqual(bob.sent.at(-1), mode('input', false));
  assert.equal(alice.sent.length, aliceCount);
  assert.equal(sessions.length, 1);
});

test('担当からの音声だけを入力の処理に渡す', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  const chunk = Buffer.from([1, 2, 3, 4]);
  alice.receiveAudio(chunk);
  bob.receiveAudio(Buffer.from([9, 9]));

  assert.deepEqual(sessions[0].written, [chunk]);
});

test('待機モードで届いた音声は捨てる', () => {
  const alice = connect();
  alice.receiveAudio(Buffer.from([1, 2]));
  assert.equal(sessions.length, 0);
});

test('担当が停止すると、入力の処理を閉じて全クライアントに待機モードを知らせる', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  alice.receive({ type: 'stop' });

  assert.equal(sessions[0].closed, true);
  assert.deepEqual(alice.sent.at(-1), mode('standby', false));
  assert.deepEqual(bob.sent.at(-1), mode('standby', false));
});

test('担当以外の停止は無視する', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  bob.receive({ type: 'stop' });

  assert.equal(sessions[0].closed, false);
  assert.deepEqual(bob.sent.at(-1), mode('input', false));
});

test('担当が切断すると、入力の処理を閉じて残りのクライアントに待機モードを知らせる', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  alice.disconnect();

  assert.equal(sessions[0].closed, true);
  assert.deepEqual(bob.sent.at(-1), mode('standby', false));
});

test('停止のあとに別のクライアントが開始すると、新しい入力の処理を作って担当にする', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  alice.receive({ type: 'stop' });
  bob.receive({ type: 'start' });

  assert.equal(sessions.length, 2);
  assert.deepEqual(bob.sent.at(-1), mode('input', true));
  assert.deepEqual(alice.sent.at(-1), mode('input', false));
});

test('出力モードの間は音声を捨て、担当が再生の終了を報告したら入力モードに戻る', () => {
  const alice = connect();
  const bob = connect();
  alice.receive({ type: 'start' });
  sessions[0].beginOutput();
  assert.deepEqual(alice.sent.at(-1), mode('output', true));
  assert.deepEqual(bob.sent.at(-1), mode('output', false));

  alice.receiveAudio(Buffer.from([1, 2]));
  assert.deepEqual(sessions[0].written, []);

  bob.receive({ type: 'playback_ended' });
  assert.deepEqual(alice.sent.at(-1), mode('output', true));
  alice.receive({ type: 'playback_ended' });
  assert.deepEqual(alice.sent.at(-1), mode('input', true));
  assert.equal(sessions.length, 1);
});

test('読めないメッセージや未知のメッセージは無視する', () => {
  const alice = connect();
  alice.emit('message', Buffer.from('{ これは JSON ではない'), false);
  alice.receive({ type: 'unknown' });
  assert.deepEqual(alice.sent, [mode('standby', false)]);
});
