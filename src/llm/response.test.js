import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRebuttalResult } from './response.js';

const rebut = {
  decision: 'rebut',
  reason: '三重県の位置について事実と異なる発言があるため',
  rebuttal: '三重県は近畿地方にも東海地方にも数えられますよ。',
  sources: [{ title: '三重県公式サイト', url: 'https://www.pref.mie.lg.jp/' }],
};
const noRebuttal = { decision: 'no_rebuttal', reason: '中立的な言及のため', rebuttal: '', sources: [] };

test('反論ありの結果を読む', () => {
  assert.deepEqual(parseRebuttalResult(JSON.stringify(rebut)), rebut);
});

test('反論不要の結果を読む', () => {
  assert.deepEqual(parseRebuttalResult(JSON.stringify(noRebuttal)), noRebuttal);
});

test('JSON として読めない結果は失敗にする', () => {
  assert.throws(() => parseRebuttalResult('反論は不要です。'), /JSON/);
});

test('decision が想定外の値の結果は失敗にする', () => {
  assert.throws(() => parseRebuttalResult(JSON.stringify({ ...rebut, decision: 'Rebut' })), /decision/);
});

test('反論ありなのに反論文が空の結果は失敗にする', () => {
  assert.throws(() => parseRebuttalResult(JSON.stringify({ ...rebut, rebuttal: '' })), /反論文/);
});
