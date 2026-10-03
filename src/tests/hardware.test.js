// 対象: src/hardware/device.js, src/hardware/react.js, src/hardware/reset.js
// HARDWARE_CONTROL=off のとき、実機に触れずに通過することを確かめる(実機なし)

import assert from 'node:assert/strict';
import { test } from 'node:test';

// 読み込み時に環境変数を検証するため、読み込む前に設定する
process.env.HARDWARE_CONTROL = 'off';
const { initDevice } = await import('../hardware/device.js');
const { react } = await import('../hardware/react.js');
const { reset } = await import('../hardware/reset.js');

test('off なら、初期化は何もしない代役を返す', async () => {
  const device = await initDevice();
  await device.pca9685.setServo(0, 90);
  await device.play1port.write(1);
  assert.equal(await initDevice(), device);
});

test('off なら、反応とリセットはエラーなく終わる', async () => {
  await react();
  await reset();
});
