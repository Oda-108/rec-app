import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// パッケージ化されたアプリではユーザーデータ領域を使う
const RECORDINGS_DIR = process.env.REC_DATA_DIR
  ? path.join(process.env.REC_DATA_DIR, 'recordings')
  : path.join(__dirname, 'recordings');
const META_FILE = path.join(RECORDINGS_DIR, 'meta.json');
const PORT = 3456;

// ffmpeg: asar展開パスに対応
const ffmpeg = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

function loadMeta() {
  if (!fs.existsSync(META_FILE)) return [];
  return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
}
function saveMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
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

// Multer: webmとして保存
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECORDINGS_DIR),
  filename: (_req, file, cb) => {
    const id = `rec_${Date.now()}`;
    cb(null, `${id}.webm`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

// 録画一覧
app.get('/api/recordings', (_req, res) => {
  const meta = loadMeta();
  res.json(meta.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

// 録画詳細
app.get('/api/recordings/:id', (req, res) => {
  const meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

// 変換ステータス
app.get('/api/recordings/:id/status', (req, res) => {
  const meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json({ converting: rec.converting || false, filename: rec.filename });
});

// 録画アップロード → 即保存 → バックグラウンドmp4変換
app.post('/api/recordings', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file' });

  const webmPath = req.file.path;
  const id = path.basename(req.file.filename, '.webm');
  const title = req.body.title || '無題の録画';
  const duration = parseFloat(req.body.duration) || 0;
  const stat = fs.statSync(webmPath);

  // まずwebmで即座に保存（レスポンス返す）
  const record = {
    id,
    title,
    filename: req.file.filename,
    duration,
    size: stat.size,
    createdAt: new Date().toISOString(),
    converting: true,
  };

  const meta = loadMeta();
  meta.push(record);
  saveMeta(meta);

  console.log(`Saved: ${req.file.filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
  res.json(record);

  // バックグラウンドでmp4変換
  const mp4Filename = `${id}.mp4`;
  const mp4Path = path.join(RECORDINGS_DIR, mp4Filename);

  console.log(`Converting ${id}.webm → ${id}.mp4 (background)...`);
  convertToMp4(webmPath, mp4Path)
    .then(() => {
      const mp4Stat = fs.statSync(mp4Path);
      // webm削除
      try { fs.unlinkSync(webmPath); } catch {}
      // meta更新
      const meta = loadMeta();
      const rec = meta.find(r => r.id === id);
      if (rec) {
        rec.filename = mp4Filename;
        rec.size = mp4Stat.size;
        rec.converting = false;
        saveMeta(meta);
      }
      console.log(`Converted: ${mp4Filename} (${(mp4Stat.size / 1024 / 1024).toFixed(1)} MB)`);
    })
    .catch((e) => {
      console.error(`Conversion failed for ${id}:`, e.message);
      // 変換失敗してもwebmは残る。convertingフラグだけ外す
      const meta = loadMeta();
      const rec = meta.find(r => r.id === id);
      if (rec) {
        rec.converting = false;
        saveMeta(meta);
      }
    });
});

// タイトル更新
app.patch('/api/recordings/:id', (req, res) => {
  const meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (req.body.title) rec.title = req.body.title;
  saveMeta(meta);
  res.json(rec);
});

// 録画削除
app.delete('/api/recordings/:id', (req, res) => {
  let meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  // mp4, webm, サムネイルを削除
  const baseName = rec.id;
  for (const ext of ['.mp4', '.webm', '_thumb.jpg']) {
    const p = path.join(RECORDINGS_DIR, baseName + ext);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  meta = meta.filter(r => r.id !== req.params.id);
  saveMeta(meta);
  res.json({ success: true });
});

// 動画ファイル配信（Range対応）
app.get('/api/recordings/:id/video', (req, res) => {
  const meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  // mp4があればmp4優先、なければwebm
  let filePath = path.join(RECORDINGS_DIR, rec.filename);
  let contentType = rec.filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm';

  const mp4Path = path.join(RECORDINGS_DIR, rec.id + '.mp4');
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
  const meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  const thumbPath = path.join(RECORDINGS_DIR, `${rec.id}_thumb.jpg`);

  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  const mp4Path = path.join(RECORDINGS_DIR, rec.id + '.mp4');
  const webmPath = path.join(RECORDINGS_DIR, rec.id + '.webm');
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
  const meta = loadMeta();
  const rec = meta.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  // mp4優先
  const mp4Path = path.join(RECORDINGS_DIR, rec.id + '.mp4');
  const webmPath = path.join(RECORDINGS_DIR, rec.id + '.webm');

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

// 直接実行時は自動起動（node server.js）
const isDirectRun = process.argv[1] && process.argv[1].endsWith('server.js');
if (isDirectRun) {
  startServer();
}

export { startServer, server, PORT };
