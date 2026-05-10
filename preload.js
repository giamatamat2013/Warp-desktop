const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warp', {
  getGames:          ()       => ipcRenderer.invoke('get-games'),
  getSavedGames:     ()       => ipcRenderer.invoke('get-saved-games'),
  saveGameOffline:   (game)   => ipcRenderer.invoke('save-game-offline', game),
  removeSavedGame:   (id)     => ipcRenderer.invoke('remove-saved-game', id),
  openGame:          (game)   => ipcRenderer.invoke('open-game-window', game),
  trackGameOpen:     (gameId) => ipcRenderer.invoke('track-game-open', gameId),
  windowMinimize:    ()       => ipcRenderer.invoke('window-minimize'),
  windowMaximize:    ()       => ipcRenderer.invoke('window-maximize'),
  windowClose:       ()       => ipcRenderer.invoke('window-close'),
  isMaximized:       ()       => ipcRenderer.invoke('is-maximized'),
});