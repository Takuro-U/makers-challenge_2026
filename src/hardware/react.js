import { ANGLE_MAX, SERVO_CH, initDevice } from './device.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1曲目を再生(トリガーパルス 0.3秒)
async function playTrack1(play1port) {
  console.log('start play1');
  await play1port.write(1);
  await sleep(300);
  await play1port.write(0);
}

/**
 * 反応。反論の再生開始に合わせて呼ぶ。
 * サーボ+90度(-90→+90) + 同時に1曲目再生
 */
export async function react() {
  const { pca9685, play1port } = await initDevice();
  console.log('section1: servo -> +90 deg + play');
  await Promise.all([
    pca9685.setServo(SERVO_CH, ANGLE_MAX),
    playTrack1(play1port),
  ]);
}
