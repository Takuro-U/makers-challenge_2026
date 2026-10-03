// サーバが持つモードを WebSocket で受け取って表示し続ける。
// この端末が担当のときは、サーバから届いた反論の音声を再生する。
// この端末がマイクの担当になったら、マイク入力をモノラルの 16bit PCM(サンプリングレートはサーバの指定)に変換してサーバへ送る

const MODE_LABELS = { standby: '待機モード', input: '入力モード', output: '出力モード' };

const modeText = document.getElementById('mode');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusText = document.getElementById('status');

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
let mediaStream = null;
// 再生中の反論 { sources: 再生待ち・再生中の音声, nextTime: 次の音声を鳴らし始める時刻, ended: サーバが送り終えたか }
let playback = null;
// 再生に失敗して終了を報告済みの間は true
let playbackFailed = false;

// 最初の音声を鳴らし始めるまでの余裕(秒)。続きが届く前に途切れるのを防ぐ
const PLAYBACK_LEAD_SEC = 0.15;

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
// 「開始」の操作で動き出したマイク用の AudioContext で再生するため、自動再生の制限に掛からない
function playRebuttalChunk(data) {
  // 出力モードが終わったあとに届いた分や、再生に失敗したあとの残りは捨てる
  if (!state?.owner || state.mode !== 'output' || playbackFailed) return;
  try {
    if (!audioContext) throw new Error('マイクを担当していません');
    const samples = new Int16Array(data);
    // サンプリングレートの変換は AudioContext に任せる
    const buffer = audioContext.createBuffer(1, samples.length, config.speechSampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const current = playback ??= { sources: new Set(), nextTime: 0, ended: false };
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      current.sources.delete(source);
      if (current === playback) finishPlaybackIfDone();
    };
    // 前の音声の終わりに続けて鳴らす。予約が尽きていたら、少し先から鳴らし直す
    const startAt = Math.max(current.nextTime, audioContext.currentTime + PLAYBACK_LEAD_SEC);
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
init();
