import { randomUUID } from 'node:crypto';
import { ModeController } from './mode-controller.js';

/**
 * ブラウザとの WebSocket 接続を処理する関数を作る。
 * モードと担当クライアントはサーバ全体で 1 つで、変わるたびに全クライアントへ知らせる。
 *
 * クライアント → サーバ
 * - テキスト `{"type":"start"}` / `{"type":"stop"}`: 担当の開始・停止
 * - テキスト `{"type":"playback_ended"}`: 反論の再生が終わった
 * - バイナリ: 音声(入力モードの担当から届いたものだけを受け付ける)
 *
 * サーバ → クライアント
 * - テキスト `{"type":"mode","mode":"standby"|"input"|"output","owner":boolean}`: 現在のモードと、宛先が担当かどうか
 *
 * @param {object} opts
 * @param {(opts: { id: string, log: (message: string) => void, beginOutput: () => boolean }) => { write(chunk: Buffer): void, close(): void }} opts.createSession
 *   入力の処理を作る。担当が開始してから停止するまでを 1 回分とする。beginOutput は反論の再生を始めるときに呼ぶ
 * @param {number} opts.outputTimeoutMs 再生終了の報告が届かない場合に、出力モードを打ち切るまでの時間
 */
export function createConnectionHandler({ createSession, outputTimeoutMs }) {
  // 接続中のクライアント(ws → { id, log })
  const clients = new Map();
  let session = null;

  const sendMode = (ws) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: 'mode', mode: controller.mode, owner: ws === controller.owner }));
  };

  const controller = new ModeController({
    outputTimeoutMs,
    onChange: () => {
      if (controller.mode === 'standby') {
        session?.close();
        session = null;
      } else if (!session) {
        const { id, log } = clients.get(controller.owner);
        session = createSession({ id, log, beginOutput: () => controller.beginOutput() });
      }
      for (const ws of clients.keys()) sendMode(ws);
    },
  });

  const handleMessage = (ws, message) => {
    switch (message?.type) {
      case 'start':
        // 断った場合は何も変わらず通知も出ないため、断られた側に現在のモードを送り直す
        if (!controller.start(ws)) sendMode(ws);
        break;
      case 'stop':
        controller.stop(ws);
        break;
      case 'playback_ended':
        controller.endOutput(ws);
        break;
    }
  };

  return function handleConnection(ws) {
    const id = randomUUID().slice(0, 8);
    const log = (message) => console.log(`[${id}] ${message}`);
    clients.set(ws, { id, log });
    log('connected');
    sendMode(ws);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (controller.acceptsAudioFrom(ws)) session.write(data);
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      handleMessage(ws, message);
    });
    // 不正なフレーム等のエラー。リスナーがないとプロセスごと落ちるため必ず受ける。
    // エラー後は 'close' が発火するので、後片付けはそちらに任せる
    ws.on('error', (err) => {
      log(`ws error: ${err.message}`);
    });
    // 通常の切断、エラー、ハートビートによる terminate() のいずれでも発火する
    ws.on('close', () => {
      // 担当だった場合は待機モードに戻り、入力の処理も閉じる
      controller.disconnect(ws);
      clients.delete(ws);
      log('disconnected');
    });
  };
}
