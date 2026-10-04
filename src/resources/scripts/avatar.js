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
// モデルの周りに取る余白の倍率。動きの範囲は測ったうえで合わせるので、縁に付かない程度にとどめる
const FRAME_MARGIN = 1.05;
// 動きの範囲を測るときに、動きを何等分した時点で調べるか
const BOUNDS_SAMPLES = 30;
// 動きの範囲を測るときに調べる頂点の数の目安。全頂点では重いので、間引いて近似する
const BOUNDS_VERTICES = 4000;
// 質感の表現に使われる画像の種類。最初の表示で引っかからないよう、読み込み時に GPU へ送っておく
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];

// 動きの最初から最後までを通して、モデルが届く範囲を測る。動きがなければ元の姿勢の範囲になる
function measureReach(model, mixer, action) {
  const meshes = [];
  model.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  const duration = action?.getClip().duration ?? 0;
  const sampleCount = duration > 0 ? BOUNDS_SAMPLES : 1;

  const box = new Box3();
  const point = new Vector3();
  action?.play();
  for (let sample = 0; sample < sampleCount; sample++) {
    mixer.setTime((duration * sample) / sampleCount);
    model.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const count = mesh.geometry.attributes.position.count;
      const step = Math.max(1, Math.floor(count / BOUNDS_VERTICES));
      for (let i = 0; i < count; i += step) {
        // 骨による変形を反映した頂点の位置
        mesh.getVertexPosition(i, point);
        box.expandByPoint(point.applyMatrix4(mesh.matrixWorld));
      }
    }
  }
  action?.stop();
  return box;
}

/**
 * モデルを読み込み、canvas に描く準備をする。描画するのは show() から hide() までの間だけ。
 * 表示領域の縦横比が変わっても(端末の向きを変えても)、全身が中央にちょうど収まるようにカメラを合わせる。
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

  const mixer = new AnimationMixer(model);
  const action = gltf.animations.length > 0 ? mixer.clipAction(gltf.animations[0]) : null;

  const box = measureReach(model, mixer, action);
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

  // 表示領域の大きさに描画を合わせ、動きの範囲の全体が正面から収まる位置にカメラを置く
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
  // 端末の向きの変更や全画面の切り替えで表示領域の大きさが変わったら、合わせ直す
  new ResizeObserver(() => {
    if (!canvas.hidden) resize();
  }).observe(canvas);

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
