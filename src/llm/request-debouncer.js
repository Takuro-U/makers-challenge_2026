/**
 * トリガが立ってから LLM リクエストを発行するまでの保留を管理する。
 * 発言が複数の確定結果に分かれても後続を取り込めるよう、確定結果が一定時間(猶予)届かなくなるまで待つ。
 * 確定結果が届き続ける場合は、最初のトリガから一定時間(上限)で打ち切る。
 * 保留中に立ったトリガは 1 回の発行にまとめる。
 */
export class RequestDebouncer {
  /**
   * @param {object} opts
   * @param {number} opts.idleMs 猶予(ミリ秒)
   * @param {number} opts.maxWaitMs 上限(ミリ秒)。最初のトリガから数える
   * @param {(triggers: unknown[], firedBy: 'idle' | 'max_wait') => void} opts.onFire
   *   保留が明けたときに、保留中のトリガを到着順に受け取る。firedBy は猶予(idle)と上限(max_wait)のどちらで明けたか
   */
  constructor({ idleMs, maxWaitMs, onFire }) {
    this.idleMs = idleMs;
    this.maxWaitMs = maxWaitMs;
    this.onFire = onFire;
    this.pending = null;
    this.held = false;
    this.idleTimer = null;
    this.maxTimer = null;
  }

  /** トリガを保留に加える。保留がなければ新しく始める */
  trigger(item) {
    if (this.pending) {
      this.pending.push(item);
    } else {
      this.pending = [item];
      this.maxTimer = setTimeout(() => this.#fire('max_wait'), this.maxWaitMs);
    }
    if (!this.held) this.#restartIdleTimer();
  }

  /** 発話が始まった。その確定結果が届くまで猶予は計らない */
  hold() {
    this.held = true;
    clearTimeout(this.idleTimer);
  }

  /** 進行中の発話がなくなり、確定結果が出そろった。ここから猶予を計り直す */
  release() {
    this.held = false;
    if (this.pending) this.#restartIdleTimer();
  }

  /** 保留を発行せずに破棄する */
  cancel() {
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    this.pending = null;
  }

  #restartIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.#fire('idle'), this.idleMs);
  }

  #fire(firedBy) {
    const triggers = this.pending;
    this.cancel();
    this.onFire(triggers, firedBy);
  }
}
