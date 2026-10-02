import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createConnectionHandler } from './connection.js';
import { createInputSession } from './input-session.js';
import { startHeartbeat } from './web/heartbeat.js';
import { serveStatic } from './web/static.js';

const port = Number(process.env.PORT ?? 3000);
// 再生終了の報告が届かない場合に、出力モードを打ち切って入力モードへ戻すまでの時間
const OUTPUT_TIMEOUT_MS = 60 * 1000;

const server = createServer(serveStatic);

const wss = new WebSocketServer({ server, path: '/ws' });
startHeartbeat(wss);
wss.on('connection', createConnectionHandler({
  createSession: createInputSession,
  outputTimeoutMs: OUTPUT_TIMEOUT_MS,
}));

server.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
