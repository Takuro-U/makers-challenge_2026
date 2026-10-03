import { ANGLE_MAX, SERVO_CH, initDevice } from './device.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1曲目を再生(トリガーパルス 0.3秒)。
// トリガをオンにした時点で戻り、オフに戻す処理は裏で続ける(失敗しても呼び出し元には伝えない)
async function playTrack1(play1port) {
  console.log('start play1');
  await play1port.write(1);
  sleep(300)
    .then(() => play1port.write(0))
    .catch((err) => console.error(`効果音のトリガをオフに戻せません: ${err.message}`));
}

/**
 * 反応。反論の再生開始に合わせて呼ぶ。
 * サーボ+90度(-90→+90) + 同時に1曲目再生
 * サーボと効果音への指示を出し終えた時点で戻る。どちらかの指示に失敗したら例外にする。
 */
export async function react() {
  const { pca9685, play1port } = await initDevice();
  console.log('section1: servo -> +90 deg + play');
  await Promise.all([
    pca9685.setServo(SERVO_CH, ANGLE_MAX),
    playTrack1(play1port),
  ]);
}
