// ===== DOM =====
const recordBtn = document.getElementById('recordBtn');
const timerEl = document.getElementById('timer');
const webcamCircle = document.getElementById('webcamCircle');
const webcamVideo = document.getElementById('webcamVideo');
const iconImage = document.getElementById('iconImage');
const webcamPlaceholder = document.getElementById('webcamPlaceholder');
const micToggle = document.getElementById('micToggle');
const sysAudioToggle = document.getElementById('sysAudioToggle');
const countdownEl = document.getElementById('countdown');
const statusEl = document.getElementById('status');
const imageInput = document.getElementById('imageInput');

// ===== State =====
let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let webcamStream = null;
let micStream = null;
let drawIntervalId = null;
let timerInterval = null;
let startTime = 0;
let iconMode = 'camera';
let iconImageEl = null;
let micEnabled = true;
let sysAudioEnabled = true;

// ===== Audio Toggles =====
micToggle.addEventListener('click', () => {
  micEnabled = !micEnabled;
  micToggle.classList.toggle('active', micEnabled);
});
sysAudioToggle.addEventListener('click', () => {
  sysAudioEnabled = !sysAudioEnabled;
  sysAudioToggle.classList.toggle('active', sysAudioEnabled);
});

// ===== Mode Tabs =====
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    iconMode = btn.dataset.mode;

    if (iconMode === 'camera') {
      startWebcam();
    } else {
      stopWebcam();
    }

    if (iconMode === 'image' && !iconImageEl) {
      imageInput.click();
    }

    updatePreview();
  });
});

// ===== Image Upload =====
webcamCircle.addEventListener('click', () => {
  if (iconMode === 'image') {
    imageInput.click();
  }
});

imageInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    iconImageEl = new Image();
    iconImageEl.src = dataUrl;
    iconImage.src = dataUrl;
    localStorage.setItem('rec_icon_image', dataUrl);
    updatePreview();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Restore saved image
(function () {
  const saved = localStorage.getItem('rec_icon_image');
  if (saved) {
    iconImageEl = new Image();
    iconImageEl.src = saved;
    iconImage.src = saved;
  }
})();

function updatePreview() {
  webcamPlaceholder.classList.add('hidden');
  if (iconMode === 'camera' && webcamStream) {
    webcamVideo.classList.remove('hidden');
    iconImage.classList.add('hidden');
  } else if (iconMode === 'image' && iconImageEl) {
    webcamVideo.classList.add('hidden');
    iconImage.classList.remove('hidden');
  } else {
    webcamVideo.classList.add('hidden');
    iconImage.classList.add('hidden');
    webcamPlaceholder.classList.remove('hidden');
  }
}

// ===== Webcam =====
async function startWebcam() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 320, facingMode: 'user' },
      audio: false,
    });
    webcamVideo.srcObject = webcamStream;
    updatePreview();
  } catch (e) {
    console.warn('Webcam not available:', e.message);
    iconMode = 'none';
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-mode="none"]').classList.add('active');
    updatePreview();
  }
}

function stopWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  webcamVideo.srcObject = null;
}

if (iconMode === 'camera') startWebcam();

// ===== Countdown =====
function showCountdown() {
  return new Promise((resolve) => {
    countdownEl.classList.remove('hidden');
    let count = 3;
    countdownEl.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        countdownEl.classList.add('hidden');
        resolve();
      } else {
        countdownEl.textContent = count;
      }
    }, 1000);
  });
}

// ===== MIME Type =====
function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

