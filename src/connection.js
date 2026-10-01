import { randomUUID } from 'node:crypto';
import { requirePositiveInt } from './env.js';
import { HistoryBuffer } from './history-buffer.js';
import { buildRebuttalRequest } from './llm-request.js';
import { matchLocalTerms } from './local-filter.js';
import { writeLlmRequest } from './request-writer.js';
import { SttSession } from './stt.js';
import { createTranscriptWriter } from './transcript-writer.js';

const historyBufferSize = requirePositiveInt('HISTORY_BUFFER_SIZE');

/**
 * ブラウザとの WebSocket 接続 1 本を処理する。
 * 受信した音声を文字起こしセッションへ中継し、確定結果ごとに
 * 履歴バッファへの追記・一次フィルタ・LLM リクエストの組み立てを行う。
 */
export function handleConnection(ws) {
  const id = randomUUID().slice(0, 8);
  const log = (message) => console.log(`[${id}] ${message}`);
  const writer = createTranscriptWriter(id);
  const history = new HistoryBuffer(historyBufferSize);

  const onFinal = (text) => {
    log(`final: ${text}`);
    writer.write(text);
    // 履歴はトリガの有無にかかわらず常に追記する
    const entry = history.push(text);

    const matched = matchLocalTerms(text);
    if (matched.length === 0) return;
    log(`trigger: ${matched.join(', ')}`);

    // 現段階では送信せず、組み立てたリクエストを書き出す
    const request = buildRebuttalRequest(history, entry);
    writeLlmRequest(id, { trigger: text, matchedTerms: matched, request })
      .then((path) => log(`llm request -> ${path}`))
      .catch((err) => log(`llm request の書き出しに失敗しました: ${err.message}`));
  };

  const stt = new SttSession({ log, onFinal });
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
