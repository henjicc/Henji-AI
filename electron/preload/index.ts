import { contextBridge, ipcRenderer } from 'electron'

interface WindowStatePayload {
  isMaximized: boolean
}

interface HenjiWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  toggleDevTools(): Promise<void>
  onStateChanged(handler: (payload: WindowStatePayload) => void): () => void
}

interface HenjiNativeApi {
  window: HenjiWindowApi
}

const windowApi: HenjiWindowApi = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
  onStateChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WindowStatePayload): void => {
      handler(payload)
    }
    ipcRenderer.on('window:stateChanged', listener)
    return () => {
      ipcRenderer.removeListener('window:stateChanged', listener)
    }
  },
}

const api: HenjiNativeApi = {
  window: windowApi,
}

contextBridge.exposeInMainWorld('henjiNative', api)
