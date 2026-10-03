import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { SAMPLE_RATE, SPEECH_SAMPLE_RATE, WS_PATH } from '../lib/constants.js';
import { requirePositiveInt } from '../lib/env.js';

const RESOURCES_DIR = join(import.meta.dirname, '..', 'resources');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// ブラウザ側は環境変数もサーバの定数も読めないため、必要な値を /config.json で配る
const clientConfig = JSON.stringify({
  wsPath: WS_PATH,
  sampleRate: SAMPLE_RATE,
  speechSampleRate: SPEECH_SAMPLE_RATE,
  reconnectDelayMs: requirePositiveInt('CLIENT_RECONNECT_DELAY_MS'),
  audioChunkMs: requirePositiveInt('CLIENT_AUDIO_CHUNK_MS'),
});

// URL のパスを resources/ 配下のファイルに対応づける。対応しなければ null
function resolveResource(urlPath) {
  if (urlPath === '/') return join(RESOURCES_DIR, 'pages', 'index.html');
  if (urlPath.startsWith('/scripts/')) {
    const scriptsDir = join(RESOURCES_DIR, 'scripts');
    const file = normalize(join(scriptsDir, urlPath.slice('/scripts/'.length)));
    // ディレクトリトラバーサルを防ぐ
    if (file.startsWith(scriptsDir + sep)) return file;
  }
  return null;
}

/** resources/ 配下のページとスクリプト、ブラウザ側の設定値を配信する HTTP ハンドラ */
export async function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(clientConfig);
    return;
  }
  const file = req.method === 'GET' ? resolveResource(pathname) : null;
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}
