// 反論を話している間に表示する 3D モデル。読み込みと、表示・非表示の切り替えを受け持つ

import {
  AnimationMixer,
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = '/models/dance.glb';
// 描画解像度の上限(CSS ピクセルに対する倍率)。画素密度の高い端末での負荷を抑える
const MAX_PIXEL_RATIO = 2;
// カメラの縦方向の画角(度)
const FOV_DEG = 30;
// モデルの周りに取る余白の倍率。動きで手足が元の姿勢の範囲からはみ出す分を見込む
const FRAME_MARGIN = 1.3;
// 質感の表現に使われる画像の種類。最初の表示で引っかからないよう、読み込み時に GPU へ送っておく
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];

/**
 * モデルを読み込み、canvas に描く準備をする。描画するのは show() から hide() までの間だけ。
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{ show(): void, hide(): void }>}
 */
export async function createAvatar(canvas) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;

  const scene = new Scene();
  scene.add(model);
  // 影は使わず、空からの光と正面寄りの光だけで照らす
  scene.add(new HemisphereLight(0xffffff, 0x666666, 2));
  const frontLight = new DirectionalLight(0xffffff, 2);
  frontLight.position.set(1, 2, 3);
  scene.add(frontLight);

  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const camera = new PerspectiveCamera(FOV_DEG);

  const renderer = new WebGLRenderer({ canvas, alpha: true });
  model.traverse((object) => {
    if (!object.isMesh) return;
    // 骨で変形するメッシュは、元の姿勢の範囲で画面外と判定されると欠けるため、常に描く
    object.frustumCulled = false;
    for (const slot of TEXTURE_SLOTS) {
      if (object.material[slot]) renderer.initTexture(object.material[slot]);
    }
  });
  await renderer.compileAsync(scene, camera);

  const mixer = new AnimationMixer(model);
  const action = gltf.animations.length > 0 ? mixer.clipAction(gltf.animations[0]) : null;

  // 表示領域の大きさに描画を合わせ、モデル全体が正面から収まる位置にカメラを置く
  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    const halfFov = (FOV_DEG * Math.PI) / 360;
    const fitHeight = size.y / 2 / Math.tan(halfFov);
    const fitWidth = size.x / 2 / Math.tan(halfFov) / camera.aspect;
    const distance = Math.max(fitHeight, fitWidth) * FRAME_MARGIN + size.z / 2;
    camera.position.set(center.x, center.y, center.z + distance);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', () => {
    if (!canvas.hidden) resize();
  });

  let lastTime = null;
  const draw = (time) => {
    mixer.update(lastTime === null ? 0 : (time - lastTime) / 1000);
    lastTime = time;
    renderer.render(scene, camera);
  };

  return {
    /** 表示して、動きを最初から再生する */
    show() {
      if (!canvas.hidden) return;
      canvas.hidden = false;
      resize();
      action?.reset().play();
      lastTime = null;
      renderer.setAnimationLoop(draw);
    },
    /** 非表示にして、描画を止める */
    hide() {
      if (canvas.hidden) return;
      renderer.setAnimationLoop(null);
      canvas.hidden = true;
    },
  };
}