// ===== Recording =====
recordBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: true,
    });

    await showCountdown();

    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack || screenTrack.readyState === 'ended') {
      cleanup();
      return;
    }

    micStream = null;
    if (micEnabled) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        micStream = null;
      }
    }

    const settings = screenTrack.getSettings();
    const sw = settings.width || 1920;
    const sh = settings.height || 1080;

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');

    const screenVideo = document.createElement('video');
    screenVideo.setAttribute('playsinline', '');
    screenVideo.setAttribute('autoplay', '');
    screenVideo.muted = true;
    screenVideo.srcObject = screenStream;
    await screenVideo.play();

    drawIntervalId = setInterval(() => {
      try {
        ctx.drawImage(screenVideo, 0, 0, sw, sh);
        drawIconOverlay(ctx, sw, sh);
      } catch {}
    }, 1000 / 30);

    const canvasStream = canvas.captureStream(30);
    let finalStream;
    try {
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      let hasAudio = false;
      if (sysAudioEnabled && screenStream.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(screenStream).connect(dest);
        hasAudio = true;
      }
      if (micEnabled && micStream?.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(micStream).connect(dest);
        hasAudio = true;
      }
      finalStream = hasAudio
        ? new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()])
        : canvasStream;
    } catch {
      finalStream = canvasStream;
    }

    recordedChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(finalStream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      setTimeout(() => saveRecording(), 200);
    };
    mediaRecorder.onerror = (e) => console.error('MediaRecorder error:', e);

    mediaRecorder.start(500);
    screenTrack.onended = () => stopRecording();

    // UI
    recordBtn.classList.add('recording');
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);
    updateTimer();

    // Notify main process
    if (window.electronAPI) {
      window.electronAPI.notifyRecordingState(true);
    }

  } catch (e) {
    console.error('Recording start failed:', e);
    cleanup();
    if (e.name !== 'NotAllowedError') {
      statusEl.textContent = '録画開始に失敗';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }
  }
}

function drawIconOverlay(ctx, sw, sh) {
  const size = Math.round(sw * 0.12);
  // Fixed position: bottom-right
  const cx = sw - size / 2 - 40;
  const cy = sh - size / 2 - 40;

  let source = null;
  if (iconMode === 'camera' && webcamStream && webcamVideo.readyState >= 2) {
    source = webcamVideo;
  } else if (iconMode === 'image' && iconImageEl && iconImageEl.complete) {
    source = iconImageEl;
  }
  if (!source) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (source === webcamVideo) {
    ctx.translate(cx + size / 2, cy - size / 2);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, size, size);
  } else {
    const imgW = source.naturalWidth || source.width;
    const imgH = source.naturalHeight || source.height;
    const imgSize = Math.min(imgW, imgH);
    const sx = (imgW - imgSize) / 2;
    const sy = (imgH - imgSize) / 2;
    ctx.drawImage(source, sx, sy, imgSize, imgSize, cx - size / 2, cy - size / 2, size, size);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (drawIntervalId) { clearInterval(drawIntervalId); drawIntervalId = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }

  recordBtn.classList.remove('recording');
  clearInterval(timerInterval);
  timerEl.textContent = '';

  if (window.electronAPI) {
    window.electronAPI.notifyRecordingState(false);
  }
}

function cleanup() {
  stopRecording();
}

function updateTimer() {
  const elapsed = (Date.now() - startTime) / 1000;
  const min = Math.floor(elapsed / 60);
  const sec = Math.floor(elapsed % 60);
  timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
}

async function saveRecording() {
  if (recordedChunks.length === 0) {
    statusEl.textContent = 'データなし';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
    return;
  }

  statusEl.textContent = '保存中...';

  try {
    const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'video/webm' });
    const duration = (Date.now() - startTime) / 1000;

    const formData = new FormData();
    formData.append('video', blob, 'recording.webm');
    formData.append('title', `録画 ${new Date().toLocaleString('ja-JP')}`);
    formData.append('duration', duration.toString());

    const res = await fetch('/api/recordings', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

    statusEl.textContent = '保存完了';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);

    if (window.electronAPI) {
      window.electronAPI.notifyRecordingSaved();
    }
  } catch (e) {
    console.error('Save failed:', e);
    statusEl.textContent = 'エラー: ' + e.message;
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }
}

// ===== IPC: External toggle =====
if (window.electronAPI) {
  window.electronAPI.onToggleRecording(() => {
    recordBtn.click();
  });
}
