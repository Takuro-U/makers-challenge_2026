import { execFile } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT_PATH = join(import.meta.dirname, 'on-rebuttal.sh');

/**
 * 反論の再生開始に合わせて、ハードウェア制御用のスクリプト(on-rebuttal.sh)を起動する。
 * 再生を遅らせないよう、スクリプトの終了は待たない。
 * @param {(message: string) => void} log
 */
export function fireRebuttalControl(log) {
  execFile('sh', [SCRIPT_PATH], (err) => {
    if (err) log(`制御用スクリプトが失敗しました: ${err.message}`);
  });
}
