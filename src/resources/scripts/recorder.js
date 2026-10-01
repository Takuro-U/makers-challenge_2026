// マイク入力を 24kHz・モノラルの 16bit PCM に変換し、WebSocket でサーバへ送る

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusText = document.getElementById('status');

let ws = null;
let audioContext = null;
let mediaStream = null;

function setStatus(text) {
  statusText.textContent = text;
}

async function start() {
  startButton.disabled = true;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${scheme}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('WebSocket に接続できません'));
    });
    ws.onclose = () => {
      setStatus('切断されました');
      stop();
    };

    // サンプリングレートの変換は Worklet 側で行う(ブラウザ既定のレートのまま取り込む)
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule('/scripts/pcm-worklet.js');
    const source = audioContext.createMediaStreamSource(mediaStream);
    // 出力を持たないノードにして、destination に繋がなくても処理されるようにする
    const encoder = new AudioWorkletNode(audioContext, 'pcm-encoder', { numberOfOutputs: 0 });
    encoder.port.onmessage = (event) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(event.data);
    };
    source.connect(encoder);

    stopButton.disabled = false;
    setStatus('録音中');
  } catch (err) {
    setStatus(`エラー: ${err.message}`);
    stop();
  }
}

function stop() {
  stopButton.disabled = true;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  audioContext?.close();
  audioContext = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  startButton.disabled = false;
  if (statusText.textContent === '録音中') setStatus('停止中');
}

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);
