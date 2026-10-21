'use strict';
// Shell desktop da MinhaIA: reusa a mesma API/UI (um único motor), sem duplicar regra de negócio.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { start } = require('../src/server');
const { paths } = require('../src/config');

const APP_ID = 'com.minhaia.desktop';
let handle = null;
let win = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(boot).catch(fail);
}

async function boot() {
  app.setAppUserModelId(APP_ID);
  handle = await start({ port: 0 });
  const origin = `http://${handle.host}:${handle.port}`;

  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    title: 'MinhaIA',
    backgroundColor: '#0f1115',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    if (process.env.MINHAIA_DESKTOP_HIDDEN !== '1') win.show();
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('will-navigate', (event, target) => {
    let targetOrigin = '';
    try { targetOrigin = new URL(target).origin; } catch { /* URL inválida: bloqueia */ }
    if (targetOrigin !== origin) {
      event.preventDefault();
      openExternally(target);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  await win.loadURL(`${origin}/`);
}

function openExternally(url) {
  if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

function fail(err) {
  dialog.showErrorBox('MinhaIA não iniciou', err && err.stack ? err.stack : String(err));
  app.quit();
}

ipcMain.handle('desktop:choose-folder', async () => {
  if (!win) return null;
  const picked = await dialog.showOpenDialog(win, {
    title: 'Escolher a pasta do projeto',
    buttonLabel: 'Usar esta pasta',
    properties: ['openDirectory', 'createDirectory'],
  });
  return picked.canceled ? null : picked.filePaths[0];
});

ipcMain.handle('desktop:minimize-window', () => { if (win) win.minimize(); });
ipcMain.handle('desktop:toggle-maximize-window', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('desktop:close-window', () => { if (win) win.close(); });

// Abre a pasta de segredos no gerenciador de arquivos (a pasta é criada se não existir).
// Nenhum valor de chave cruza a ponte: só o caminho da pasta.
ipcMain.handle('desktop:open-secrets', async () => {
  try {
    fs.mkdirSync(paths.SECRETS_DIR, { recursive: true });
    const err = await shell.openPath(paths.SECRETS_DIR);
    return { ok: !err, error: err || null, dir: paths.SECRETS_DIR };
  } catch (e) {
    return { ok: false, error: e.message, dir: paths.SECRETS_DIR };
  }
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (quitting || !handle) return;
  quitting = true;
  event.preventDefault();
  Promise.resolve(handle.shutdown()).catch(() => {}).finally(() => app.quit());
});
