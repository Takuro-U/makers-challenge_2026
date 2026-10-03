// サーバとブラウザの両方が使う固定値。ブラウザには /config.json で配るため、定義はここだけに置く

/** 入力音声のサンプリングレート(16bit PCM・モノラル)。OpenAI Realtime API が受け付けるのは 24kHz だけ */
export const SAMPLE_RATE = 24000;

/** 反論の音声のサンプリングレート(16bit PCM・モノラル)。OpenAI の音声合成が PCM で返すのは 24kHz だけ */
export const SPEECH_SAMPLE_RATE = 24000;

/** WebSocket の接続先のパス */
export const WS_PATH = '/ws';
