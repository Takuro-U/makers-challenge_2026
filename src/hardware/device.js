import { requireOneOf } from '../lib/env.js';

// off なら実機に触れず、何もしない代役を使う(I2C や GPIO のない開発環境・コンテナ向け)
const enabled = requireOneOf('HARDWARE_CONTROL', ['on', 'off']) === 'on';

// ===== 設定 =====
export const SERVO_CH = 0;
export const ANGLE_MIN = 0;
export const ANGLE_MAX = 90;

// 実機と同じ形で、何もしない代役
const mockDevice = {
  pca9685: { async setServo() {} },
  play1port: { async write() {} },
};

// 実機を初期化する。制御用のパッケージは、有効なときだけ読み込む
async function openDevice() {
  const { requestI2CAccess } = await import('node-web-i2c');
  const { requestGPIOAccess } = await import('node-web-gpio');
  const { default: PCA9685 } = await import('@chirimen/pca9685');

  const i2cAccess = await requestI2CAccess();
  const i2cPort = i2cAccess.ports.get(1);
  const pca9685 = new PCA9685(i2cPort, 0x40);
  // 回転角度180度(±90度)のサーボ用。端で唸る場合は幅を狭めて調整
  await pca9685.init(0.0005, 0.0025, 90);

  const gpioAccess = await requestGPIOAccess();
  const play1port = gpioAccess.ports.get(26);
  await play1port.export('out');

  return { pca9685, play1port };
}

let device = null;

/**
 * サーボ(PCA9685)と効果音のトリガ(GPIO)を初期化して返す。初期化は最初の 1 回だけ行う。
 * HARDWARE_CONTROL=off なら、何もしない代役を返す。
 * @returns {Promise<{ pca9685: { setServo(ch: number, angle: number): Promise<void> }, play1port: { write(value: number): Promise<void> } }>}
 */
export function initDevice() {
  device ??= enabled ? openDevice() : Promise.resolve(mockDevice);
  return device;
}
