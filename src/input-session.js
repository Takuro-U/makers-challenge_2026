import { HistoryBuffer } from './history-buffer.js';
import { failStartup, requirePositiveInt } from './lib/env.js';
import { matchLocalTerms } from './llm/local-filter.js';
import { provider } from './llm/provider.js';
import { buildRebuttalRequest } from './llm/request.js';
import { RequestDebouncer } from './llm/request-debouncer.js';
import { writeLlmRequest } from './llm/request-writer.js';
import { parseRebuttalResult } from './llm/response.js';
import { writeLlmResponse } from './llm/response-writer.js';
import { speakRebuttal } from './rebuttal-output.js';
import { SttSession } from './stt/session.js';
import { createTranscriptWriter } from './stt/transcript-writer.js';
import { synthesize } from './tts/speech.js';

const historyBufferSize = requirePositiveInt('HISTORY_BUFFER_SIZE');
const requestIdleMs = requirePositiveInt('LLM_REQUEST_IDLE_MS');
const requestMaxWaitMs = requirePositiveInt('LLM_REQUEST_MAX_WAIT_MS');
if (requestMaxWaitMs <= requestIdleMs) {
  failStartup('LLM_REQUEST_MAX_WAIT_MS は LLM_REQUEST_IDLE_MS より大きい値で指定してください');
}

/**
 * 担当クライアントが開始してから停止するまでの、入力の処理 1 回分。
 * 受け取った音声を文字起こしセッションへ中継し、確定結果ごとに
 * 履歴バッファへの追記と一次フィルタを行う。
 * フィルタに該当したら、後続の発言を待ってから LLM リクエストを発行する。
 * 反論ありの判定が返ったら、反論文を音声にして担当の端末で再生させる。
 * @param {object} opts
 * @param {string} opts.id 担当クライアントの接続 ID(ログと出力ファイル名に使う)
 * @param {(message: string) => void} opts.log
 * @param {{ begin(): boolean, play(audio: Buffer): void }} opts.output 出力モードへの切り替えと、担当の端末への音声の送信
 */
export function createInputSession({ id, log, output }) {
  const writer = createTranscriptWriter(id);
  const history = new HistoryBuffer(historyBufferSize);
  let closed = false;

  // リクエストを 1 回だけ送り、応答を解釈して書き出す。先行するリクエストの打ち切りは行わない
  const requestRebuttal = async (triggers, request) => {
    let response;
    try {
      response = await provider.send(request);
    } catch (err) {
      log(`llm request の送信に失敗しました: ${err.message}`);
      return;
    }

    const record = { triggers, response };
    try {
      record.result = parseRebuttalResult(provider.extractText(response));
      log(record.result.decision === 'rebut'
        ? `rebuttal: ${record.result.rebuttal}`
        : `no rebuttal: ${record.result.reason}`);
    } catch (err) {
      record.error = err.message;
      log(`llm response を解釈できません: ${err.message}`);
    }
    writeLlmResponse(id, record)
      .then((path) => log(`llm response -> ${path}`))
      .catch((err) => log(`llm response の書き出しに失敗しました: ${err.message}`));

    // 応答を待つ間に停止されていたら、再生する相手がいないので合成しない
    if (record.result?.decision !== 'rebut' || closed) return;
    const spoken = await speakRebuttal({ text: record.result.rebuttal, synthesize, output, log });
    // 反論で会話の流れが変わるため、保留中のトリガは発行せずに破棄する
    if (spoken) debouncer.cancel();
  };

  // 保留が明けた時点の履歴でリクエストを組み立てるため、トリガのあとに届いた発言も含まれる
  const issueRequest = (pending) => {
    const triggers = pending.map(({ entry, matchedTerms }) => ({ text: entry.text, matchedTerms }));
    const request = buildRebuttalRequest(history, pending.map(({ entry }) => entry));
    writeLlmRequest(id, { triggers, request })
      .then((path) => log(`llm request -> ${path}`))
      .catch((err) => log(`llm request の書き出しに失敗しました: ${err.message}`));
    requestRebuttal(triggers, request);
  };

  const debouncer = new RequestDebouncer({
    idleMs: requestIdleMs,
    maxWaitMs: requestMaxWaitMs,
    onFire: issueRequest,
  });

  const onFinal = (text) => {
    log(`final: ${text}`);
    writer.write(text);
    // 履歴はトリガの有無にかかわらず常に追記する
    const entry = history.push(text);

    const matchedTerms = matchLocalTerms(text);
    if (matchedTerms.length === 0) return;
    log(`trigger: ${matchedTerms.join(', ')}`);
    debouncer.trigger({ entry, matchedTerms });
  };

  const stt = new SttSession({
    log,
    onFinal,
    onSpeechStart: () => debouncer.hold(),
    onSettled: () => debouncer.release(),
  });
  log(`input started -> ${writer.path}`);

  return {
    /** 16bit PCM(24kHz・モノラル)の音声チャンクを受け付ける */
    write(chunk) {
      stt.write(chunk);
    },
    close() {
      closed = true;
      // 保留中のリクエストは発行せずに破棄する
      debouncer.cancel();
      stt.close();
      writer.close();
      log('input stopped');
    },
  };
}
