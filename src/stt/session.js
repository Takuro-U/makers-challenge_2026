import WebSocket from 'ws';
import { requireEnv } from '../lib/env.js';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
// 入力音声の形式(16bit PCM・モノラル・24kHz)
export const SAMPLE_RATE = 24000;

// セッションの上限に達する前に張り替える間隔。発話中は張り替えを発話の終わりまで待つ
const ROTATE_INTERVAL_MS = 25 * 60 * 1000;
// 張り替え後、旧セッションの残りの確定結果を待つ時間
const ROTATE_GRACE_MS = 5 * 1000;
// エラー時の再接続待ち時間(指数的に延ばす)
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30 * 1000;
// 張り替え時刻にこの時間以上音声が届いていなければ、張り替えずに接続を閉じる(次の音声で開き直す)
const AUDIO_IDLE_MS = 10 * 1000;
// 接続待ちの間に保持する音声の上限(約 10 秒)
const PENDING_MAX_BYTES = SAMPLE_RATE * 2 * 10;
// 発話の区切り(意味の切れ目で判定)で、言いかけの続きをどれだけ待つか。auto は最長 4 秒
const TURN_EAGERNESS = 'auto';

const model = requireEnv('STT_MODEL');
const language = process.env.STT_LANGUAGE ?? 'ja';

/**
 * 1 本の WebSocket 接続(ブラウザ側)に対応する文字起こしセッション。
 * 内部で OpenAI Realtime API の文字起こしセッションを張り、上限到達やエラー時に自動で張り替える。
 * 発話の区切りはサーバ側に任せて意味の切れ目で判定させ、区切りごとの確定結果を onFinal で返す。
 */
export class SttSession {
  /**
   * @param {object} opts
   * @param {(text: string) => void} opts.onFinal 確定結果を受け取るコールバック
   * @param {() => void} [opts.onSpeechStart] 発話が始まったとき(その確定結果はまだ届いていない)
   * @param {() => void} [opts.onSettled] 進行中の発話がなくなり、確定結果が出そろったとき
   * @param {(message: string) => void} [opts.log]
   */
  constructor({ onFinal, onSpeechStart = () => {}, onSettled = () => {}, log = console.log }) {
    this.onFinal = onFinal;
    this.onSpeechStart = onSpeechStart;
    this.onSettled = onSettled;
    this.log = log;
    // 発話が始まってから確定結果が届くまでの項目(item_id → 受け取ったセッション)
    this.openItems = new Map();
    this.socket = null;
    this.socketNo = 0;
    this.speaking = false;
    this.rotateDue = false;
    this.rotateTimer = null;
    this.retryTimer = null;
    this.retryDelay = RETRY_BASE_MS;
    this.pending = [];
    this.pendingBytes = 0;
    this.lastAudioAt = 0;
    this.closed = false;
  }

