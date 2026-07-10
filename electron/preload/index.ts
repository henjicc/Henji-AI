import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  HenjiAudioApi,
  HenjiDiagnosticsApi,
  HenjiDiagnosticsStreamEvent,
  HenjiAiApi,
  HenjiCameraStageProjectsApi,
  HenjiCanvasProjectsApi,
  HenjiClipboardApi,
  HenjiCustomModelsApi,
  HenjiDbApi,
  HenjiDialogApi,
  HenjiDragApi,
  HenjiFsApi,
  HenjiHttpApi,
  HenjiImageApi,
  HenjiKeystoreApi,
  HenjiLlmApi,
  HenjiLlmStreamEventPayload,
  HenjiLoggingApi,
  HenjiLogEvent,
  HenjiMediaApi,
  HenjiIpcErrorEnvelope,
  HenjiNativeApi,
  HenjiNativeFetchRequest,
  HenjiPathsApi,
  HenjiProjectPackageApi,
  HenjiRuntimeRequestPreviewPayload,
  HenjiShellApi,
  HenjiStoryboardProjectsApi,
  HenjiUpdaterApi,
  HenjiUpdaterEvent,
  HenjiVideoApi,
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

const canvasProjectsApi: HenjiCanvasProjectsApi = {
  listProjects: () => nativeInvoke('canvasProjects:list'),
  createProject: (id, name, snapshot) => nativeInvoke('canvasProjects:create', { id, name, snapshot }),
  getProject: (projectId) => nativeInvoke('canvasProjects:get', { projectId }),
  renameProject: (projectId, name) => nativeInvoke('canvasProjects:rename', { projectId, name }),
  saveProjectSnapshot: (projectId, snapshot) => nativeInvoke('canvasProjects:saveSnapshot', { projectId, snapshot }),
  deleteProject: (projectId) => nativeInvoke('canvasProjects:delete', { projectId }),
}

const storyboardProjectsApi: HenjiStoryboardProjectsApi = {
  listProjectSummaries: () => nativeInvoke('storyboardProjects:list'),
  getProjectRecord: (projectId) => nativeInvoke('storyboardProjects:get', { projectId }),
  upsertProjectRecord: (record) => nativeInvoke('storyboardProjects:upsert', record),
  updateProjectViewportRecord: (projectId, viewportJson) =>
    nativeInvoke('storyboardProjects:updateViewport', { projectId, viewportJson }),
  renameProjectRecord: (projectId, name, updatedAt) =>
    nativeInvoke('storyboardProjects:rename', { projectId, name, updatedAt }),
  deleteProjectRecord: (projectId) => nativeInvoke('storyboardProjects:delete', { projectId }),
}

const cameraStageProjectsApi: HenjiCameraStageProjectsApi = {
  listProjectSummaries: () => nativeInvoke('cameraStageProjects:list'),
  getProjectRecord: (projectId) => nativeInvoke('cameraStageProjects:get', { projectId }),
  upsertProjectRecord: (record) => nativeInvoke('cameraStageProjects:upsert', record),
  renameProjectRecord: (projectId, name, updatedAt) =>
    nativeInvoke('cameraStageProjects:rename', { projectId, name, updatedAt }),
  deleteProjectRecord: (projectId) => nativeInvoke('cameraStageProjects:delete', { projectId }),
}

const customModelsApi: HenjiCustomModelsApi = {
  insertModel: (model) => nativeInvoke('customModels:insert', model),
  listModels: (providerId) => nativeInvoke('customModels:list', { providerId }),
  getModel: (modelId) => nativeInvoke('customModels:get', { modelId }),
  updateModel: (modelId, updates) => nativeInvoke('customModels:update', { modelId, updates }),
  deleteModel: (modelId) => nativeInvoke('customModels:delete', { modelId }),
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
  consumePendingResult: (serverTaskId) => nativeInvoke('ai:consumePendingResult', { serverTaskId }),
}

