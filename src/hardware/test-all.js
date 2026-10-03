// 使い方: node --env-file=.env src/hardware/test-all.js

import { ANGLE_MIN, SERVO_CH, initDevice } from './device.js';
import { react } from './react.js';
import { reset } from './reset.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LOOP_COUNT = 3;

// テスト用メインループ
async function testAll() {
  const { pca9685 } = await initDevice();
  // 開始位置(-90度)へ移動
  await pca9685.setServo(SERVO_CH, ANGLE_MIN);
  await sleep(1000);

  for (let i = 0; i < LOOP_COUNT; i++) {
    console.log(`--- loop ${i + 1}/${LOOP_COUNT} ---`);
    await react();
    await sleep(3000);
    await reset();
    await sleep(2000);
  }
  console.log('done');
}

await testAll();
