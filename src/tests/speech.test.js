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
const { buildSpeechRequest } = await import('../tts/speech.js');

const voiceInstructions = readFileSync(
  join(import.meta.dirname, '..', 'tts', 'prompts', 'voice-instructions.md'),
  'utf8',
);

test('設定と反論文から、MP3 で受け取る音声合成のリクエストを組み立てる', () => {
  assert.deepEqual(buildSpeechRequest('三重県は近畿地方にも数えられますよ。'), {
    model: 'test-tts-model',
    voice: 'test-voice',
    input: '三重県は近畿地方にも数えられますよ。',
    instructions: voiceInstructions,
    response_format: 'mp3',
    speed: 1.25,
  });
});

test('口調の指示のファイルに内容がある', () => {
  assert.ok(voiceInstructions.trim().length > 0);
});