const llmApi: HenjiLlmApi = {
  setProviderApiKey: (providerId, apiKey) => nativeInvoke('llm:setProviderApiKey', { providerId, apiKey }),
  removeProviderApiKey: (providerId) => nativeInvoke('llm:removeProviderApiKey', { providerId }),
  getProviderApiKey: (providerId) => nativeInvoke('llm:getProviderApiKey', { providerId }),
  getProviderKeyStatus: (providerIds) => nativeInvoke('llm:getProviderKeyStatus', { providerIds }),
  async chatStream(request, onEvent) {
    const streamId = createStreamId()
    let terminalReceived = false
    let resolveTerminal: () => void = () => undefined
    const terminalEvent = new Promise<void>((resolve) => {
      resolveTerminal = resolve
    })
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiLlmStreamEventPayload): void => {
      if (payload.streamId === streamId) {
        onEvent(payload.event)
        if (payload.event.type === 'Done' || payload.event.type === 'Error') {
          terminalReceived = true
          resolveTerminal()
        }
      }
    }
    ipcRenderer.on('llm:chatStream:event', listener)
    try {
      await nativeInvoke('llm:chatStream', { streamId, request })
      if (!terminalReceived) {
        await terminalEvent
      }
    } catch (error) {
      if (!terminalReceived) {
        await waitForOptionalTerminalEvent(terminalEvent)
      }
      throw error
    } finally {
      ipcRenderer.removeListener('llm:chatStream:event', listener)
    }
  },
  cancelTask: (taskId) => nativeInvoke('llm:cancelTask', { taskId }),
  discoverModels: (providerId, baseUrl) => nativeInvoke('llm:discoverModels', { providerId, baseUrl }),
}

async function waitForOptionalTerminalEvent(terminalEvent: Promise<void>): Promise<void> {
  await Promise.race([
    terminalEvent,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 250)
    }),
  ])
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
  isPathAllowed: (targetPath) => nativeInvoke('media:isPathAllowed', { targetPath }),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBundledResourcePath: (relativePath) => nativeInvoke('media:getBundledResourcePath', { relativePath }),
}

const clipboardApi: HenjiClipboardApi = {
  readClipboardFiles: () => nativeInvoke('clipboard:readFiles'),
  readText: () => nativeInvoke('clipboard:readText'),
  writeImageFromPath: (filePath) => nativeInvoke('clipboard:writeImageFromPath', { filePath }),
  writeImageFromSource: (source) => nativeInvoke('clipboard:writeImageFromSource', { source }),
}

const dragApi: HenjiDragApi = {
  startNativeFileDrag: (filePath, iconPath) => nativeInvoke('drag:startNativeFileDrag', { filePath, iconPath }),
  startNativeFileDragImmediate: (filePath, iconPath) => {
    ipcRenderer.send('drag:startNativeFileDragImmediate', { filePath, iconPath })
  },
}

const projectPackageApi: HenjiProjectPackageApi = {
  exportProjectPackage: (manifestJson, mediaFiles, targetPath) =>
    nativeInvoke('projectPackage:export', { manifestJson, mediaFiles, targetPath }),
  importProjectPackage: (zipPath) => nativeInvoke('projectPackage:import', { zipPath }),
}

