// サーバが持つモードを WebSocket で受け取って表示し続ける。
// この端末がマイクの担当になったら、マイク入力を 24kHz・モノラルの 16bit PCM に変換してサーバへ送る

// 切断されたあと、再接続を試みるまでの時間
const RECONNECT_DELAY_MS = 2000;
const MODE_LABELS = { standby: '待機モード', input: '入力モード', output: '出力モード' };

const modeText = document.getElementById('mode');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusText = document.getElementById('status');

let ws = null;
// サーバから受け取った最新の状態 { mode, owner }。接続していない間は null
let state = null;
// 開始の操作を処理している間は true
let starting = false;
let errorMessage = '';
let audioContext = null;
let mediaStream = null;

function describeStatus() {
  if (errorMessage) return `エラー: ${errorMessage}`;
  if (!state) return 'サーバに接続しています';
  if (state.mode === 'standby') return '「開始」を押した端末がマイクを担当します';
  return state.owner ? 'この端末がマイクを担当しています' : '別の端末がマイクを担当しています';
}

// 表示とボタンの状態は、サーバから受け取った状態だけで決める
function render() {
  modeText.textContent = state ? MODE_LABELS[state.mode] : '未接続';
  statusText.textContent = describeStatus();
  startButton.disabled = starting || state?.mode !== 'standby';
  stopButton.disabled = !state?.owner;
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws`);
  socket.binaryType = 'arraybuffer';
  ws = socket;

  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type !== 'mode') return;
    state = { mode: message.mode, owner: message.owner };
    errorMessage = '';
    // 担当でなくなった、または開始を断られた場合はマイクを手放す
    if (!state.owner) stopCapture();
    render();
  };
  // 接続の失敗でも発火する。モードを表示し続けるため、時間をおいて接続し直す
  socket.onclose = () => {
    ws = null;
    state = null;
    stopCapture();
    render();
    setTimeout(connect, RECONNECT_DELAY_MS);
  };
}

async function startCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  // サンプリングレートの変換は Worklet 側で行う(ブラウザ既定のレートのまま取り込む)
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule('/scripts/pcm-worklet.js');
  const source = audioContext.createMediaStreamSource(mediaStream);
  // 出力を持たないノードにして、destination に繋がなくても処理されるようにする
  const encoder = new AudioWorkletNode(audioContext, 'pcm-encoder', { numberOfOutputs: 0 });
  encoder.port.onmessage = (event) => {
    // サーバも担当以外や出力モード中の音声は捨てるが、無駄な送信を避ける
    if (state?.owner && state.mode === 'input' && ws?.readyState === WebSocket.OPEN) ws.send(event.data);
  };
  source.connect(encoder);
}

function stopCapture() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  audioContext?.close();
  audioContext = null;
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

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);
render();
connect();
