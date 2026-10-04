// 対象: src/web/static.js
// ページと、ブラウザ向けの設定値(/config.json)の配信を確かめる(代役のレスポンスを使い、通信なし)

import assert from 'node:assert/strict';
import { test } from 'node:test';

// 読み込み時に環境変数を検証するため、読み込む前に設定する
Object.assign(process.env, {
  CLIENT_RECONNECT_DELAY_MS: '2500',
  CLIENT_AUDIO_CHUNK_MS: '120',
});
const { serveStatic } = await import('../web/static.js');

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

async function get(url, headers = {}) {
  const res = fakeResponse();
  await serveStatic({ method: 'GET', url, headers }, res);
  return res;
}

test('/config.json で、ブラウザ側が使う設定値を返す', async () => {
  const res = await get('/config.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.body), {
    wsPath: '/ws',
    sampleRate: 24000,
    speechSampleRate: 24000,
    reconnectDelayMs: 2500,
    audioChunkMs: 120,
  });
});

test('トップページを返す', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
});

test('ページのスクリプトを返す', async () => {
  const res = await get('/scripts/avatar.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/javascript; charset=utf-8');
});

test('ブラウザが保存済みの内容と同じなら、本文を送らずに 304 を返す', async () => {
  const first = await get('/scripts/avatar.js');
  assert.equal(first.headers['Cache-Control'], 'no-cache');
  assert.ok(first.headers.ETag);

  const same = await get('/scripts/avatar.js', { 'if-none-match': first.headers.ETag });
  assert.equal(same.status, 304);
  assert.equal(same.body, undefined);

  const stale = await get('/scripts/avatar.js', { 'if-none-match': '"old"' });
  assert.equal(stale.status, 200);
  assert.ok(stale.body.length > 0);
});

test('3D 表示のライブラリのうち、ブラウザが使う部分を返す', async () => {
  for (const path of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js']) {
    const res = await get(`/vendor/three/${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['Content-Type'], 'text/javascript; charset=utf-8');
  }
  assert.equal((await get('/vendor/three/package.json')).status, 404);
});

test('3D モデルの置き場所にないファイルは 404 にする', async () => {
  assert.equal((await get('/models/missing.glb')).status, 404);
});

test('配信するディレクトリの外は 404 にする', async () => {
  assert.equal((await get('/scripts/../../server.js')).status, 404);
  assert.equal((await get('/models/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await get('/vendor/three/build/../package.json')).status, 404);
});

test('対応しないパスは 404 にする', async () => {
  const res = await get('/unknown');
  assert.equal(res.status, 404);
});
