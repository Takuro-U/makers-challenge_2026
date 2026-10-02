import { requirePositiveInt } from '../lib/env.js';

// 切断を通知せずに消えたクライアントを検出する間隔。1 周期の間に pong が返らなければ切断する
const intervalMs = requirePositiveInt('HEARTBEAT_INTERVAL_MS');

/**
 * WebSocket サーバの全クライアントに定期的に ping を送り、応答のないクライアントを切断する。
 * 切断すると各接続の 'close' が発火し、接続ごとの後片付けが行われる。
 */
export function startHeartbeat(wss) {
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, intervalMs);
  wss.on('close', () => clearInterval(timer));
}
