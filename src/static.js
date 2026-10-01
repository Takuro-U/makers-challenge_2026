import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';

const RESOURCES_DIR = join(import.meta.dirname, '..', 'resources');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

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

/** resources/ 配下のページとスクリプトを配信する HTTP ハンドラ */
export async function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
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
