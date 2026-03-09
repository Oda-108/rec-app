// ===== Toast System =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.add('toast-hide');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3500);
}

// ===== Custom Confirm =====
function customConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    msgEl.textContent = message;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('confirm-visible'));

    let resolved = false;
    function cleanup(result) {
      if (resolved) return;
      resolved = true;
      overlay.classList.remove('confirm-visible');
      setTimeout(() => overlay.classList.add('hidden'), 200);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ===== Page Transition =====
function switchPage(fromEl, toEl) {
  fromEl.classList.add('page-exit');
  let switched = false;
  const done = () => {
    if (switched) return;
    switched = true;
    fromEl.classList.remove('active', 'page-exit');
    toEl.classList.add('active');
  };
  fromEl.addEventListener('animationend', done, { once: true });
  setTimeout(done, 250);
}

// ===== Saving Label Helper =====
function setSavingLabel(text) {
  const textEl = savingLabel.querySelector('.saving-text');
  if (textEl) textEl.textContent = text;
}

// ===== DOM =====
const recordPage = document.getElementById('recordPage');
const playerPage = document.getElementById('playerPage');
const backBtn = document.getElementById('backBtn');
const recordingsList = document.getElementById('recordingsList');
const playerTitle = document.getElementById('playerTitle');
const playerVideo = document.getElementById('playerVideo');
const playerMeta = document.getElementById('playerMeta');
const downloadBtn = document.getElementById('downloadBtn');
const deleteBtn = document.getElementById('deleteBtn');
const trimStart = document.getElementById('trimStart');
const trimEnd = document.getElementById('trimEnd');
const trimPreviewBtn = document.getElementById('trimPreviewBtn');
const trimSaveBtn = document.getElementById('trimSaveBtn');
const savingOverlay = document.getElementById('savingOverlay');
const savingLabel = document.getElementById('savingLabel');
const mosaicCanvas = document.getElementById('mosaicCanvas');
const mosaicEditBtn = document.getElementById('mosaicEditBtn');
const mosaicDoneBtn = document.getElementById('mosaicDoneBtn');
const mosaicUndoBtn = document.getElementById('mosaicUndoBtn');
const mosaicClearBtn = document.getElementById('mosaicClearBtn');
const mosaicSaveBtn = document.getElementById('mosaicSaveBtn');
const mosaicHint = document.getElementById('mosaicHint');
const mosaicBrushWrap = document.getElementById('mosaicBrushWrap');
const mosaicBrushSize = document.getElementById('mosaicBrushSize');
const trimTimeline = document.getElementById('trimTimeline');
const trimSelected = document.getElementById('trimSelected');
const trimHandleStart = document.getElementById('trimHandleStart');
const trimHandleEnd = document.getElementById('trimHandleEnd');
const trimPlayhead = document.getElementById('trimPlayhead');
const recordingStatus = document.getElementById('recordingStatus');
const mainRecBtn = document.getElementById('mainRecBtn');
const mainRecLabel = document.getElementById('mainRecLabel');
const recordingStopBtn = document.getElementById('recordingStopBtn');

// ===== State =====
let currentRecording = null;
let titleSaveTimer = null;
// モザイク
let mosaicEditing = false;
let mosaicDrawing = false;
let mosaicHistory = [];
let mosaicHasMask = false;
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');
const _pixelSmall = document.createElement('canvas');
const _pixelFull = document.createElement('canvas');
const _composite = document.createElement('canvas');
// トリムタイムライン
let trimDuration = 0;
let draggingTrimHandle = null;

// ===== Record Button (triggers control window via IPC) =====
mainRecBtn.addEventListener('click', () => {
  if (window.electronAPI?.isElectron) {
    window.electronAPI.triggerRecording();
  }
});

recordingStopBtn.addEventListener('click', () => {
  if (window.electronAPI?.isElectron) {
    window.electronAPI.triggerRecording();
  }
});

// ===== Electron IPC =====
if (window.electronAPI?.isElectron) {
  document.documentElement.classList.add('electron');

  window.electronAPI.onRefreshRecordings(() => {
    loadRecordings();
  });

  window.electronAPI.onRecordingState((recording) => {
    recordingStatus.classList.toggle('hidden', !recording);
    mainRecBtn.classList.toggle('hidden', recording);
    mainRecLabel.classList.toggle('hidden', recording);
  });
}

// ===== Recordings List =====
function renderSkeleton() {
  recordingsList.innerHTML = Array(3).fill('').map(() => `
    <div class="recording-item skeleton">
      <div class="recording-thumb skeleton-box"></div>
      <div class="recording-info">
        <div class="skeleton-line" style="width:60%"></div>
        <div class="skeleton-line" style="width:40%"></div>
      </div>
    </div>
  `).join('');
}

async function loadRecordings() {
  renderSkeleton();
  try {
    const res = await fetch('/api/recordings');
    renderRecordings(await res.json());
  } catch (e) {
    console.error('Failed to load recordings:', e);
    recordingsList.innerHTML = '';
  }
}

function renderRecordings(recordings) {
  if (recordings.length === 0) {
    recordingsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><span></span></div>
        <div class="empty-text">録画がありません</div>
        <div class="empty-hint">コントロールウィンドウから録画を開始しましょう</div>
      </div>
    `;
    return;
  }
  const hasConverting = recordings.some(r => r.converting);
  recordingsList.innerHTML = recordings.map(r => `
    <div class="recording-item" data-id="${r.id}" onclick="openPlayer('${r.id}')">
      <div class="recording-thumb">
        ${r.converting
          ? '<div class="converting-indicator"><span></span><span></span><span></span></div>'
          : `<img src="/api/recordings/${r.id}/thumbnail" alt="" loading="lazy" onerror="this.parentNode.classList.add('no-thumb')">`
        }
      </div>
      <div class="recording-info">
        <div class="title">${escapeHtml(r.title)}</div>
        <div class="meta">${formatDate(r.createdAt)} · ${formatDuration(r.duration)} · ${formatSize(r.size)}</div>
      </div>
      <button class="recording-delete" onclick="event.stopPropagation(); deleteRecording('${r.id}')" title="この録画を削除">✕</button>
      <span class="recording-arrow">›</span>
    </div>
  `).join('');
  if (hasConverting) {
    setTimeout(loadRecordings, 3000);
  }
}

// ===== Player =====
async function openPlayer(id) {
  try {
    const res = await fetch(`/api/recordings/${id}`);
    currentRecording = await res.json();

    playerTitle.value = currentRecording.title;
    playerVideo.src = `/api/recordings/${id}/video`;
    playerMeta.textContent = `${formatDate(currentRecording.createdAt)} · ${formatDuration(currentRecording.duration)} · ${formatSize(currentRecording.size)}`;
    trimStart.value = '0:00';
    trimEnd.value = formatDuration(currentRecording.duration);
    resetMosaic();
    initTimeline(currentRecording.duration);

    switchPage(recordPage, playerPage);
    backBtn.classList.remove('hidden');
  } catch (e) {
    console.error('Failed to open player:', e);
  }
}

function closePlayer() {
  playerVideo.pause();
  playerVideo.src = '';
  currentRecording = null;
  resetMosaic();
  switchPage(playerPage, recordPage);
  backBtn.classList.add('hidden');
  loadRecordings();
}

backBtn.addEventListener('click', closePlayer);

playerTitle.addEventListener('input', () => {
  if (titleSaveTimer) clearTimeout(titleSaveTimer);
  titleSaveTimer = setTimeout(async () => {
    if (!currentRecording) return;
    await fetch(`/api/recordings/${currentRecording.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: playerTitle.value }),
    });
    currentRecording.title = playerTitle.value;
  }, 800);
});

