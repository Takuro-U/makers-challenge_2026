import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOGS_DIR = join(import.meta.dirname, '..', 'storage', 'logs');

/**
 * 入力の処理 1 回分のログの置き場所(storage/logs/<開始時刻>/)を作る(動作確認用)。
 */
export function createSessionLog() {
  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(LOGS_DIR, startedAt);
  mkdirSync(dir, { recursive: true });

  return {
    dir,
    /**
     * 動作レポートを 1 リクエスト 1 ファイルの JSON で書き出す。
     * @param {{ id: number }} report
     * @returns {Promise<string>} 書き出したファイルのパス
     */
    async writeReport(report) {
      const path = join(dir, `report-${report.id}.json`);
      await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
      return path;
    },
  };
}
