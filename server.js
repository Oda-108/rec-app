import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_DATA_DIR = process.env.REC_DATA_DIR || path.join(__dirname, 'recordings');
const PORT = process.env.PORT || 3456;

// ffmpeg: asar展開パスに対応
const ffmpeg = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

if (!fs.existsSync(BASE_DATA_DIR)) fs.mkdirSync(BASE_DATA_DIR, { recursive: true });

// ===== Per-user helpers =====
function validateUserId(id) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

function getUserDir(userId) {
  if (!userId) return BASE_DATA_DIR;
  const dir = path.join(BASE_DATA_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadMeta(userId) {
  const metaFile = path.join(getUserDir(userId), 'meta.json');
  if (!fs.existsSync(metaFile)) return [];
  return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
}

function saveMeta(userId, data) {
  const metaFile = path.join(getUserDir(userId), 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify(data, null, 2));
}

// ===== Middleware: extract userId =====
function extractUser(req, res, next) {
  const userId = req.headers['x-user-id'] || null;
  if (userId && !validateUserId(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  req.userId = userId;
  next();
}

/**
 * webm → mp4 変換（バックグラウンド）
 */
function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('ffmpeg error:', stderr);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Multer: per-user destination
const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, getUserDir(req.userId)),
  filename: (_req, _file, cb) => {
    const id = `rec_${Date.now()}`;
    cb(null, `${id}.webm`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(extractUser);
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

// 録画一覧
app.get('/api/recordings', (req, res) => {
  const meta = loadMeta(req.userId);
  res.json(meta.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

// 録画詳細
app.get('/api/recordings/:id', (req, res) => {
  const meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

// 変換ステータス
app.get('/api/recordings/:id/status', (req, res) => {
  const meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json({ converting: rec.converting || false, filename: rec.filename });
});

// 録画アップロード → 即保存 → バックグラウンドmp4変換
app.post('/api/recordings', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file' });

  const userDir = getUserDir(req.userId);
  const webmPath = req.file.path;
  const id = path.basename(req.file.filename, '.webm');
  const title = req.body.title || '無題の録画';
  const duration = parseFloat(req.body.duration) || 0;
  const stat = fs.statSync(webmPath);

  const record = {
    id,
    title,
    filename: req.file.filename,
    duration,
    size: stat.size,
    createdAt: new Date().toISOString(),
    converting: true,
  };

  const meta = loadMeta(req.userId);
  meta.push(record);
  saveMeta(req.userId, meta);

  console.log(`Saved: ${req.file.filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB) [user: ${req.userId || 'local'}]`);
  res.json(record);

  // バックグラウンドでmp4変換
  const mp4Filename = `${id}.mp4`;
  const mp4Path = path.join(userDir, mp4Filename);
  const userId = req.userId;

  console.log(`Converting ${id}.webm → ${id}.mp4 (background)...`);
  convertToMp4(webmPath, mp4Path)
    .then(() => {
      const mp4Stat = fs.statSync(mp4Path);
      try { fs.unlinkSync(webmPath); } catch {}
      const meta = loadMeta(userId);
      const rec = meta.find(r => r.id === id);
      if (rec) {
        rec.filename = mp4Filename;
        rec.size = mp4Stat.size;
        rec.converting = false;
        saveMeta(userId, meta);
      }
      console.log(`Converted: ${mp4Filename} (${(mp4Stat.size / 1024 / 1024).toFixed(1)} MB)`);
    })
    .catch((e) => {
      console.error(`Conversion failed for ${id}:`, e.message);
      const meta = loadMeta(userId);
      const rec = meta.find(r => r.id === id);
      if (rec) {
        rec.converting = false;
        saveMeta(userId, meta);
      }
    });
});

// タイトル更新
app.patch('/api/recordings/:id', (req, res) => {
  const meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (req.body.title) rec.title = req.body.title;
  saveMeta(req.userId, meta);
  res.json(rec);
});

// 録画削除
app.delete('/api/recordings/:id', (req, res) => {
  const userDir = getUserDir(req.userId);
  let meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  const baseName = rec.id;
  for (const ext of ['.mp4', '.webm', '_thumb.jpg']) {
    const p = path.join(userDir, baseName + ext);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  meta = meta.filter(r => r.id !== req.params.id);
  saveMeta(req.userId, meta);
  res.json({ success: true });
});

// 動画ファイル配信（Range対応）
app.get('/api/recordings/:id/video', (req, res) => {
  const userDir = getUserDir(req.userId);
  const meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  let filePath = path.join(userDir, rec.filename);
  let contentType = rec.filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm';

  const mp4Path = path.join(userDir, rec.id + '.mp4');
  if (fs.existsSync(mp4Path)) {
    filePath = mp4Path;
    contentType = 'video/mp4';
  }

  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// サムネイル生成
app.get('/api/recordings/:id/thumbnail', (req, res) => {
  const userDir = getUserDir(req.userId);
  const meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  const thumbPath = path.join(userDir, `${rec.id}_thumb.jpg`);

  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  const mp4Path = path.join(userDir, rec.id + '.mp4');
  const webmPath = path.join(userDir, rec.id + '.webm');
  const srcPath = fs.existsSync(mp4Path) ? mp4Path : webmPath;

  if (!fs.existsSync(srcPath)) return res.status(404).send('File not found');

  execFile(ffmpeg, [
    '-i', srcPath,
    '-vframes', '1',
    '-vf', 'scale=320:-1',
    '-q:v', '8',
    '-y',
    thumbPath,
  ], { timeout: 15000 }, (err) => {
    if (err || !fs.existsSync(thumbPath)) {
      return res.status(500).json({ error: 'Thumbnail generation failed' });
    }
    res.sendFile(thumbPath);
  });
});

// ダウンロード（mp4優先）
app.get('/api/recordings/:id/download', (req, res) => {
  const userDir = getUserDir(req.userId);
  const meta = loadMeta(req.userId);
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  const mp4Path = path.join(userDir, rec.id + '.mp4');
  const webmPath = path.join(userDir, rec.id + '.webm');

  if (fs.existsSync(mp4Path)) {
    res.download(mp4Path, `${rec.title}.mp4`);
  } else if (fs.existsSync(webmPath)) {
    res.download(webmPath, `${rec.title}.webm`);
  } else {
    res.status(404).send('File not found');
  }
});

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, () => {
      console.log(`\n  Rec - 画面録画 & 共有`);
      console.log(`  http://localhost:${PORT}\n`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// 直接実行時 or Render等のクラウド実行時は自動起動
const isElectron = process.versions && process.versions.electron;
if (!isElectron) {
  startServer();
}

export { startServer, server, PORT };