downloadBtn.addEventListener('click', () => {
  if (!currentRecording) return;
  window.location.href = `/api/recordings/${currentRecording.id}/download`;
});

deleteBtn.addEventListener('click', async () => {
  if (!currentRecording) return;
  if (!(await customConfirm('この録画を削除しますか？'))) return;
  await fetch(`/api/recordings/${currentRecording.id}`, { method: 'DELETE' });
  showToast('録画を削除しました', 'success');
  closePlayer();
});

window.deleteRecording = async function (id) {
  if (!(await customConfirm('この録画を削除しますか？'))) return;
  await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
  showToast('録画を削除しました', 'success');
  loadRecordings();
};
window.openPlayer = openPlayer;

// ===== Trim Timeline =====
function initTimeline(duration) {
  trimDuration = duration;
  updateTimelineFromInputs();
}

function updateTimelineFromInputs() {
  if (!trimDuration) return;
  const start = parseTime(trimStart.value);
  const end = parseTime(trimEnd.value);
  const startPct = Math.max(0, Math.min(100, (start / trimDuration) * 100));
  const endPct = Math.max(0, Math.min(100, (end / trimDuration) * 100));

  trimHandleStart.style.left = startPct + '%';
  trimHandleEnd.style.left = endPct + '%';
  trimSelected.style.left = startPct + '%';
  trimSelected.style.width = (endPct - startPct) + '%';
}

