import { contextBridge, ipcRenderer } from 'electron'
import type {
  HenjiDiagnosticsApi,
  HenjiDiagnosticsStreamEvent,
  HenjiAiApi,
  HenjiDbApi,
  HenjiDialogApi,
  HenjiFsApi,
  HenjiHttpApi,
  HenjiKeystoreApi,
  HenjiLlmApi,
  HenjiLoggingApi,
  HenjiMediaApi,
  HenjiIpcErrorEnvelope,
  HenjiNativeApi,
  HenjiNativeFetchRequest,
  HenjiPathsApi,
  HenjiRuntimeRequestPreviewPayload,
  HenjiShellApi,
  HenjiWindowApi,
  HenjiWindowStatePayload,
} from './api'

type IpcResultEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: HenjiIpcErrorEnvelope }

async function nativeInvoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, payload) as IpcResultEnvelope<T>
  if (result.ok) {
    return result.data
  }

  const error = new Error(result.error.message)
  error.name = result.error.name
  throw error
}

const windowApi: HenjiWindowApi = {
  minimize: () => nativeInvoke('window:minimize'),
  toggleMaximize: () => nativeInvoke('window:toggleMaximize'),
  close: () => nativeInvoke('window:close'),
  isMaximized: () => nativeInvoke('window:isMaximized'),
  toggleDevTools: () => nativeInvoke('window:toggleDevTools'),
  onStateChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiWindowStatePayload): void => {
      handler(payload)
    }
    ipcRenderer.on('window:stateChanged', listener)
    return () => {
      ipcRenderer.removeListener('window:stateChanged', listener)
    }
  },
}

function createStreamId(): string {
  return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const diagnosticsApi: HenjiDiagnosticsApi = {
  ping: () => nativeInvoke('system:ping'),
  async streamEcho(message, onEvent) {
    const streamId = createStreamId()
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiDiagnosticsStreamEvent): void => {
      if (payload.streamId === streamId) {
        onEvent(payload)
      }
    }
    ipcRenderer.on('diagnostics:streamEcho:event', listener)
    await nativeInvoke('diagnostics:streamEcho', { streamId, message })
    return async () => {
      ipcRenderer.removeListener('diagnostics:streamEcho:event', listener)
      await nativeInvoke('diagnostics:cancelStream', { streamId })
    }
  },
}

const dbApi: HenjiDbApi = {
  execute: (sql, params) => nativeInvoke('db:execute', { sql, params }),
  select: (sql, params) => nativeInvoke('db:select', { sql, params }),
}

const keystoreApi: HenjiKeystoreApi = {
  setKey: (namespace, providerId, apiKey) => nativeInvoke('keystore:set', { namespace, providerId, apiKey }),
  removeKey: (namespace, providerId) => nativeInvoke('keystore:remove', { namespace, providerId }),
  getKey: (namespace, providerId) => nativeInvoke('keystore:get', { namespace, providerId }),
  hasKey: (namespace, providerId) => nativeInvoke('keystore:has', { namespace, providerId }),
}

const aiApi: HenjiAiApi = {
  setProviderApiKey: (providerId, apiKey) => nativeInvoke('ai:setProviderApiKey', { providerId, apiKey }),
  removeProviderApiKey: (providerId) => nativeInvoke('ai:removeProviderApiKey', { providerId }),
  getProviderApiKey: (providerId) => nativeInvoke('ai:getProviderApiKey', { providerId }),
  getProviderKeyStatus: () => nativeInvoke('ai:getRuntimeProviderKeyStatus'),
  generate: (request) => nativeInvoke('ai:generate', request),
  continuePolling: (request) => nativeInvoke('ai:continuePolling', request),
  cancelTask: (taskId) => nativeInvoke('ai:cancelTask', { taskId }),
  reloadModelManifest: () => nativeInvoke('ai:reloadModelManifest'),
  getProgressEstimate: (request) => nativeInvoke('ai:getProgressEstimate', request),
  recordProgressSample: (request) => nativeInvoke('ai:recordProgressSample', request),
}

