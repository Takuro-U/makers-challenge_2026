// サーバが持つモードを WebSocket で受け取って表示し続ける。
// この端末が担当のときは、サーバから届いた反論の音声を再生し、その間だけ 3D モデルを表示する。
// この端末がマイクの担当になったら、マイク入力をモノラルの 16bit PCM(サンプリングレートはサーバの指定)に変換してサーバへ送る

const MODE_LABELS = { standby: '待機モード', input: '入力モード', output: '出力モード' };

const modeText = document.getElementById('mode');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusText = document.getElementById('status');
const previewButton = document.getElementById('preview');
const previewExitButton = document.getElementById('preview-exit');
const avatarCanvas = document.getElementById('avatar');
const fullscreenButton = document.getElementById('fullscreen');

// サーバが /config.json で配る設定値
// wsPath: WebSocket の接続先のパス
// sampleRate: サーバへ送る音声のサンプリングレート
// reconnectDelayMs: 切断されたあと、再接続を試みるまでの時間
// audioChunkMs: 音声を送る 1 回分の長さ
// speechSampleRate: サーバから届く反論の音声のサンプリングレート
let config = null;
let ws = null;
// サーバから受け取った最新の状態 { mode, owner }。接続していない間は null
let state = null;
// 開始の操作を処理している間は true
let starting = false;
let errorMessage = '';
let audioContext = null;
// 反論の再生専用の AudioContext。届く音声と同じサンプリングレートで作り、断片ごとの変換をなくして継ぎ目のずれを防ぐ
let playbackContext = null;
let mediaStream = null;
// 再生中の反論 { sources: 再生待ち・再生中の音声, nextTime: 次の音声を鳴らし始める時刻, ended: サーバが送り終えたか }
let playback = null;
// 再生に失敗して終了を報告済みの間は true
let playbackFailed = false;
// 出力モードの間に表示する 3D モデル。読み込みが済むまで、または読み込めなかった場合は null
let avatar = null;
// 3D モデルを読み込めなかったら true
let avatarFailed = false;
// プレビューのボタンで 3D モデルを表示している間は true
let previewing = false;

// 切り分け用。URL に ?avatar=off を付けて開くと、3D モデルを読み込まず、表示もしない
const avatarDisabled = new URLSearchParams(location.search).get('avatar') === 'off';

// 最初の音声を鳴らし始めるまでの余裕(秒)。届く間隔が揺らいでも、続きが届く前に途切れないようにする
const PLAYBACK_LEAD_SEC = 0.3;

function describeStatus() {
  if (errorMessage) return `エラー: ${errorMessage}`;
  if (!state) return 'サーバに接続しています';
  if (state.mode === 'standby') {
    return isAvatarLoading()
      ? '3D モデルを読み込んでいます。読み込みが終わると開始できます'
      : '「開始」を押した端末がマイクを担当します';
  }
  return state.owner ? 'この端末がマイクを担当しています' : '別の端末がマイクを担当しています';
}

// 3D モデルの読み込みが、成功も失敗もせずに続いている間は true
function isAvatarLoading() {
  return !avatarDisabled && !avatar && !avatarFailed;
}

// 表示とボタンの状態は、サーバから受け取った状態と 3D モデルの読み込みの状況で決める
function render() {
  modeText.textContent = state ? MODE_LABELS[state.mode] : '未接続';
  statusText.textContent = describeStatus();
  // 最初の反論から 3D モデルを表示できるよう、読み込みが終わるまでは開始させない(読み込めなかった場合は表示なしで開始できる)
  startButton.disabled = starting || state?.mode !== 'standby' || isAvatarLoading();
  stopButton.disabled = !state?.owner;
  previewButton.disabled = avatarDisabled || avatarFailed;
  previewButton.textContent = describePreview();
  updateAvatar();
}