function updatePlayhead() {
  if (!trimDuration || !playerVideo) return;
  const pct = (playerVideo.currentTime / trimDuration) * 100;
  trimPlayhead.style.left = Math.min(100, pct) + '%';
}

function onTrimHandleDown(handleType) {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    draggingTrimHandle = handleType;
    document.addEventListener('mousemove', onTrimHandleDrag);
    document.addEventListener('mouseup', onTrimHandleUp);
    document.addEventListener('touchmove', onTrimHandleDrag, { passive: false });
    document.addEventListener('touchend', onTrimHandleUp);
  };
}

function onTrimHandleDrag(e) {
  if (!draggingTrimHandle || !trimDuration) return;
  e.preventDefault();
  const pos = e.touches ? e.touches[0] : e;
  const rect = trimTimeline.getBoundingClientRect();
  let pct = ((pos.clientX - rect.left) / rect.width) * 100;
  pct = Math.max(0, Math.min(100, pct));
  const time = (pct / 100) * trimDuration;

  if (draggingTrimHandle === 'start') {
    const endTime = parseTime(trimEnd.value);
    if (time < endTime) {
      trimStart.value = formatDuration(time);
    }
  } else {
    const startTime = parseTime(trimStart.value);
    if (time > startTime) {
      trimEnd.value = formatDuration(time);
    }
  }
  updateTimelineFromInputs();
}

function onTrimHandleUp() {
  draggingTrimHandle = null;
  document.removeEventListener('mousemove', onTrimHandleDrag);
  document.removeEventListener('mouseup', onTrimHandleUp);
  document.removeEventListener('touchmove', onTrimHandleDrag);
  document.removeEventListener('touchend', onTrimHandleUp);
}

trimHandleStart.addEventListener('mousedown', onTrimHandleDown('start'));
trimHandleStart.addEventListener('touchstart', onTrimHandleDown('start'), { passive: false });
trimHandleEnd.addEventListener('mousedown', onTrimHandleDown('end'));
trimHandleEnd.addEventListener('touchstart', onTrimHandleDown('end'), { passive: false });

trimStart.addEventListener('input', updateTimelineFromInputs);
trimEnd.addEventListener('input', updateTimelineFromInputs);
playerVideo.addEventListener('timeupdate', updatePlayhead);

// ===== Trim =====
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

trimPreviewBtn.addEventListener('click', () => {
  if (!playerVideo) return;
  const start = parseTime(trimStart.value);
  playerVideo.currentTime = start;
  playerVideo.play();
  const end = parseTime(trimEnd.value);
  const checkEnd = () => {
    if (playerVideo.currentTime >= end) {
      playerVideo.pause();
      playerVideo.removeEventListener('timeupdate', checkEnd);
    }
  };
  playerVideo.addEventListener('timeupdate', checkEnd);
});

