import { react } from './hardware/react.js';
import { HistoryBuffer } from './history-buffer.js';
import { failStartup, requirePositiveInt } from './lib/env.js';
import { matchLocalTerms } from './llm/local-filter.js';
import { provider } from './llm/provider.js';
import { buildRebuttalRequest, renderConversation } from './llm/request.js';
import { RequestDebouncer } from './llm/request-debouncer.js';
import { parseRebuttalResult } from './llm/response.js';
import { speakRebuttal } from './rebuttal-output.js';
import { createSessionLog } from './session-log.js';
import { SttSession } from './stt/session.js';
import { createTranscriptWriter } from './stt/transcript-writer.js';
import { synthesize } from './tts/speech.js';

const historyBufferSize = requirePositiveInt('HISTORY_BUFFER_SIZE');
const requestIdleMs = requirePositiveInt('LLM_REQUEST_IDLE_MS');
const requestMaxWaitMs = requirePositiveInt('LLM_REQUEST_MAX_WAIT_MS');
if (requestMaxWaitMs <= requestIdleMs) {
  failStartup('LLM_REQUEST_MAX_WAIT_MS は LLM_REQUEST_IDLE_MS より大きい値で指定してください');
}

const elapsedMs = (since) => Math.round(performance.now() - since);

/**
 * 担当クライアントが開始してから停止するまでの、入力の処理 1 回分。
 * 受け取った音声を文字起こしセッションへ中継し、確定結果ごとに
 * 履歴バッファへの追記と一次フィルタを行う。
 * フィルタに該当したら、後続の発言を待ってから LLM リクエストを発行する。
 * 反論ありの判定が返ったら、反論文を音声にして担当の端末で再生させる。
 * @param {object} opts
 * 文字起こしとリクエストごとの動作レポートを、1 回分のログの置き場所に書き出す。
 * @param {string} opts.id 担当クライアントの接続 ID
 * @param {(message: string) => void} opts.log
 * @param {{ begin(): boolean, play(audio: Buffer): boolean, end(): void }} opts.output
 *   出力モードへの切り替えと、担当の端末への音声の送信、音声の終わりの通知
 */
export function createInputSession({ id, log, output }) {
  const sessionLog = createSessionLog();
  const writer = createTranscriptWriter(sessionLog.dir);
  const history = new HistoryBuffer(historyBufferSize);
  let closed = false;
  let reportCount = 0;

  // リクエストを 1 回だけ送り、応答を解釈する。経過は動作レポートに書き込む。先行するリクエストの打ち切りは行わない
  const requestRebuttal = async (request, report) => {
    const sentAt = performance.now();
    let response;
    try {
      response = await provider.send(request);
    } catch (err) {
      report.llm = { durationMs: elapsedMs(sentAt), error: err.message };
      log(`llm request の送信に失敗しました: ${err.message}`);
      return;
    }
    report.llm = { durationMs: elapsedMs(sentAt) };

    let text;
    let result;
    try {
      text = provider.extractText(response);
      result = parseRebuttalResult(text);
      report.llm.result = result;
      log(result.decision === 'rebut'
        ? `rebuttal: ${result.rebuttal}`
        : `no rebuttal: ${result.reason}`);
    } catch (err) {
      report.llm.error = err.message;
      // 解釈できなかった応答は、原因を追えるよう生のテキストを残す
      if (text !== undefined) report.llm.text = text;
      log(`llm response を解釈できません: ${err.message}`);
    }

    // 応答を待つ間に停止されていたら、再生する相手がいないので合成しない
    if (result?.decision !== 'rebut' || closed) return;
    report.tts = {};
    const timedSynthesize = async function* (rebuttal) {
      const startedAt = performance.now();
      try {
        for await (const chunk of synthesize(rebuttal)) {
          report.tts.firstChunkMs ??= elapsedMs(startedAt);
          yield chunk;
        }
      } catch (err) {
        report.tts.error = err.message;
        throw err;
      } finally {
        report.tts.durationMs = elapsedMs(startedAt);
      }
    };
    const spoken = await speakRebuttal({
      text: result.rebuttal,
      synthesize: timedSynthesize,
      output,
      log,
      // ハードウェアへの指示を出し終えてから読み上げを始める。指示に失敗したら読み上げない
      onStart: async () => {
        const startedAt = performance.now();
        report.control = {};
        try {
          await react();
        } catch (err) {
          report.control.error = err.message;
          throw err;
        } finally {
          report.control.durationMs = elapsedMs(startedAt);
        }
      },
    });
    report.tts.played = spoken;
    // 反論で会話の流れが変わるため、保留中のトリガは発行せずに破棄する
    if (spoken) debouncer.cancel();
  };

  // 保留が明けた時点の履歴でリクエストを組み立てるため、トリガのあとに届いた発言も含まれる
  const issueRequest = (pending, firedBy) => {
    const entries = pending.map(({ entry }) => entry);
    const report = {
      id: ++reportCount,
      requestedAt: new Date().toISOString(),
      triggers: pending.map(({ entry, matchedTerms }) => ({ text: entry.text, matchedTerms })),
      firedBy,
      context: renderConversation(history, entries).split('\n'),
    };
    const request = buildRebuttalRequest(history, entries);
    requestRebuttal(request, report).finally(() => {
      sessionLog.writeReport(report)
        .then((path) => log(`report -> ${path}`))
        .catch((err) => log(`report の書き出しに失敗しました: ${err.message}`));
    });
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
