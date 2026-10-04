import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { SAMPLE_RATE, SPEECH_SAMPLE_RATE, WS_PATH } from '../lib/constants.js';
import { requirePositiveInt } from '../lib/env.js';

const RESOURCES_DIR = join(import.meta.dirname, '..', 'resources');
const PROJECT_DIR = join(import.meta.dirname, '..', '..');
const THREE_DIR = join(PROJECT_DIR, 'node_modules', 'three');

// URL のパスの先頭と、配信するディレクトリの対応
const MOUNTS = [
  ['/scripts/', join(RESOURCES_DIR, 'scripts')],
  ['/models/', join(PROJECT_DIR, 'assets', 'models')],
  // 3D 表示のライブラリ。ブラウザが使う部分だけを配る
  ['/vendor/three/build/', join(THREE_DIR, 'build')],
  ['/vendor/three/examples/jsm/', join(THREE_DIR, 'examples', 'jsm')],
];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
};

// ブラウザ側は環境変数もサーバの定数も読めないため、必要な値を /config.json で配る
const clientConfig = JSON.stringify({
  wsPath: WS_PATH,
  sampleRate: SAMPLE_RATE,
  speechSampleRate: SPEECH_SAMPLE_RATE,
  reconnectDelayMs: requirePositiveInt('CLIENT_RECONNECT_DELAY_MS'),
  audioChunkMs: requirePositiveInt('CLIENT_AUDIO_CHUNK_MS'),
});

// URL のパスを配信するファイルに対応づける。対応しなければ null
function resolveResource(urlPath) {
  if (urlPath === '/') return join(RESOURCES_DIR, 'pages', 'index.html');
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = normalize(join(dir, urlPath.slice(prefix.length)));
    // ディレクトリトラバーサルを防ぐ
    return file.startsWith(dir + sep) ? file : null;
  }
  return null;
}

/** ページとスクリプト、3D モデル、ブラウザ側の設定値を配信する HTTP ハンドラ */
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
