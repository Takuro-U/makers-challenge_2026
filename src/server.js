import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer } from 'ws';
import { createConnectionHandler } from './connection.js';
import { initDevice } from './hardware/device.js';
import { reset } from './hardware/reset.js';
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

// 証明書と鍵が指定されていれば HTTPS で、どちらも未指定なら HTTP で待ち受ける。
// 別の端末のブラウザは HTTPS のページでしかマイクを使わせないため、スマートフォンから使うときは HTTPS にする
function loadTlsOptions() {
  const keyFile = process.env.HTTPS_KEY_FILE;
  const certFile = process.env.HTTPS_CERT_FILE;
  if (!keyFile && !certFile) return null;
  if (!keyFile || !certFile) {
    failStartup('HTTPS_KEY_FILE と HTTPS_CERT_FILE は、両方を指定するか、両方を空にしてください');
  }
  try {
    return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  } catch (err) {
    failStartup(`HTTPS の証明書または鍵を読み込めません: ${err.message}`);
  }
}

const tlsOptions = loadTlsOptions();
const scheme = tlsOptions ? 'https' : 'http';
let server;
try {
  server = tlsOptions ? createHttpsServer(tlsOptions, serveStatic) : createHttpServer(serveStatic);
} catch (err) {
  failStartup(`HTTPS の証明書または鍵が正しくありません: ${err.message}`);
}

// サーボを開始位置に戻す。戻し終わるのは待たず、失敗しても動作は続ける(戻せないままだと、次の反論ではサーボが動かない)
const resetServo = () => {
  reset().catch((err) => console.error(`サーボを開始位置に戻せません: ${err.message}`));
};

const wss = new WebSocketServer({ server, path: WS_PATH });
startHeartbeat(wss);
wss.on('connection', createConnectionHandler({
  createSession: createInputSession,
  outputTimeoutMs,
  // 反論の再生開始で動かしたサーボを、出力モードが終わったら開始位置に戻す
  onOutputEnd: resetServo,
  // ページの「サーボをリセット」ボタンからの手動の操作
  onServoReset: resetServo,
}));

server.listen(port, () => {
  console.log(`backend listening on :${port} (${scheme})`);
});
