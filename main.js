const { app, BrowserWindow, ipcMain, session, dialog, Menu, Tray, nativeImage } = require('electron');
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

  // Allow webviews to open games in new window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC: games list ───────────────────────────────────────────────────────────
ipcMain.handle('get-games', async () => {
  // נסה לטעון מהאינטרנט תחילה, אם נכשל – השתמש בקאש
  const fetchGames = (timeoutMs = 20000) => new Promise((resolve, reject) => {
    const req = https.get('https://giamatamat2013.github.io/Warp/games.json', res => {
      if (res.statusCode !== 200) {
        req.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const games = JSON.parse(data);
          fs.writeFileSync(GAMES_DB_PATH, data); // עדכן קאש
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
    return await fetchGames();
  } catch (firstError) {
    console.warn('First games fetch failed:', firstError.message);
    try {
      return await fetchGames(25000);
    } catch (secondError) {
      console.warn('Second games fetch failed:', secondError.message);
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

// ── IPC: saved games (אופליין) ────────────────────────────────────────────────
ipcMain.handle('get-saved-games', () => {
  try { return JSON.parse(fs.readFileSync(SAVED_GAMES_PATH, 'utf8')); } catch { return []; }
});

ipcMain.handle('save-game-offline', async (event, game) => {
  const saved = (() => { try { return JSON.parse(fs.readFileSync(SAVED_GAMES_PATH, 'utf8')); } catch { return []; } })();
  if (saved.find(g => g.id === game.id)) return { ok: true, msg: 'כבר שמור' };

  // הורד את העמוד הראשי של המשחק (HTML)
  const cacheDir = path.join(GAMES_CACHE_DIR, game.id);
  fs.mkdirSync(cacheDir, { recursive: true });

  try {
    await downloadFile(game.url, path.join(cacheDir, 'index.html'));
    saved.push({ ...game, cachedAt: Date.now(), localPath: path.join(cacheDir, 'index.html') });
    fs.writeFileSync(SAVED_GAMES_PATH, JSON.stringify(saved, null, 2));
    return { ok: true, msg: 'נשמר!' };
  } catch (e) {
    // שמור גם אם ה-HTML לא הורד (משחקים שמשתמשים ב-iframe חיצוני)
    saved.push({ ...game, cachedAt: Date.now(), localPath: null });
    fs.writeFileSync(SAVED_GAMES_PATH, JSON.stringify(saved, null, 2));
    return { ok: true, msg: 'נוסף לרשימה (המשחק דורש אינטרנט להפעלה)' };
  }
});

ipcMain.handle('remove-saved-game', (event, gameId) => {
  let saved = (() => { try { return JSON.parse(fs.readFileSync(SAVED_GAMES_PATH, 'utf8')); } catch { return []; } })();
  saved = saved.filter(g => g.id !== gameId);
  fs.writeFileSync(SAVED_GAMES_PATH, JSON.stringify(saved, null, 2));
  // מחק קאש
  const cacheDir = path.join(GAMES_CACHE_DIR, gameId);
  if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  return { ok: true };
});

// ── IPC: window controls ──────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.handle('window-close',    () => mainWindow.close());
ipcMain.handle('is-maximized',    () => mainWindow.isMaximized());

// ── IPC: open game ────────────────────────────────────────────────────────────
ipcMain.handle('open-game-window', (event, game) => {
  const win = new BrowserWindow({
    width: 1100, height: 750,
    title: game.name,
    backgroundColor: '#000',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-game.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'game-window.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('load-game', game);
  });
  return true;
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