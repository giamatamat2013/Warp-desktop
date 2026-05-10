const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── נתיבי נתונים ──────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const GAMES_CACHE_DIR = path.join(USER_DATA, 'games_cache');
const GAMES_DB_PATH   = path.join(USER_DATA, 'games.json');
const SAVED_GAMES_PATH = path.join(USER_DATA, 'saved_games.json');
const SETTINGS_PATH   = path.join(USER_DATA, 'settings.json');

[GAMES_CACHE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Firebase Realtime Database URL ────────────────────────────────────────────
const FIREBASE_RTDB_URL = 'https://warp-games-default-rtdb.europe-west1.firebasedatabase.app';

// ── הגדרות ──────────────────────────────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)); }

let mainWindow;

function createWindow() {
  const settings = loadSettings();
  mainWindow = new BrowserWindow({
    width:  settings.width  || 1280,
    height: settings.height || 820,
    minWidth: 900,
    minHeight: 600,
    title: 'WARP Desktop',
    backgroundColor: '#0a0a0f',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false,
    }
  });

  const indexPath = path.join(__dirname, 'src', 'index.html');
  console.log('Loading from:', indexPath);
  console.log('File exists:', require('fs').existsSync(indexPath));
  mainWindow.loadFile(indexPath).catch(err => console.error('loadFile error:', err));

  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('Failed to load:', code, desc, indexPath);
  });

  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    saveSettings({ ...loadSettings(), width: w, height: h });
  });

  // ── Firebase: אפשר Google Auth popup, חסום שאר חלונות ──────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https://accounts.google.com') ||
      url.startsWith('https://warp-games.firebaseapp.com/__/auth')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 650,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      };
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC: games list (Firebase Realtime Database) ──────────────────────────────
ipcMain.handle('get-games', async () => {
  // Firebase RTDB REST API: GET /games.json מחזיר אובייקט עם כל המשחקים
  const fetchFromFirebase = (timeoutMs = 20000) => new Promise((resolve, reject) => {
    const url = `${FIREBASE_RTDB_URL}/games.json`;
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        req.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const val = JSON.parse(data);
          if (!val) return reject(new Error('אין נתונים ב-Firebase תחת /games'));

          // Firebase מחזיר אובייקט של {key: game}, ממיר למערך בדיוק כמו ה-Web
          const games = Array.isArray(val)
            ? val.filter(Boolean)
            : Object.values(val);

          if (!games.length) return reject(new Error('רשימת המשחקים ריקה'));

          // שמור קאש מקומי
          fs.writeFileSync(GAMES_DB_PATH, JSON.stringify(games, null, 2));
          resolve({ games, source: 'online' });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });

  try {
    return await fetchFromFirebase();
  } catch (firstError) {
    console.warn('First Firebase fetch failed:', firstError.message);
    try {
      return await fetchFromFirebase(25000);
    } catch (secondError) {
      console.warn('Second Firebase fetch failed:', secondError.message);
      return loadCachedGames();
    }
  }
});

function loadCachedGames() {
  try {
    const games = JSON.parse(fs.readFileSync(GAMES_DB_PATH, 'utf8'));
    return { games, source: 'cache' };
  } catch {
    return { games: [], source: 'none' };
  }
}

// ── IPC: רישום פתיחת משחק ב-Firebase (game_opens) ────────────────────────────
ipcMain.handle('track-game-open', async (event, gameId) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const safeId = gameId.replace(/[.#$[\]]/g, '_');
    const url = `${FIREBASE_RTDB_URL}/game_opens/${safeId}/${today}.json`;

    // קריאה + עדכון (transaction-like עם REST)
    const currentVal = await new Promise((resolve, reject) => {
      https.get(url, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data) || 0));
      }).on('error', reject);
    });

    const newVal = (currentVal || 0) + 1;
    await new Promise((resolve, reject) => {
      const body = JSON.stringify(newVal);
      const urlParsed = new URL(url);
      const req = https.request({
        hostname: urlParsed.hostname,
        path: urlParsed.pathname,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => { res.resume(); resolve(); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return { ok: true };
  } catch (e) {
    console.warn('[WARP] track-game-open error:', e.message);
    return { ok: false };
  }
});

// ── IPC: saved games (אופליין) ────────────────────────────────────────────────
ipcMain.handle('get-saved-games', () => {
  try { return JSON.parse(fs.readFileSync(SAVED_GAMES_PATH, 'utf8')); } catch { return []; }
});

ipcMain.handle('save-game-offline', async (event, game) => {
  const saved = (() => { try { return JSON.parse(fs.readFileSync(SAVED_GAMES_PATH, 'utf8')); } catch { return []; } })();
  if (saved.find(g => g.id === game.id)) return { ok: true, msg: 'כבר שמור' };

  const cacheDir = path.join(GAMES_CACHE_DIR, game.id);
  fs.mkdirSync(cacheDir, { recursive: true });

  try {
    await downloadFile(game.url, path.join(cacheDir, 'index.html'));
    saved.push({ ...game, cachedAt: Date.now(), localPath: path.join(cacheDir, 'index.html') });
    fs.writeFileSync(SAVED_GAMES_PATH, JSON.stringify(saved, null, 2));
    return { ok: true, msg: 'נשמר!' };
  } catch (e) {
    saved.push({ ...game, cachedAt: Date.now(), localPath: null });
    fs.writeFileSync(SAVED_GAMES_PATH, JSON.stringify(saved, null, 2));
    return { ok: true, msg: 'נוסף לרשימה (המשחק דורש אינטרנט להפעלה)' };
  }
});

ipcMain.handle('remove-saved-game', (event, gameId) => {
  let saved = (() => { try { return JSON.parse(fs.readFileSync(SAVED_GAMES_PATH, 'utf8')); } catch { return []; } })();
  saved = saved.filter(g => g.id !== gameId);
  fs.writeFileSync(SAVED_GAMES_PATH, JSON.stringify(saved, null, 2));
  const cacheDir = path.join(GAMES_CACHE_DIR, gameId);
  if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  return { ok: true };
});

// ── IPC: window controls ──────────────────────────────────────────────────────
// BrowserWindow.fromWebContents(event.sender) מחזיר את החלון הנכון —
// כך חלון משחק סוגר את עצמו ולא את החלון הראשי.
ipcMain.handle('window-minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle('is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);

// ── IPC: open game ────────────────────────────────────────────────────────────
ipcMain.handle('open-game-window', (event, game) => {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 800, minHeight: 600,
    title: game.name,
    backgroundColor: '#000',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-game.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,      // לא צריך webview יותר
      webSecurity: false,     // מבטל חסימת X-Frame-Options ב-iframe
    }
  });

  // ── מחק headers שחוסמים embedding (X-Frame-Options, CSP) ──────────────────
  win.webContents.session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    // מחק headers שמונעים טעינה ב-iframe
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['x-content-type-options'];
    callback({ responseHeaders: headers });
  });

  win.loadFile(path.join(__dirname, 'src', 'game-window.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('load-game', game);
  });
  return true;
});

// ── IPC: פתח URL בדפדפן חיצוני ───────────────────────────────────────────────
ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

// ── Helper: download file ─────────────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', e => { fs.unlink(dest, () => {}); reject(e); });
  });
}