/**
 * 会話履歴の固定長リングバッファ。要素は { timestamp, text }。
 * 容量を超えると最も古い要素から上書きされる。
 */
export class HistoryBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.entries = new Array(capacity);
    this.next = 0;
    this.size = 0;
  }

  /** 確定結果を追記し、追記した要素を返す */
  push(text, timestamp = new Date()) {
    const entry = { timestamp, text };
    this.entries[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    return entry;
  }

  /** 直近 count 件を古い順に返す */
  recent(count) {
    const n = Math.min(count, this.size);
    const result = [];
    for (let i = n; i > 0; i--) {
      result.push(this.entries[(this.next - i + this.capacity) % this.capacity]);
    }
    return result;
  }
}
