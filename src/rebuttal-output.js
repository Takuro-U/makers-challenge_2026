/**
 * 反論を音声にして、担当の端末で再生させる。
 * 音声は合成が終わるのを待たず、届いた分から順に送る。
 * 最初の音声が届くまでは入力モードのまま会話を聞き続け、届いた時点で出力モードに切り替える。
 * @param {object} opts
 * @param {string} opts.text 読み上げる反論文
 * @param {(text: string) => AsyncIterable<Buffer>} opts.synthesize 音声合成。音声を届いた順に返す
 * @param {{ begin(): boolean, play(audio: Buffer): boolean, end(): void }} opts.output
 *   出力モードへの切り替えと、担当の端末への音声の送信、音声の終わりの通知
 * @param {(message: string) => void} opts.log
 * @param {() => void} [opts.onStart] 出力モードに切り替えて、再生を始めさせるときに呼ぶ
 * @returns {Promise<boolean>} 再生を始めさせたか
 */
export async function speakRebuttal({ text, synthesize, output, log, onStart }) {
  let started = false;
  try {
    for await (const chunk of synthesize(text)) {
      if (!started) {
        // 停止済み、または別の反論を出力中なら切り替えられない
        if (!output.begin()) {
          log('出力モードに切り替えられないため、反論の音声を破棄しました');
          return false;
        }
        started = true;
        onStart?.();
      }
      // 途中で出力モードが終わったら、残りは合成させずに打ち切る
      if (!output.play(chunk)) break;
    }
  } catch (err) {
    log(`tts に失敗しました: ${err.message}`);
  }

  // 途中で失敗しても終わりを知らせ、送った分の再生が済んだら入力モードへ戻れるようにする
  if (started) output.end();
  return started;
}
