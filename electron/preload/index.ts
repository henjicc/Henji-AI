import { contextBridge, ipcRenderer } from 'electron'
import type {
  HenjiDiagnosticsApi,
  HenjiDiagnosticsStreamEvent,
  HenjiAiApi,
  HenjiDbApi,
  HenjiKeystoreApi,
  HenjiLlmApi,
  HenjiIpcErrorEnvelope,
  HenjiNativeApi,
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
  getProviderKeyStatus: () => nativeInvoke('ai:getProviderKeyStatus'),
}

const llmApi: HenjiLlmApi = {
  setProviderApiKey: (providerId, apiKey) => nativeInvoke('llm:setProviderApiKey', { providerId, apiKey }),
  removeProviderApiKey: (providerId) => nativeInvoke('llm:removeProviderApiKey', { providerId }),
  getProviderApiKey: (providerId) => nativeInvoke('llm:getProviderApiKey', { providerId }),
  getProviderKeyStatus: (providerIds) => nativeInvoke('llm:getProviderKeyStatus', { providerIds }),
}

const api: HenjiNativeApi = {
  ai: aiApi,
  llm: llmApi,
  db: dbApi,
  keystore: keystoreApi,
  fs: {},
  dialog: {},
  media: {},
  clipboard: {},
  drag: {},
  projectPackage: {},
  logging: {},
  modelscope: {},
  window: windowApi,
  diagnostics: diagnosticsApi,
}

contextBridge.exposeInMainWorld('henjiNative', api)