const imageApi: HenjiImageApi = {
  splitImage: (imageBase64, rows, cols, lineThickness) =>
    nativeInvoke('image:splitImage', { imageBase64, rows, cols, lineThickness }),
  splitImageSource: (source, rows, cols, lineThickness) =>
    nativeInvoke('image:splitImageSource', { source, rows, cols, lineThickness }),
  prepareNodeImageSource: (source, maxPreviewDimension) =>
    nativeInvoke('image:prepareNodeImageSource', { source, maxPreviewDimension }),
  prepareNodeImageBinary: (bytes, extension, maxPreviewDimension) =>
    nativeInvoke('image:prepareNodeImageBinary', { bytes, extension, maxPreviewDimension }),
  cropImageSource: (payload) => nativeInvoke('image:cropImageSource', payload),
  mergeStoryboardImages: (payload) => nativeInvoke('image:mergeStoryboardImages', payload),
  readStoryboardImageMetadata: (source) => nativeInvoke('image:readStoryboardImageMetadata', { source }),
  embedStoryboardImageMetadata: (source, metadata) => nativeInvoke('image:embedStoryboardImageMetadata', { source, metadata }),
  loadImage: (filePath) => nativeInvoke('image:loadImage', { filePath }),
  persistImageSource: (source) => nativeInvoke('image:persistImageSource', { source }),
  persistImageBinary: (bytes, extension) => nativeInvoke('image:persistImageBinary', { bytes, extension }),
  saveImageSourceToDownloads: (source, suggestedFileName) => nativeInvoke('image:saveImageSourceToDownloads', { source, suggestedFileName }),
  saveImageSourceToPath: (source, targetPath) => nativeInvoke('image:saveImageSourceToPath', { source, targetPath }),
  saveImageSourceToDirectory: (source, targetDir, suggestedFileName) => nativeInvoke('image:saveImageSourceToDirectory', { source, targetDir, suggestedFileName }),
  saveImageSourceToAppDebugDir: (source, category, suggestedFileName) => nativeInvoke('image:saveImageSourceToAppDebugDir', { source, category, suggestedFileName }),
  readImageInfo: (source) => nativeInvoke('image:readImageInfo', { source }),
  compressImageSource: (payload) => nativeInvoke('image:compressImageSource', payload),
  generateThumbnailBytes: (payload) => nativeInvoke('image:generateThumbnailBytes', payload),
}

const videoApi: HenjiVideoApi = {
  readVideoInfo: (source) => nativeInvoke('video:readVideoInfo', { source }),
  trimVideoSource: (payload) => nativeInvoke('video:trimVideoSource', payload),
  compressVideoToFit: (payload) => nativeInvoke('video:compressVideoToFit', payload),
  generateThumbnail: (payload) => nativeInvoke('video:generateThumbnail', payload),
  generateThumbnailBytes: (payload) => nativeInvoke('video:generateThumbnailBytes', payload),
  startFrameExport: (payload) => nativeInvoke('video:startFrameExport', payload),
  appendFrameExport: (payload) => nativeInvoke('video:appendFrameExport', payload),
  finishFrameExport: (payload) => nativeInvoke('video:finishFrameExport', payload),
  cancelFrameExport: (sessionId) => nativeInvoke('video:cancelFrameExport', { sessionId }),
}

const audioApi: HenjiAudioApi = {
  extractSamples: (payload) => nativeInvoke('audio:extractSamples', payload),
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
  onLogEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, events: HenjiLogEvent[]): void => {
      handler(events)
    }
    ipcRenderer.on('henji://log-event', listener)
    return () => {
      ipcRenderer.removeListener('henji://log-event', listener)
    }
  },
}

const updaterApi: HenjiUpdaterApi = {
  getStatus: () => nativeInvoke('updater:getStatus'),
  checkForUpdates: () => nativeInvoke('updater:checkForUpdates'),
  downloadUpdate: () => nativeInvoke('updater:downloadUpdate'),
  quitAndInstall: () => nativeInvoke('updater:quitAndInstall'),
  onEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiUpdaterEvent): void => {
      handler(payload)
    }
    ipcRenderer.on('updater:event', listener)
    return () => {
      ipcRenderer.removeListener('updater:event', listener)
    }
  },
}

const api: HenjiNativeApi = {
  ai: aiApi,
  llm: llmApi,
  db: dbApi,
  canvasProjects: canvasProjectsApi,
  storyboardProjects: storyboardProjectsApi,
  cameraStageProjects: cameraStageProjectsApi,
  customModels: customModelsApi,
  keystore: keystoreApi,
  fs: fsApi,
  dialog: dialogApi,
  shell: shellApi,
  paths: pathsApi,
  http: httpApi,
  media: mediaApi,
  image: imageApi,
  video: videoApi,
  audio: audioApi,
  clipboard: clipboardApi,
  drag: dragApi,
  projectPackage: projectPackageApi,
  logging: loggingApi,
  updater: updaterApi,
  modelscope: {},
  window: windowApi,
  diagnostics: diagnosticsApi,
}

contextBridge.exposeInMainWorld('henjiNative', api)
