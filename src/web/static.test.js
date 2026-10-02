import assert from 'node:assert/strict';
import { test } from 'node:test';

// 読み込み時に環境変数を検証するため、読み込む前に設定する
Object.assign(process.env, {
  CLIENT_RECONNECT_DELAY_MS: '2500',
  CLIENT_AUDIO_CHUNK_MS: '120',
});
const { serveStatic } = await import('./static.js');

// http.ServerResponse のうち、配信の処理が使う部分だけを持つ代役
function fakeResponse() {
  return {
    status: null,
    headers: {},
    body: null,
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function get(url) {
  const res = fakeResponse();
  await serveStatic({ method: 'GET', url }, res);
  return res;
}

test('/config.json で、ブラウザ側が使う設定値を返す', async () => {
  const res = await get('/config.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.body), {
    wsPath: '/ws',
    sampleRate: 24000,
    reconnectDelayMs: 2500,
    audioChunkMs: 120,
  });
});

test('トップページを返す', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
});

test('対応しないパスは 404 にする', async () => {
  const res = await get('/unknown');
  assert.equal(res.status, 404);
});
