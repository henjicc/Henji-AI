import { app, BrowserWindow } from 'electron'
import { registerWindowIpc } from './ipc/window'
import { createWindow } from './window'

app.whenReady().then(() => {
  registerWindowIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
