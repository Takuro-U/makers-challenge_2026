import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
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

/**
 * 音声合成のリクエスト本文を組み立てる。
 * 形式は、どのブラウザでも復号できる MP3 にする。
 * @param {string} text 読み上げる文
 */
export function buildSpeechRequest(text) {
  return {
    model,
    voice,
    input: text,
    instructions,
    response_format: 'mp3',
    speed,
  };
}

/**
 * 文を音声に合成し、MP3 のデータを返す。
 * @param {string} text 読み上げる文
 * @returns {Promise<Buffer>}
 */
export async function synthesize(text) {
  const response = await client.audio.speech.create(buildSpeechRequest(text));
  return Buffer.from(await response.arrayBuffer());
}
