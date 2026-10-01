import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { SttSession } from './stt.js';
import { createTranscriptWriter } from './transcript-writer.js';

const port = Number(process.env.PORT ?? 3000);
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

const server = createServer(async (req, res) => {
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
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const id = randomUUID().slice(0, 8);
  const log = (message) => console.log(`[${id}] ${message}`);
  const writer = createTranscriptWriter(id);
  const stt = new SttSession({
    log,
    onFinal: (text) => {
      log(`final: ${text}`);
      writer.write(text);
    },
  });
  log(`connected -> ${writer.path}`);

  ws.on('message', (data, isBinary) => {
    if (isBinary) stt.write(data);
  });
  ws.on('close', () => {
    stt.close();
    writer.close();
    log('disconnected');
  });
});

server.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
