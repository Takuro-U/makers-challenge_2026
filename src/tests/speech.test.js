// 対象: src/tts/speech.js
// 音声合成のリクエストの組み立てを確かめる(外部通信なし)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 読み込み時に環境変数を検証するため、読み込む前に設定する(通信は行わない)
Object.assign(process.env, {
  OPENAI_API_KEY: 'test-key',
  TTS_MODEL: 'test-tts-model',
  TTS_VOICE: 'test-voice',
  TTS_SPEED: '1.25',
});
const { buildSpeechRequest, chunkPcm } = await import('../tts/speech.js');

// 届いた順のデータを chunkPcm に通し、まとめ直した結果をバイト列の配列で返す
async function rechunk(parts, minBytes) {
  async function* source() {
    for (const part of parts) yield Uint8Array.from(part);
  }
  const chunks = [];
  for await (const chunk of chunkPcm(source(), minBytes)) chunks.push([...chunk]);
  return chunks;
}

const voiceInstructions = readFileSync(
  join(import.meta.dirname, '..', 'tts', 'prompts', 'voice-instructions.md'),
  'utf8',
);

test('届いた音声を、最小の長さ以上になるまでためてから返す', async () => {
  assert.deepEqual(await rechunk([[1, 2], [3, 4], [5, 6], [7, 8]], 4), [[1, 2, 3, 4], [5, 6, 7, 8]]);
});

test('標本の途中で区切られた音声は、境界にそろえて返す', async () => {
  assert.deepEqual(await rechunk([[1, 2, 3], [4, 5, 6]], 2), [[1, 2], [3, 4, 5, 6]]);
});

test('最小の長さに満たない残りも最後に返し、端数の 1 バイトは捨てる', async () => {
  assert.deepEqual(await rechunk([[1, 2, 3, 4], [5, 6, 7]], 4), [[1, 2, 3, 4], [5, 6]]);
});

test('設定と反論文から、PCM で受け取る音声合成のリクエストを組み立てる', () => {
  assert.deepEqual(buildSpeechRequest('三重県は近畿地方にも数えられますよ。'), {
    model: 'test-tts-model',
    voice: 'test-voice',
    input: '三重県は近畿地方にも数えられますよ。',
    instructions: voiceInstructions,
    response_format: 'pcm',
    speed: 1.25,
  });
});

test('口調の指示のファイルに内容がある', () => {
  assert.ok(voiceInstructions.trim().length > 0);
});
