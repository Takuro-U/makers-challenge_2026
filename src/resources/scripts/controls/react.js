import { requestI2CAccess } from "node-web-i2c";
import { requestGPIOAccess } from "node-web-gpio";
import PCA9685 from "@chirimen/pca9685";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ===== 設定 =====
const SERVO_CH = 0;
const ANGLE_MIN = 0;
const ANGLE_MAX = 90;
const LOOP_COUNT = 3;

// ===== 初期化 =====
const i2cAccess = await requestI2CAccess();
const i2cPort = i2cAccess.ports.get(1);
const pca9685 = new PCA9685(i2cPort, 0x40);
// 回転角度180度(±90度)のサーボ用。端で唸る場合は幅を狭めて調整
await pca9685.init(0.0005, 0.0025, 90);

const gpioAccess = await requestGPIOAccess();
const play1port = gpioAccess.ports.get(26);
await play1port.export("out");

// ===== 共通関数 =====

// 1曲目を再生(トリガーパルス 0.3秒)
async function playTrack1() {
    console.log("start play1");
    await play1port.write(1);
    await sleep(300);
    await play1port.write(0);
}

// =====反応[react] =====
// サーボ+90度(-90→+90) + 同時に1曲目再生
async function react() {
    console.log("section1: servo -> +90 deg + play");
    await Promise.all([
        pca9685.setServo(SERVO_CH, ANGLE_MAX),
        playTrack1(),
    ]);
}

// ===== リセット[reset]=====
// サーボ-90度(+90→0)
async function reset() {
    console.log("section2: servo -> -90 deg");
    await pca9685.setServo(SERVO_CH, ANGLE_MIN);
}

// ===== テスト用メインループ [testAll]=====
async function testAll() {
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
    console.log("done");
}