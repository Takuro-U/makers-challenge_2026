// Float32 の入力を 24kHz の 16bit PCM(リトルエンディアン)に変換し、約 100ms ごとにメインスレッドへ渡す
// 24kHz は OpenAI Realtime API の入力形式(src/stt.js の SAMPLE_RATE)に合わせている

const TARGET_RATE = 24000;
const CHUNK_SAMPLES = TARGET_RATE / 10;

class PcmEncoder extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate は AudioWorkletGlobalScope のグローバル(入力側のレート)
    this.step = sampleRate / TARGET_RATE;
    this.pos = 0;
    this.prev = 0;
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.length = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    // 線形補間で間引く。pos は直前ブロック末尾の 1 サンプル(prev)を -1 とした位置
    while (this.pos < input.length - 1) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.prev : input[i];
      const b = input[i + 1];
      const sample = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.buffer[this.length++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.length === CHUNK_SAMPLES) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(CHUNK_SAMPLES);
        this.length = 0;
      }
      this.pos += this.step;
    }
    this.pos -= input.length;
    this.prev = input[input.length - 1];
    return true;
  }
}

registerProcessor('pcm-encoder', PcmEncoder);
