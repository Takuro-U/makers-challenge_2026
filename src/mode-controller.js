/**
 * サーバ全体で 1 つのモードと、マイク入力・スピーカ出力を受け持つ担当クライアントを管理する。
 *
 * - standby(待機): 担当がいない
 * - input(入力): 担当の音声を受け付けている
 * - output(出力): 担当が反論を再生している。この間は音声を受け付けない
 *
 * クライアントは同一性だけで区別する(接続を表すオブジェクトをそのまま渡す)。
 */
export class ModeController {
  /**
   * @param {object} opts
   * @param {number} opts.outputTimeoutMs 再生終了の報告が届かない場合に、出力モードを打ち切るまでの時間
   * @param {() => void} opts.onChange モードまたは担当が変わったとき
   */
  constructor({ outputTimeoutMs, onChange }) {
    this.outputTimeoutMs = outputTimeoutMs;
    this.onChange = onChange;
    this.mode = 'standby';
    this.owner = null;
    this.outputTimer = null;
  }

  /**
   * 待機モードで開始を求めたクライアントを担当にし、入力モードに移る。
   * @returns {boolean} 担当になれたか(すでに担当がいれば false)
   */
  start(client) {
    if (this.mode !== 'standby') return false;
    this.owner = client;
    this.#setMode('input');
    return true;
  }

  /** 担当が停止を求めた。担当以外からの要求は無視する */
  stop(client) {
    if (client !== this.owner) return;
    this.owner = null;
    this.#setMode('standby');
  }

  /** クライアントが切断した。担当だった場合は停止と同じ扱いにする */
  disconnect(client) {
    this.stop(client);
  }

  /**
   * 入力モードから出力モードに移る。
   * @returns {boolean} 移れたか(入力モードでなければ false)
   */
  beginOutput() {
    if (this.mode !== 'input') return false;
    this.#setMode('output');
    this.outputTimer = setTimeout(() => this.#setMode('input'), this.outputTimeoutMs);
    return true;
  }

  /** 担当が再生の終了を報告した。入力モードに戻る。担当以外からの報告は無視する */
  endOutput(client) {
    if (client !== this.owner || this.mode !== 'output') return;
    this.#setMode('input');
  }

  /** このクライアントからの音声を受け付けるか */
  acceptsAudioFrom(client) {
    return this.mode === 'input' && client === this.owner;
  }

  #setMode(mode) {
    clearTimeout(this.outputTimer);
    this.mode = mode;
    this.onChange();
  }
}
