import { randomUUID } from 'node:crypto';
import { ModeController } from './mode-controller.js';

/**
 * ブラウザとの WebSocket 接続を処理する関数を作る。
 * モードと担当クライアントはサーバ全体で 1 つで、変わるたびに全クライアントへ知らせる。
 *
 * クライアント → サーバ
 * - テキスト `{"type":"start"}` / `{"type":"stop"}`: 担当の開始・停止
 * - テキスト `{"type":"playback_ended"}`: 反論の再生が終わった
 * - テキスト `{"type":"reset_servo"}`: サーボを開始位置に戻す(担当かどうか、モードが何かに関係なく受け付ける)
 * - バイナリ: 音声(入力モードの担当から届いたものだけを受け付ける)
 *
 * サーバ → クライアント
 * - テキスト `{"type":"mode","mode":"standby"|"input"|"output","owner":boolean}`: 現在のモードと、宛先が担当かどうか
 * - バイナリ: 再生する反論の音声(16bit PCM・モノラル)。届いた順に続けて再生する(出力モードの担当にだけ送る)
 * - テキスト `{"type":"audio_end"}`: 反論の音声を送り終えた(出力モードの担当にだけ送る)
 *
 * @param {object} opts
 * @param {(opts: { id: string, log: (message: string) => void, output: { begin(): boolean, play(audio: Buffer): boolean, end(): void } }) => { write(chunk: Buffer): void, close(): void }} opts.createSession
 *   入力の処理を作る。担当が開始してから停止するまでを 1 回分とする。
 *   output.begin() は出力モードへ切り替え(切り替えられなければ false)、output.play() は担当の端末に音声を送り(送れなければ false)、
 *   output.end() は音声を送り終えたことを知らせる
 * @param {number} opts.outputTimeoutMs 再生終了の報告が届かない場合に、出力モードを打ち切るまでの時間
 * @param {() => void} [opts.onOutputEnd]
 *   出力モードが終わったとき(再生の終了、打ち切り、停止、担当の切断のいずれでも)に呼ぶ
 * @param {() => void} [opts.onServoReset] クライアントがサーボを開始位置に戻すよう求めたときに呼ぶ
 */
export function createConnectionHandler({
  createSession,
  outputTimeoutMs,
  onOutputEnd = () => {},
  onServoReset = () => {},
}) {
  // 接続中のクライアント(ws → { id, log })
  const clients = new Map();
  let session = null;

  const sendMode = (ws) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: 'mode', mode: controller.mode, owner: ws === controller.owner }));
  };

  // 入力の処理 1 回分に渡す出力の口。停止したあとに届いた反論が、
  // あとで始まった別の入力へ割り込まないよう、現在の入力の処理のものだけを有効にする
  let currentOutput = null;
  const createOutput = () => {
    // 出力モードの担当に送れる状態なら、その接続を返す
    const outputTarget = () => {
      const ws = controller.owner;
      if (output !== currentOutput || controller.mode !== 'output' || ws.readyState !== ws.OPEN) return null;
      return ws;
    };
    const output = {
      begin: () => output === currentOutput && controller.beginOutput(),
      play: (audio) => {
        const ws = outputTarget();
        ws?.send(audio, { binary: true });
        return ws !== null;
      },
      end: () => {
        outputTarget()?.send(JSON.stringify({ type: 'audio_end' }));
      },
    };
    return output;
  };

  let lastMode = 'standby';
  const controller = new ModeController({
    outputTimeoutMs,
    onChange: () => {
      const outputEnded = lastMode === 'output';
      lastMode = controller.mode;
      if (controller.mode === 'standby') {
        session?.close();
        session = null;
        currentOutput = null;
      } else if (!session) {
        const { id, log } = clients.get(controller.owner);
        currentOutput = createOutput();
        session = createSession({ id, log, output: currentOutput });
      }
      for (const ws of clients.keys()) sendMode(ws);
      if (outputEnded) onOutputEnd();
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
      case 'reset_servo':
        clients.get(ws).log('servo reset requested');
        onServoReset();
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
