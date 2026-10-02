// Float32 の入力を、サーバが指定するサンプリングレートの 16bit PCM(リトルエンディアン)に変換し、
// 一定の長さごとにメインスレッドへ渡す

class PcmEncoder extends AudioWorkletProcessor {
  /**
   * @param {{ processorOptions: { targetRate: number, chunkMs: number } }} options
   *   targetRate は変換後のサンプリングレート、chunkMs は 1 回に渡す音声の長さ(どちらもサーバが /config.json で配る値)
   */
  constructor(options) {
    super();
    const { targetRate, chunkMs } = options.processorOptions;
    // sampleRate は AudioWorkletGlobalScope のグローバル(入力側のレート)
    this.step = sampleRate / targetRate;
    this.pos = 0;
    this.prev = 0;
    this.chunkSamples = Math.round(targetRate * chunkMs / 1000);
    this.buffer = new Int16Array(this.chunkSamples);
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
      if (this.length === this.chunkSamples) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.chunkSamples);
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
