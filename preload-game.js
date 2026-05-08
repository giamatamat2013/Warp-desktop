const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warp', {
  windowClose:    () => ipcRenderer.invoke('window-close'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  onLoadGame: (cb) => ipcRenderer.on('load-game', (_, game) => cb(game)),
});
