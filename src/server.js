import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createConnectionHandler } from './connection.js';
import { createInputSession } from './input-session.js';
import { WS_PATH } from './lib/constants.js';
import { requirePositiveInt } from './lib/env.js';
import { startHeartbeat } from './web/heartbeat.js';
import { serveStatic } from './web/static.js';

const port = Number(process.env.PORT ?? 3000);
// 再生終了の報告が届かない場合に、出力モードを打ち切って入力モードへ戻すまでの時間
const outputTimeoutMs = requirePositiveInt('OUTPUT_TIMEOUT_MS');

const server = createServer(serveStatic);

const wss = new WebSocketServer({ server, path: WS_PATH });
startHeartbeat(wss);
wss.on('connection', createConnectionHandler({
  createSession: createInputSession,
  outputTimeoutMs,
}));

server.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
