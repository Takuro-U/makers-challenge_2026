// 使い方: node --env-file=.env src/hardware/reset.js

import { fileURLToPath } from 'node:url';
import { ANGLE_MIN, SERVO_CH, initDevice } from './device.js';

/**
 * リセット。
 * サーボ-90度(+90→0)
 */
export async function reset() {
  const { pca9685 } = await initDevice();
  console.log('section2: servo -> -90 deg');
  await pca9685.setServo(SERVO_CH, ANGLE_MIN);
}

// node コマンドで直接実行されたときだけ動かす(test-all.js からの読み込みでは動かさない)
if (process.argv[1] === fileURLToPath(import.meta.url)) await reset();
