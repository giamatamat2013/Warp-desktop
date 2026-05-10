const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warp', {
  windowClose:    () => ipcRenderer.invoke('window-close'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  openExternal:   (url) => ipcRenderer.invoke('open-external', url),
  onLoadGame:     (cb) => ipcRenderer.on('load-game', (_, game) => cb(game)),
});