trimSaveBtn.addEventListener('click', async () => {
  if (!currentRecording) return;
  const start = parseTime(trimStart.value);
  const end = parseTime(trimEnd.value);
  if (start >= end) {
    showToast('開始時間は終了時間より前にしてください', 'error');
    return;
  }

  savingOverlay.classList.remove('hidden');
  setSavingLabel('カット編集中');

  try {
    const videoRes = await fetch(`/api/recordings/${currentRecording.id}/video`);
    const videoBlob = await videoRes.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    const srcVideo = document.createElement('video');
    srcVideo.src = videoUrl;
    srcVideo.muted = true;
    srcVideo.playsInline = true;
    await new Promise((r, j) => { srcVideo.onloadedmetadata = r; srcVideo.onerror = j; });

    const tc = document.createElement('canvas');
    tc.width = srcVideo.videoWidth || 1920;
    tc.height = srcVideo.videoHeight || 1080;
    const tctx = tc.getContext('2d');
    const tcs = tc.captureStream(30);

    let cs;
    try {
      const ac = new AudioContext();
      const src = ac.createMediaElementSource(srcVideo);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest); src.connect(ac.destination);
      cs = new MediaStream([...tcs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } catch { cs = tcs; }

    const chunks = [];
    const mt = getSupportedMimeType();
    const rec = new MediaRecorder(cs, mt ? { mimeType: mt } : {});
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });

    srcVideo.currentTime = start;
    await new Promise(r => { srcVideo.onseeked = r; });
    rec.start(100);
    srcVideo.muted = false;
    await srcVideo.play();

    const di = setInterval(() => {
      tctx.drawImage(srcVideo, 0, 0, tc.width, tc.height);
      if (srcVideo.currentTime >= end || srcVideo.paused || srcVideo.ended) {
        clearInterval(di); srcVideo.pause();
        setTimeout(() => rec.stop(), 200);
      }
    }, 1000 / 30);

    await done;
    URL.revokeObjectURL(videoUrl);

    const tb = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
    const fd = new FormData();
    fd.append('video', tb, 'trimmed.webm');
    fd.append('title', `${currentRecording.title} (カット)`);
    fd.append('duration', (end - start).toString());
    await fetch('/api/recordings', { method: 'POST', body: fd });

    savingOverlay.classList.add('hidden');
    showToast('カット編集を保存しました', 'success');
    closePlayer();
  } catch (e) {
    console.error('Trim failed:', e);
    savingOverlay.classList.add('hidden');
    showToast('カット編集に失敗しました: ' + e.message, 'error');
  }
});

