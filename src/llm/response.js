const DECISIONS = ['rebut', 'no_rebuttal'];

/**
 * プロバイダの応答から取り出した JSON 文字列を、反論の判定結果として読む。
 * 結果として読めない場合は例外にする。
 * @param {string} text
 * @returns {{ decision: 'rebut' | 'no_rebuttal', reason: string, rebuttal: string, sources: Array<{ title: string, url: string }> }}
 */
export function parseRebuttalResult(text) {
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    throw new Error(`応答が JSON として読めません: ${err.message}`);
  }

  if (!DECISIONS.includes(result?.decision)) {
    throw new Error(`decision が想定外の値です: ${result?.decision}`);
  }
  // 空文字の禁止はスキーマでは表せないため、ここで確認する
  if (result.decision === 'rebut' && !result.rebuttal) {
    throw new Error('反論ありの応答なのに反論文が空です');
  }
  return result;
}
