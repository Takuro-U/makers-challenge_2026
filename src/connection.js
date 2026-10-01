import { randomUUID } from 'node:crypto';
import { SttSession } from './stt.js';
import { createTranscriptWriter } from './transcript-writer.js';

/**
 * ブラウザとの WebSocket 接続 1 本を処理する。
 * 受信した音声を文字起こしセッションへ中継し、確定結果をファイルへ書き出す。
 */
export function handleConnection(ws) {
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
  // 不正なフレーム等のエラー。リスナーがないとプロセスごと落ちるため必ず受ける。
  // エラー後は 'close' が発火するので、後片付けはそちらに任せる
  ws.on('error', (err) => {
    log(`ws error: ${err.message}`);
  });
  // 通常の切断、エラー、ハートビートによる terminate() のいずれでも発火する
  ws.on('close', () => {
    stt.close();
    writer.close();
    log('disconnected');
  });
}