function describePreview() {
  if (avatarDisabled) return 'モデルは無効です(?avatar=off)';
  if (avatarFailed) return 'モデルを読み込めません';
  if (!previewing) return 'モデルをプレビュー';
  return 'モデルを読み込んでいます';
}

// 3D モデルは、最初の反論に間に合うよう、ページを開いた時点で読み込む(ページを開いている間に 1 回だけ)。
// 読み込めなくても、表示なしのまま他の機能は動かす
async function loadAvatar() {
  try {
    const { createAvatar } = await import('/scripts/avatar.js');
    avatar = await createAvatar(avatarCanvas);
  } catch (err) {
    console.error('3D モデルを読み込めません', err);
    avatarFailed = true;
    previewing = false;
  }
  render();
}

// 3D モデルは、この端末が担当で出力モードの間と、プレビューの間だけ表示する。
// 表示している間は操作用の表示を隠し、モデルだけを画面いっぱいに出す(読み込めていなければ、通常の画面のまま)
function updateAvatar() {
  const speaking = Boolean(state?.owner && state.mode === 'output');
  const staged = Boolean(avatar) && (previewing || speaking);
  if (staged && !document.body.classList.contains('stage')) window.scrollTo(0, 0);
  document.body.classList.toggle('stage', staged);
  // プレビューの終了ボタンはモデルの下(画面の外)に置く。読み上げ中は出さず、モデルだけにする
  previewExitButton.hidden = !staged || speaking;
  if (staged) avatar.show();
  else avatar?.hide();
}

// アドレスバーなどを消して、ページを画面全体に表示する。ブラウザの決まりで、ボタンの操作をきっかけにしか切り替えられない
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (err) {
    console.error('全画面表示を切り替えられません', err);
  }
}

// 「戻る」の操作など、ボタン以外で全画面が終わった場合にも表示を合わせる
function renderFullscreenButton() {
  fullscreenButton.textContent = document.fullscreenElement ? '全画面を終了' : '全画面表示';
}

