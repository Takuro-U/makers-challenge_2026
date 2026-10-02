/**
 * 反論を音声にして、担当の端末で再生させる。
 * 合成の間は入力モードのまま会話を聞き続け、音声が用意できてから出力モードに切り替える。
 * @param {object} opts
 * @param {string} opts.text 読み上げる反論文
 * @param {(text: string) => Promise<Buffer>} opts.synthesize 音声合成
 * @param {{ begin(): boolean, play(audio: Buffer): void }} opts.output 出力モードへの切り替えと、担当の端末への音声の送信
 * @param {(message: string) => void} opts.log
 * @returns {Promise<boolean>} 再生を始めさせたか
 */
export async function speakRebuttal({ text, synthesize, output, log }) {
  let audio;
  try {
    audio = await synthesize(text);
  } catch (err) {
    log(`tts に失敗しました: ${err.message}`);
    return false;
  }

  // 停止済み、または別の反論を出力中なら切り替えられない
  if (!output.begin()) {
    log('出力モードに切り替えられないため、反論の音声を破棄しました');
    return false;
  }
  output.play(audio);
  return true;
}
