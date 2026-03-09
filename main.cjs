const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, session, desktopCapturer } = require('electron');
const path = require('path');

// ===== State =====
let mainWindow = null;
let controlWindow = null;
let tray = null;
let isRecording = false;

const PORT = 3456;

// ===== Express Server =====
async function startServer() {
  // パッケージ化時はユーザーデータ領域に録画を保存
  process.env.REC_DATA_DIR = app.getPath('userData');
  const mod = await import('./server.js');
  await mod.startServer();
}

// ===== Tray Icons (programmatic) =====
function loadTrayIcon(recording) {
  const iconName = recording ? 'tray-recording' : 'trayTemplate';
  const iconPath = path.join(__dirname, 'assets', iconName + '.png');
  return nativeImage.createFromPath(iconPath);
}

// ===== Main Window =====
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0b0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ===== Control Window =====
function createControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.show();
    controlWindow.focus();
    return;
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  controlWindow = new BrowserWindow({
    width: 280,
    height: 300,
    x: screenW - 300,
    y: screenH - 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlWindow.loadURL(`http://localhost:${PORT}/control.html`);
  controlWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 録画中はウィンドウを破棄しない（非表示のみ）
  controlWindow.on('close', (e) => {
    if (isRecording && !app.isQuitting) {
      e.preventDefault();
      controlWindow.hide();
    }
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
  });
}

function toggleControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.isVisible() ? controlWindow.hide() : controlWindow.show();
  } else {
    createControlWindow();
  }
}

// ===== Tray =====
function createTray() {
  tray = new Tray(loadTrayIcon(false));
  updateTrayMenu();
  tray.setToolTip('Rec - 画面録画');

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? '⏹ 録画停止' : '⏺ 録画開始',
      click: () => triggerToggleRecording(),
    },
    { type: 'separator' },
    {
      label: 'コントロール表示',
      click: () => toggleControlWindow(),
    },
    {
      label: 'メインウィンドウ表示',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(loadTrayIcon(isRecording));
  updateTrayMenu();
}

// ===== Toggle Recording =====
function triggerToggleRecording() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.show();
    controlWindow.webContents.send('toggle-recording');
  } else {
    createControlWindow();
    controlWindow.webContents.once('did-finish-load', () => {
      controlWindow.webContents.send('toggle-recording');
    });
  }
}

// ===== IPC Handlers =====
ipcMain.on('recording-state-changed', (_event, recording) => {
  isRecording = recording;
  updateTrayIcon();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording-state', recording);
  }

  // 録画停止したらコントロール窓を閉じる
  if (!recording && controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.close();
  }
});

ipcMain.on('recording-saved', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('refresh-recordings');
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('trigger-recording', () => {
  triggerToggleRecording();
});

ipcMain.on('show-main-window', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ===== Application Menu =====
function createAppMenu() {
  const template = [
    {
      label: 'Rec',
      submenu: [
        { label: 'Rec について', role: 'about' },
        { type: 'separator' },
        {
          label: '録画開始/停止',
          accelerator: 'CommandOrControl+Shift+R',
          click: () => triggerToggleRecording(),
        },
        {
          label: 'コントロール表示/非表示',
          accelerator: 'CommandOrControl+Shift+C',
          click: () => toggleControlWindow(),
        },
        { type: 'separator' },
        { label: 'Rec を隠す', role: 'hide' },
        { label: 'その他を隠す', role: 'hideOthers' },
        { label: 'すべて表示', role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Rec を終了',
          accelerator: 'CommandOrControl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '取り消す', role: 'undo' },
        { label: 'やり直す', role: 'redo' },
        { type: 'separator' },
        { label: 'カット', role: 'cut' },
        { label: 'コピー', role: 'copy' },
        { label: 'ペースト', role: 'paste' },
        { label: 'すべて選択', role: 'selectAll' },
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: 'ズーム', role: 'zoom' },
        { type: 'separator' },
        {
          label: 'メインウィンドウ',
          click: () => {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
          },
        },
        {
          label: 'コントロール',
          click: () => toggleControlWindow(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ===== Global Shortcuts =====
function registerGlobalShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    triggerToggleRecording();
  });
}

// ===== App Lifecycle =====
app.setName('Rec');

app.whenReady().then(async () => {
  // Screen capture permission handler
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({});
        }
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true }
  );

  // Media permissions
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'mediaKeySystem'];
    callback(allowed.includes(permission));
  });

  // 1. Start Express server
  await startServer();

  // 2. App menu
  createAppMenu();

  // 3. Create tray
  createTray();

  // 3. Create main window
  createMainWindow();

  // 4. Register global shortcuts
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Do nothing -- tray keeps app alive
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