// プレビューは、モードや担当に関係なくこの端末だけで切り替える
function togglePreview() {
  previewing = !previewing;
  render();
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}${config.wsPath}`);
  socket.binaryType = 'arraybuffer';
  ws = socket;

  socket.onmessage = (event) => {
    // バイナリは、この端末で再生する反論の音声
    if (typeof event.data !== 'string') {
      playRebuttalChunk(event.data);
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'audio_end') {
      endRebuttal();
      return;
    }
    if (message.type !== 'mode') return;
    state = { mode: message.mode, owner: message.owner };
    // 出力モードの切り替わりごとに再生の状態を作り直す。出力モードを抜けたら、鳴っている音声も止める
    stopPlayback();
    playbackFailed = false;
    if (!state.owner) {
      // 担当でなくなった、または開始を断られた場合はマイクを手放す。担当の間のエラー表示は残す
      errorMessage = '';
      stopCapture();
    }
    render();
  };
  // 接続の失敗でも発火する。モードを表示し続けるため、時間をおいて接続し直す
  socket.onclose = () => {
    ws = null;
    state = null;
    stopCapture();
    render();
    setTimeout(connect, config.reconnectDelayMs);
  };
}

async function startCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  // サンプリングレートの変換は Worklet 側で行う(ブラウザ既定のレートのまま取り込む)
  audioContext = new AudioContext();
  // 「開始」の操作をきっかけに作るため、自動再生の制限に掛からない
  playbackContext = new AudioContext({ sampleRate: config.speechSampleRate });
  await audioContext.audioWorklet.addModule('/scripts/pcm-worklet.js');
  const source = audioContext.createMediaStreamSource(mediaStream);
  // 出力を持たないノードにして、destination に繋がなくても処理されるようにする
  const encoder = new AudioWorkletNode(audioContext, 'pcm-encoder', {
    numberOfOutputs: 0,
    processorOptions: { targetRate: config.sampleRate, chunkMs: config.audioChunkMs },
  });
  encoder.port.onmessage = (event) => {
    // サーバも担当以外や出力モード中の音声は捨てるが、無駄な送信を避ける
    if (state?.owner && state.mode === 'input' && ws?.readyState === WebSocket.OPEN) ws.send(event.data);
  };
  source.connect(encoder);
}

function reportPlaybackEnded() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'playback_ended' }));
}

// 再生中の音声をすべて止め、再生の状態を捨てる
function stopPlayback() {
  for (const source of playback?.sources ?? []) {
    source.onended = null;
    source.stop();
  }
  playback = null;
}

// 送られた音声をすべて再生し終えていたら、サーバへ報告する
function finishPlaybackIfDone() {
  if (!playback?.ended || playback.sources.size > 0) return;
  playback = null;
  reportPlaybackEnded();
}

// 反論の音声(16bit PCM・モノラル)を、届いた順に途切れなく続けて再生する。
// 再生専用の AudioContext で鳴らす
function playRebuttalChunk(data) {
  // 出力モードが終わったあとに届いた分や、再生に失敗したあとの残りは捨てる
  if (!state?.owner || state.mode !== 'output' || playbackFailed) return;
  try {
    if (!playbackContext) throw new Error('マイクを担当していません');
    const samples = new Int16Array(data);
    const buffer = playbackContext.createBuffer(1, samples.length, config.speechSampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const current = playback ??= { sources: new Set(), nextTime: 0, ended: false };
    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);
    source.onended = () => {
      current.sources.delete(source);
      if (current === playback) finishPlaybackIfDone();
    };
    // 予約済みの音声が残っていれば、その終わりに続けて鳴らす(残りが少なくても間を空けない)。
    // 尽きていたら、少し先から鳴らし直す
    const startAt = current.nextTime > playbackContext.currentTime
      ? current.nextTime
      : playbackContext.currentTime + PLAYBACK_LEAD_SEC;
    source.start(startAt);
    current.nextTime = startAt + buffer.duration;
    current.sources.add(source);
  } catch (err) {
    // 再生できなくても報告し、出力モードのまま止まらないようにする
    errorMessage = `反論を再生できません(${err.message})`;
    render();
    playbackFailed = true;
    stopPlayback();
    reportPlaybackEnded();
  }
}

// サーバが反論の音声を送り終えた。残りを再生し終えたら報告する
function endRebuttal() {
  if (playbackFailed) return;
  // 音声が 1 つも届いていなくても報告し、出力モードのまま止まらないようにする
  playback ??= { sources: new Set(), nextTime: 0, ended: false };
  playback.ended = true;
  finishPlaybackIfDone();
}

function stopCapture() {
  stopPlayback();
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  audioContext?.close();
  audioContext = null;
  playbackContext?.close();
  playbackContext = null;
}

// マイクを取得できてから担当を申し出る。担当になれたかどうかはサーバからのモードの通知で分かる
async function start() {
  starting = true;
  errorMessage = '';
  render();
  try {
    await startCapture();
    if (ws?.readyState !== WebSocket.OPEN) throw new Error('サーバに接続していません');
    ws.send(JSON.stringify({ type: 'start' }));
  } catch (err) {
    errorMessage = err.message;
    stopCapture();
  }
  starting = false;
  render();
}

function stop() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  stopCapture();
}

// 設定値を受け取ってから接続を始める
async function init() {
  render();
  if (!avatarDisabled) loadAvatar();
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    config = await response.json();
  } catch (err) {
    errorMessage = `設定を取得できません(${err.message})`;
    render();
    return;
  }
  connect();
}

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);
previewButton.addEventListener('click', togglePreview);
previewExitButton.addEventListener('click', togglePreview);
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', renderFullscreenButton);
// 全画面表示に対応しているブラウザでだけボタンを出す
fullscreenButton.hidden = !document.fullscreenEnabled;
init();
