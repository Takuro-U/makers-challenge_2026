import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { SPEECH_SAMPLE_RATE } from '../lib/constants.js';
import { failStartup, requireEnv, requireNumberInRange } from '../lib/env.js';

const INSTRUCTIONS_PATH = join(import.meta.dirname, 'prompts', 'voice-instructions.md');

const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });

const model = requireEnv('TTS_MODEL');
const voice = requireEnv('TTS_VOICE');
// 読み上げの速さ(倍率)。範囲は API が受け付ける値に合わせる
const speed = requireNumberInRange('TTS_SPEED', 0.25, 4);

function readInstructions() {
  try {
    return readFileSync(INSTRUCTIONS_PATH, 'utf8');
  } catch (err) {
    failStartup(`口調の指示を読み込めません(${INSTRUCTIONS_PATH}): ${err.message}`);
  }
}

// 口調の指示。tts-1 / tts-1-hd では効かない
const instructions = readInstructions();

// 1 回に送る音声の最小の長さ(バイト)。200 ミリ秒分。細切れのまま送ると、ブラウザで再生するときの継ぎ目が増える
const MIN_CHUNK_BYTES = SPEECH_SAMPLE_RATE * 2 * 0.2;

/**
 * 音声合成のリクエスト本文を組み立てる。
 * 形式は、届いた分から復号なしで再生できる PCM(16bit・モノラル)にする。
 * @param {string} text 読み上げる文
 */
export function buildSpeechRequest(text) {
  return {
    model,
    voice,
    input: text,
    instructions,
    response_format: 'pcm',
    speed,
  };
}

/**
 * 届いた PCM を、minBytes 以上の長さで 16bit の標本の境界にそろえたチャンクにまとめ直す。
 * @param {AsyncIterable<Uint8Array>} source
 * @param {number} minBytes
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* chunkPcm(source, minBytes) {
  let pending = Buffer.alloc(0);
  for await (const data of source) {
    pending = Buffer.concat([pending, data]);
    if (pending.length < minBytes) continue;
    const length = pending.length - (pending.length % 2);
    yield pending.subarray(0, length);
    pending = pending.subarray(length);
  }
  // 最後に残った端数の 1 バイトは標本にならないので捨てる
  const length = pending.length - (pending.length % 2);
  if (length > 0) yield pending.subarray(0, length);
}

/**
 * 文を音声に合成し、PCM のデータを届いた順に返す。
 * @param {string} text 読み上げる文
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* synthesize(text) {
  const response = await client.audio.speech.create(buildSpeechRequest(text));
  yield* chunkPcm(response.body, MIN_CHUNK_BYTES);
}