// ===== Utilities =====
function formatDuration(s) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
function formatDate(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
function formatSize(b) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function parseTime(str) {
  const p = str.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0);
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ===== Mosaic Tool (Pen) =====
let mosaicCursorPos = null;

function getBrushRadius() {
  const v = parseInt(mosaicBrushSize.value);
  return mosaicCanvas.width * (v / 1000);
}

function resetMosaic() {
  mosaicEditing = false;
  mosaicDrawing = false;
  mosaicHistory = [];
  mosaicHasMask = false;
  mosaicCursorPos = null;
  maskCanvas.width = 0;
  maskCanvas.height = 0;
  mosaicCanvas.classList.add('hidden');
  mosaicEditBtn.style.display = '';
  mosaicDoneBtn.style.display = 'none';
  mosaicBrushWrap.style.display = 'none';
  mosaicUndoBtn.disabled = true;
  mosaicClearBtn.disabled = true;
  mosaicSaveBtn.disabled = true;
  mosaicHint.textContent = '動画を一時停止 → ペンツールでモザイクを自由に描画';
}

function enterMosaicMode() {
  playerVideo.pause();
  mosaicEditing = true;

  const vw = playerVideo.videoWidth || 1920;
  const vh = playerVideo.videoHeight || 1080;
  mosaicCanvas.width = vw;
  mosaicCanvas.height = vh;

  if (maskCanvas.width !== vw || maskCanvas.height !== vh) {
    maskCanvas.width = vw;
    maskCanvas.height = vh;
  }

  _pixelFull.width = vw;
  _pixelFull.height = vh;
  _composite.width = vw;
  _composite.height = vh;

  drawMosaicPreview();
  mosaicCanvas.classList.remove('hidden');
  mosaicEditBtn.style.display = 'none';
  mosaicDoneBtn.style.display = '';
  mosaicBrushWrap.style.display = 'flex';
  mosaicHint.textContent = '動画上をドラッグしてモザイクを描画';
}

function exitMosaicMode() {
  mosaicEditing = false;
  mosaicCanvas.classList.add('hidden');
  mosaicEditBtn.style.display = '';
  mosaicDoneBtn.style.display = 'none';
  mosaicBrushWrap.style.display = 'none';
  mosaicHint.textContent = mosaicHasMask
    ? 'モザイク描画済み — 「適用して保存」で反映'
    : '動画を一時停止 → ペンツールでモザイクを自由に描画';
}

function drawMosaicPreview() {
  const ctx = mosaicCanvas.getContext('2d');
  const cw = mosaicCanvas.width;
  const ch = mosaicCanvas.height;

  ctx.drawImage(playerVideo, 0, 0, cw, ch);

  if (mosaicHasMask) {
    applyMosaicWithMask(ctx, cw, ch);
  }

  if (mosaicCursorPos && mosaicEditing) {
    const r = getBrushRadius();
    ctx.beginPath();
    ctx.arc(mosaicCursorPos.x, mosaicCursorPos.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function applyMosaicWithMask(ctx, cw, ch) {
  const scale = 0.035;
  const sw = Math.max(1, Math.round(cw * scale));
  const sh = Math.max(1, Math.round(ch * scale));

  _pixelSmall.width = sw;
  _pixelSmall.height = sh;
  _pixelSmall.getContext('2d').drawImage(ctx.canvas, 0, 0, sw, sh);

  const pfctx = _pixelFull.getContext('2d');
  pfctx.imageSmoothingEnabled = false;
  pfctx.clearRect(0, 0, cw, ch);
  pfctx.drawImage(_pixelSmall, 0, 0, cw, ch);

  const cctx = _composite.getContext('2d');
  cctx.globalCompositeOperation = 'source-over';
  cctx.clearRect(0, 0, cw, ch);
  cctx.drawImage(maskCanvas, 0, 0);
  cctx.globalCompositeOperation = 'source-in';
  cctx.drawImage(_pixelFull, 0, 0);
  cctx.globalCompositeOperation = 'source-over';

  ctx.drawImage(_composite, 0, 0);
}

function updateMosaicButtons() {
  mosaicUndoBtn.disabled = mosaicHistory.length === 0;
  mosaicClearBtn.disabled = !mosaicHasMask;
  mosaicSaveBtn.disabled = !mosaicHasMask;
}

function getCanvasPos(e) {
  const rect = mosaicCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (mosaicCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (mosaicCanvas.height / rect.height),
  };
}

function drawBrushAt(x, y) {
  const r = getBrushRadius();
  maskCtx.beginPath();
  maskCtx.arc(x, y, r, 0, Math.PI * 2);
  maskCtx.fill();
}

mosaicCanvas.addEventListener('pointerdown', (e) => {
  if (!mosaicEditing) return;
  mosaicDrawing = true;
  mosaicCanvas.setPointerCapture(e.pointerId);

  mosaicHistory.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
  if (mosaicHistory.length > 30) mosaicHistory.shift();

  maskCtx.fillStyle = 'white';
  const pos = getCanvasPos(e);
  drawBrushAt(pos.x, pos.y);
  mosaicHasMask = true;
  updateMosaicButtons();
  drawMosaicPreview();
});

let lastBrushPos = null;
mosaicCanvas.addEventListener('pointermove', (e) => {
  if (!mosaicEditing) return;
  const pos = getCanvasPos(e);
  mosaicCursorPos = pos;

  if (mosaicDrawing) {
    maskCtx.fillStyle = 'white';
    if (lastBrushPos) {
      const dx = pos.x - lastBrushPos.x;
      const dy = pos.y - lastBrushPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = getBrushRadius();
      const step = Math.max(1, r * 0.3);
      const steps = Math.ceil(dist / step);
      for (let i = 0; i <= steps; i++) {
        const t = i / Math.max(1, steps);
        drawBrushAt(lastBrushPos.x + dx * t, lastBrushPos.y + dy * t);
      }
    } else {
      drawBrushAt(pos.x, pos.y);
    }
    lastBrushPos = pos;
    mosaicHasMask = true;
  }

  scheduleMosaicRedraw();
});

let mosaicRedrawScheduled = false;
function scheduleMosaicRedraw() {
  if (mosaicRedrawScheduled) return;
  mosaicRedrawScheduled = true;
  requestAnimationFrame(() => {
    drawMosaicPreview();
    mosaicRedrawScheduled = false;
  });
}

mosaicCanvas.addEventListener('pointerup', () => {
  mosaicDrawing = false;
  lastBrushPos = null;
  drawMosaicPreview();
});

mosaicCanvas.addEventListener('pointerleave', () => {
  mosaicCursorPos = null;
  if (!mosaicDrawing) drawMosaicPreview();
});

mosaicEditBtn.addEventListener('click', enterMosaicMode);
mosaicDoneBtn.addEventListener('click', exitMosaicMode);

mosaicUndoBtn.addEventListener('click', () => {
  if (mosaicHistory.length === 0) return;
  const prev = mosaicHistory.pop();
  maskCtx.putImageData(prev, 0, 0);
  const d = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  mosaicHasMask = d.some((v, i) => i % 4 === 3 && v > 0);
  updateMosaicButtons();
  if (mosaicEditing) drawMosaicPreview();
});

mosaicClearBtn.addEventListener('click', () => {
  mosaicHistory.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  mosaicHasMask = false;
  updateMosaicButtons();
  if (mosaicEditing) drawMosaicPreview();
});

mosaicSaveBtn.addEventListener('click', saveMosaicVideo);

async function saveMosaicVideo() {
  savingOverlay.classList.remove('hidden');
  setSavingLabel('モザイク適用中');

  try {
    const videoRes = await fetch(`/api/recordings/${currentRecording.id}/video`);
    const videoBlob = await videoRes.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    const srcVideo = document.createElement('video');
    srcVideo.src = videoUrl;
    srcVideo.muted = true;
    srcVideo.playsInline = true;
    await new Promise((r, j) => { srcVideo.onloadedmetadata = r; srcVideo.onerror = j; });

    const cw = srcVideo.videoWidth || 1920;
    const ch = srcVideo.videoHeight || 1080;

    if (maskCanvas.width !== cw || maskCanvas.height !== ch) {
      const tmpMask = document.createElement('canvas');
      tmpMask.width = cw;
      tmpMask.height = ch;
      tmpMask.getContext('2d').drawImage(maskCanvas, 0, 0, cw, ch);
      maskCanvas.width = cw;
      maskCanvas.height = ch;
      maskCtx.drawImage(tmpMask, 0, 0);
    }

    _pixelFull.width = cw;
    _pixelFull.height = ch;
    _composite.width = cw;
    _composite.height = ch;

    const tc = document.createElement('canvas');
    tc.width = cw;
    tc.height = ch;
    const tctx = tc.getContext('2d');
    const tcs = tc.captureStream(30);

    let cs;
    try {
      const ac = new AudioContext();
      const src = ac.createMediaElementSource(srcVideo);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      src.connect(ac.destination);
      cs = new MediaStream([...tcs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } catch { cs = tcs; }

    const chunks = [];
    const mt = getSupportedMimeType();
    const rec = new MediaRecorder(cs, mt ? { mimeType: mt } : {});
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });

    srcVideo.currentTime = 0;
    await new Promise(r => { srcVideo.onseeked = r; });
    rec.start(100);
    srcVideo.muted = false;
    await srcVideo.play();

    const di = setInterval(() => {
      tctx.drawImage(srcVideo, 0, 0, cw, ch);
      applyMosaicWithMask(tctx, cw, ch);
      if (srcVideo.paused || srcVideo.ended) {
        clearInterval(di);
        setTimeout(() => rec.stop(), 200);
      }
    }, 1000 / 30);

    await done;
    URL.revokeObjectURL(videoUrl);

    const tb = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
    const fd = new FormData();
    fd.append('video', tb, 'mosaic.webm');
    fd.append('title', `${currentRecording.title} (mosaic)`);
    fd.append('duration', currentRecording.duration.toString());
    await fetch('/api/recordings', { method: 'POST', body: fd });

    savingOverlay.classList.add('hidden');
    showToast('モザイクを適用しました', 'success');
    resetMosaic();
    closePlayer();
  } catch (e) {
    console.error('Mosaic save failed:', e);
    savingOverlay.classList.add('hidden');
    showToast('モザイク適用に失敗しました: ' + e.message, 'error');
  }
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

  const isPlayerPage = playerPage.classList.contains('active');

  if (e.key === 'Escape' && isPlayerPage) {
    closePlayer();
  }
});

// ===== Init =====
loadRecordings();