const llmApi: HenjiLlmApi = {
  setProviderApiKey: (providerId, apiKey) => nativeInvoke('llm:setProviderApiKey', { providerId, apiKey }),
  removeProviderApiKey: (providerId) => nativeInvoke('llm:removeProviderApiKey', { providerId }),
  getProviderApiKey: (providerId) => nativeInvoke('llm:getProviderApiKey', { providerId }),
  getProviderKeyStatus: (providerIds) => nativeInvoke('llm:getProviderKeyStatus', { providerIds }),
}

const fsApi: HenjiFsApi = {
  readFile: (path) => nativeInvoke('fs:readFile', { path }),
  readTextFile: (path) => nativeInvoke('fs:readTextFile', { path }),
  writeFile: (path, data) => nativeInvoke('fs:writeFile', { path, data }),
  writeTextFile: (path, data) => nativeInvoke('fs:writeTextFile', { path, data }),
  exists: (path) => nativeInvoke('fs:exists', { path }),
  mkdir: (path, options) => nativeInvoke('fs:mkdir', { path, recursive: options?.recursive }),
  readDir: (path) => nativeInvoke('fs:readDir', { path }),
  copyFile: (src, dest) => nativeInvoke('fs:copyFile', { src, dest }),
  remove: (path, options) => nativeInvoke('fs:remove', { path, recursive: options?.recursive }),
}

const dialogApi: HenjiDialogApi = {
  save: (options) => nativeInvoke('dialog:save', options),
  open: (options) => nativeInvoke('dialog:open', options),
}

const shellApi: HenjiShellApi = {
  openExternal: (url) => nativeInvoke('shell:openExternal', { url }),
}

const pathsApi: HenjiPathsApi = {
  appLocalDataDir: () => nativeInvoke('paths:appLocalDataDir'),
  downloadDir: () => nativeInvoke('paths:downloadDir'),
  join: (...parts) => nativeInvoke('paths:join', { parts }),
  dirname: (path) => nativeInvoke('paths:dirname', { path }),
  tempDir: () => nativeInvoke('paths:tempDir'),
}

const httpApi: HenjiHttpApi = {
  async fetch(request: HenjiNativeFetchRequest) {
    return await nativeInvoke('http:fetch', request)
  },
}

const mediaApi: HenjiMediaApi = {
  allowRoot: (rootPath) => nativeInvoke('media:allowRoot', { rootPath }),
}

const loggingApi: HenjiLoggingApi = {
  logFrontendEvents: (events) => nativeInvoke('logging:frontendEvents', { events }),
  onRuntimeRequestPreview: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiRuntimeRequestPreviewPayload): void => {
      handler(payload)
    }
    ipcRenderer.on('henji://runtime-request-preview', listener)
    return () => {
      ipcRenderer.removeListener('henji://runtime-request-preview', listener)
    }
  },
  onLlmRuntimeRequestPreview: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiRuntimeRequestPreviewPayload): void => {
      handler(payload)
    }
    ipcRenderer.on('henji://llm-runtime-request-preview', listener)
    return () => {
      ipcRenderer.removeListener('henji://llm-runtime-request-preview', listener)
    }
  },
}

const api: HenjiNativeApi = {
  ai: aiApi,
  llm: llmApi,
  db: dbApi,
  keystore: keystoreApi,
  fs: fsApi,
  dialog: dialogApi,
  shell: shellApi,
  paths: pathsApi,
  http: httpApi,
  media: mediaApi,
  clipboard: {},
  drag: {},
  projectPackage: {},
  logging: loggingApi,
  modelscope: {},
  window: windowApi,
  diagnostics: diagnosticsApi,
}

contextBridge.exposeInMainWorld('henjiNative', api)
