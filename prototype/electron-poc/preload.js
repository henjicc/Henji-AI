const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('henjiNative', {
  testDb: () => ipcRenderer.invoke('henji:test-db'),
  startDrag: (fileName) => ipcRenderer.invoke('henji:start-drag', fileName),
  saveDialog: () => ipcRenderer.invoke('henji:save-dialog'),
  writeLog: (payload) => ipcRenderer.invoke('henji:write-log', payload),
})
