import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createConnectionHandler } from './connection.js';
import { initDevice } from './hardware/device.js';
import { createInputSession } from './input-session.js';
import { WS_PATH } from './lib/constants.js';
import { failStartup, requirePositiveInt } from './lib/env.js';
import { startHeartbeat } from './web/heartbeat.js';
import { serveStatic } from './web/static.js';

const port = Number(process.env.PORT ?? 3000);
// 再生終了の報告が届かない場合に、出力モードを打ち切って入力モードへ戻すまでの時間
const outputTimeoutMs = requirePositiveInt('OUTPUT_TIMEOUT_MS');

// ハードウェア制御が有効なら、配線や設定の誤りを起動時に見つけられるよう、ここで初期化しておく
try {
  await initDevice();
} catch (err) {
  failStartup(`ハードウェア制御を初期化できません: ${err.message}`);
}

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
