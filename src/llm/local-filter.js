import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { failStartup } from '../lib/env.js';

const TERMS_PATH = join(import.meta.dirname, 'local-terms.json');

/**
 * 表記揺れを吸収するための正規化。
 * 全角半角の統一(NFKC)、カタカナ→ひらがな、英字の小文字化を行う。
 * 辞書の見出し語と発言の両方に適用し、正規表現は正規化後の文字列に対して照合する。
 */
export function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .toLowerCase();
}

// 辞書を読み込み、照合用に変換する。形式が不正なら起動を中止する
function loadTerms() {
  let dictionary;
  try {
    dictionary = JSON.parse(readFileSync(TERMS_PATH, 'utf8'));
  } catch (err) {
    failStartup(`フィルタ辞書を読み込めません(${TERMS_PATH}): ${err.message}`);
  }
  if (!Array.isArray(dictionary?.terms)) {
    failStartup(`フィルタ辞書の形式が不正です: "terms" 配列がありません(${TERMS_PATH})`);
  }

  return dictionary.terms.map((entry, i) => {
    if (typeof entry?.term !== 'string' || entry.term === '') {
      failStartup(`フィルタ辞書の terms[${i}] に "term" がありません`);
    }
    const patterns = (entry.patterns ?? []).map((source) => {
      try {
        return new RegExp(source, 'u');
      } catch (err) {
        failStartup(`フィルタ辞書の terms[${i}] の正規表現が不正です: ${err.message}`);
      }
    });
    return { term: entry.term, normalized: normalize(entry.term), patterns };
  });
}

const terms = loadTerms();

/**
 * 一次フィルタ。確定結果に地元関連語彙が含まれるかを判定し、該当した見出し語を返す。
 * 取りこぼしを避けるため、部分一致・正規表現のいずれかに当たれば該当とする。
 */
export function matchLocalTerms(text) {
  const target = normalize(text);
  return terms
    .filter(({ normalized, patterns }) =>
      target.includes(normalized) || patterns.some((re) => re.test(target)))
    .map(({ term }) => term);
}