  /** 16bit PCM(24kHz・モノラル)の音声チャンクを受け付ける */
  write(chunk) {
    if (this.closed) return;
    this.lastAudioAt = Date.now();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.#append(this.socket, chunk);
      return;
    }
    this.#enqueue(chunk);
    // 接続中・再接続待ちでなければ、音声の到着を契機に接続を開く
    if (!this.socket && !this.retryTimer) this.#open();
  }

  close() {
    this.closed = true;
    clearTimeout(this.rotateTimer);
    clearTimeout(this.retryTimer);
    this.#detachCurrent()?.close();
  }

  #append(socket, chunk) {
    socket.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: chunk.toString('base64'),
    }));
  }

  #enqueue(chunk) {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    // 上限を超えた分は古いものから捨てる
    while (this.pendingBytes > PENDING_MAX_BYTES) {
      this.pendingBytes -= this.pending.shift().length;
    }
  }

  #open() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.log('[stt] OPENAI_API_KEY が未設定のため接続できません');
      this.#scheduleRetry();
      return;
    }

    const no = ++this.socketNo;
    const socket = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    this.socket = socket;
    this.speaking = false;

    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: SAMPLE_RATE },
              transcription: { model, language },
              turn_detection: { type: 'semantic_vad', eagerness: TURN_EAGERNESS },
              // スマートフォンを卓上に置いて会話を拾う想定
              noise_reduction: { type: 'far_field' },
            },
          },
        },
      }));

      // 接続待ちの間にたまった音声を送る
      for (const chunk of this.pending) this.#append(socket, chunk);
      this.pending = [];
      this.pendingBytes = 0;

      this.rotateDue = false;
      clearTimeout(this.rotateTimer);
      this.rotateTimer = setTimeout(() => this.#requestRotate(), ROTATE_INTERVAL_MS);
      this.log(`[stt] session#${no} opened (${model}, ${language})`);
    });

    socket.on('message', (data) => {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.#handleEvent(socket, no, event);
    });

    socket.on('error', (err) => {
      this.log(`[stt] session#${no} error: ${err.message}`);
    });

    socket.on('close', (code, reason) => {
      this.log(`[stt] session#${no} closed (${code}${reason.length ? ` ${reason}` : ''})`);
      // このセッションで確定結果を待っていた発話は、もう届かない
      for (const [itemId, owner] of this.openItems) {
        if (owner === socket) this.#closeItem(itemId);
      }
      // 張り替え済みの旧セッションが閉じた場合は何もしない
      if (this.socket !== socket) return;
      this.socket = null;
      clearTimeout(this.rotateTimer);
      this.#scheduleRetry();
    });
  }

  #handleEvent(socket, no, event) {
    switch (event.type) {
      case 'session.updated':
        this.retryDelay = RETRY_BASE_MS;
        break;
      case 'input_audio_buffer.speech_started':
        if (socket === this.socket) this.speaking = true;
        this.openItems.set(event.item_id, socket);
        this.onSpeechStart();
        break;
      case 'input_audio_buffer.speech_stopped':
        if (socket === this.socket) {
          this.speaking = false;
          if (this.rotateDue) this.#rotate();
        }
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = event.transcript?.trim();
        if (text) this.onFinal(text);
        this.#closeItem(event.item_id);
        break;
      }
      case 'conversation.item.input_audio_transcription.failed':
        this.log(`[stt] session#${no} transcription failed: ${event.error?.message ?? JSON.stringify(event)}`);
        this.#closeItem(event.item_id);
        break;
      case 'error':
        this.log(`[stt] session#${no} error event: ${event.error?.message ?? JSON.stringify(event)}`);
        break;
    }
  }

  // 発話の確定結果が届いた(または届かないと決まった)。待っている発話がなくなれば通知する
  #closeItem(itemId) {
    this.openItems.delete(itemId);
    if (this.openItems.size === 0 && !this.closed) this.onSettled();
  }

  // 張り替え時刻に達したら、発話中でなければすぐに、発話中なら発話の終わりで張り替える
  #requestRotate() {
    if (this.closed) return;
    if (Date.now() - this.lastAudioAt > AUDIO_IDLE_MS) {
      // 音声が途絶えているので新しいセッションは開かない。次の音声の到着時に write() が開き直す
      this.log('[stt] 音声が届いていないため、張り替えずに接続を閉じます');
      this.#detachCurrent()?.close();
      return;
    }
    if (this.speaking) {
      this.rotateDue = true;
      return;
    }
    this.#rotate();
  }

  // 新しいセッションへ切り替え、旧セッションは残りの確定結果を受け取ってから閉じる
  #rotate() {
    this.rotateDue = false;
    const old = this.#detachCurrent();
    setTimeout(() => old?.close(), ROTATE_GRACE_MS);
    this.#open();
  }

  #detachCurrent() {
    const socket = this.socket;
    this.socket = null;
    return socket;
  }

  #scheduleRetry() {
    if (this.closed || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.log(`[stt] ${delay}ms 後に再接続します`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // 待っている間に音声が届いていれば開き直す(届いていなければ次の音声を待つ)
      if (this.pending.length > 0) this.#open();
    }, delay);
  }
}
