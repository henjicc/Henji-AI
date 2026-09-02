import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  HenjiAudioApi,
  HenjiAssistantApi,
  HenjiAssetLibraryApi,
  HenjiDiagnosticsApi,
  HenjiDiagnosticsStreamEvent,
  HenjiAiApi,
  HenjiCameraStageProjectsApi,
  HenjiCameraStageRenderApi,
  HenjiCameraStageRenderEvent,
  HenjiCameraStageRenderRequest,
  HenjiCanvasProjectsApi,
  HenjiProjectCoversApi,
  HenjiClipboardApi,
  HenjiCustomModelsApi,
  HenjiDbApi,
  HenjiDialogApi,
  HenjiDragApi,
  HenjiFsApi,
  HenjiHttpApi,
  HenjiLlmApi,
  HenjiLlmStreamEventPayload,
  HenjiModelStepEventPayload,
  HenjiLoggingApi,
  HenjiLogEvent,
  HenjiMediaApi,
  HenjiIpcErrorEnvelope,
  HenjiNativeApi,
  HenjiNativeFetchRequest,
  HenjiPathsApi,
  HenjiProjectPackageApi,
  HenjiShellApi,
  HenjiStoryboardProjectsApi,
  HenjiUpdaterApi,
  HenjiUpdaterEvent,
  HenjiWindowApi,
  HenjiWindowStatePayload,
} from './api'
import type {
  FrontendToolCancel,
  FrontendToolRequest,
} from '../../src/core/assistant/hostContracts'
import {
  agentRuntimeEventPayloadSchema,
  type AgentRuntimeEventPayload,
} from '../../src/core/assistant/runtimeContracts'
import { createImageVideoApis } from './image-video-api'
import { createImageEditorV3Api } from './image-editor-v3-api'

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
  getContentSize: () => nativeInvoke('window:getContentSize'),
  setZoomFactor: (factor) => nativeInvoke('window:setZoomFactor', { factor }),
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
  onCloseRequested: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on('window:closeRequested', listener)
    return () => ipcRenderer.removeListener('window:closeRequested', listener)
  },
  confirmClose: () => nativeInvoke('window:confirmClose'),
}

const assistantApi: HenjiAssistantApi = {
  getUserInstructions: () => nativeInvoke('assistant:userInstructions:get'),
  updateUserInstructions: (update) => nativeInvoke('assistant:userInstructions:update', update),
  resetUserInstructions: () => nativeInvoke('assistant:userInstructions:reset'),
  openUserInstructionsFile: () => nativeInvoke('assistant:userInstructions:openFile'),
  listSkills: () => nativeInvoke('assistant:skills:list'),
  readSkill: (request) => nativeInvoke('assistant:skills:read', request),
  installSkill: (request) => nativeInvoke('assistant:skills:install', request),
  uninstallSkill: (name) => nativeInvoke('assistant:skills:uninstall', { name }),
  setSkillEnabled: (update) => nativeInvoke('assistant:skills:setEnabled', update),
  openSkillsDirectory: () => nativeInvoke('assistant:skills:openDir'),
  getMemoryState: () => nativeInvoke('assistant:memory:getState'),
  updateMemorySettings: (update) => nativeInvoke('assistant:memory:updateSettings', update),
  updateMemory: (update) => nativeInvoke('assistant:memory:update', update),
  confirmMemoryCandidate: (candidateId) => nativeInvoke('assistant:memory:confirmCandidate', { candidateId }),
  rejectMemoryCandidate: (candidateId) => nativeInvoke('assistant:memory:rejectCandidate', { candidateId }),
  deleteMemory: (memoryId) => nativeInvoke('assistant:memory:delete', { memoryId }),
  clearMemories: (scope) => nativeInvoke('assistant:memory:clear', { scope }),
  publishHostContext: (snapshot) => nativeInvoke('assistant:publishHostContext', snapshot),
  acknowledgeFrontendTool: (acknowledgement) => nativeInvoke('assistant:frontendTool:ack', acknowledgement),
  completeFrontendTool: (result) => nativeInvoke('assistant:frontendTool:result', result),
  onFrontendToolRequest: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, request: FrontendToolRequest): void => handler(request)
    ipcRenderer.on('assistant:frontendTool:request', listener)
    return () => ipcRenderer.removeListener('assistant:frontendTool:request', listener)
  },
  onFrontendToolCancel: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, cancel: FrontendToolCancel): void => handler(cancel)
    ipcRenderer.on('assistant:frontendTool:cancel', listener)
    return () => ipcRenderer.removeListener('assistant:frontendTool:cancel', listener)
  },
  startRun: (request) => nativeInvoke('assistant:agent:startRun', request),
  cancelRun: (request) => nativeInvoke('assistant:agent:cancelRun', request),
  pauseRun: (request) => nativeInvoke('assistant:agent:pauseRun', request),
  resumeRun: (request) => nativeInvoke('assistant:agent:resumeRun', request),
  respondApproval: (request) => nativeInvoke('assistant:agent:respondApproval', request),
  getRunState: (request) => nativeInvoke('assistant:agent:getRunState', request),
  getRunSnapshot: (request) => nativeInvoke('assistant:agent:getRunSnapshot', request),
  getRunEvents: (request) => nativeInvoke('assistant:agent:getRunEvents', request),
  listRuns: (request) => nativeInvoke('assistant:agent:listRuns', request),
  listThreads: (request) => nativeInvoke('assistant:agent:listThreads', request),
  deleteThreads: (request) => nativeInvoke('assistant:agent:deleteThreads', request),
  getTranscript: (request) => nativeInvoke('assistant:agent:getTranscript', request),
  enqueueMessage: (request) => nativeInvoke('assistant:agent:enqueueMessage', request),
  cancelQueuedMessage: (request) => nativeInvoke('assistant:agent:cancelQueuedMessage', request),
  reportGenerationStatus: (request) => nativeInvoke('assistant:agent:reportGenerationStatus', request),
  cancelExternalWait: (request) => nativeInvoke('assistant:agent:cancelExternalWait', request),
  retryRun: (request) => nativeInvoke('assistant:agent:retryRun', request),
  subscribeEvents: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, rawPayload: unknown): void => {
      const payload: AgentRuntimeEventPayload = agentRuntimeEventPayloadSchema.parse(rawPayload)
      handler(payload)
    }
    ipcRenderer.on('assistant:agent:event', listener)
    return () => ipcRenderer.removeListener('assistant:agent:event', listener)
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

const projectCoversApi: HenjiProjectCoversApi = {
  saveCover: (request) => nativeInvoke('projectCovers:save', request),
}

const customModelsApi: HenjiCustomModelsApi = {
  insertModel: (model) => nativeInvoke('customModels:insert', model),
  listModels: (providerId) => nativeInvoke('customModels:list', { providerId }),
  getModel: (modelId) => nativeInvoke('customModels:get', { modelId }),
  updateModel: (modelId, updates) => nativeInvoke('customModels:update', { modelId, updates }),
  deleteModel: (modelId) => nativeInvoke('customModels:delete', { modelId }),
}

const aiApi: HenjiAiApi = {
  setProviderApiKey: (providerId, apiKey) => nativeInvoke('ai:setProviderApiKey', { providerId, apiKey }),
  removeProviderApiKey: (providerId) => nativeInvoke('ai:removeProviderApiKey', { providerId }),
  getProviderApiKey: (providerId) => nativeInvoke('ai:getProviderApiKey', { providerId }),
  getProviderKeyStatus: () => nativeInvoke('ai:getRuntimeProviderKeyStatus'),
  testProviderConnection: (providerId) => nativeInvoke('ai:testProviderConnection', { providerId }),
  generate: (request) => nativeInvoke('ai:generate', request),
  continuePolling: (request) => nativeInvoke('ai:continuePolling', request),
  cancelTask: (taskId) => nativeInvoke('ai:cancelTask', { taskId }),
  getProgressEstimate: (request) => nativeInvoke('ai:getProgressEstimate', request),
  recordProgressSample: (request) => nativeInvoke('ai:recordProgressSample', request),
  consumePendingResult: (serverTaskId) => nativeInvoke('ai:consumePendingResult', { serverTaskId }),
}

const llmApi: HenjiLlmApi = {
  getProviderApiKey: (credentialId) => nativeInvoke('llm:getProviderApiKey', { credentialId }),
  getProviderKeyStatus: (credentialIds) => nativeInvoke('llm:getProviderKeyStatus', { credentialIds }),
  readConfig: () => nativeInvoke('llm:providerSettings:readConfig'),
  writeConfig: config => nativeInvoke('llm:providerSettings:writeConfig', { config }),
  commitProviderSettings: request => nativeInvoke('llm:providerSettings:commit', request),
  deleteProviderSettings: request => nativeInvoke('llm:providerSettings:delete', request),
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
  async modelStep(input, onEvent) {
    const streamId = createStreamId()
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiModelStepEventPayload): void => {
      if (payload.streamId === streamId) onEvent(payload.event)
    }
    ipcRenderer.on('llm:modelStep:event', listener)
    try {
      return await nativeInvoke('llm:modelStep', { streamId, input })
    } finally {
      ipcRenderer.removeListener('llm:modelStep:event', listener)
    }
  },
  verifyModelCapabilities: request => nativeInvoke('llm:verifyModelCapabilities', request),
  cancelTask: (taskId) => nativeInvoke('llm:cancelTask', { taskId }),
  discoverModels: provider => nativeInvoke('llm:discoverModels', provider),
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
  writeFile: (path, data, options) => nativeInvoke('fs:writeFile', { path, data, exclusive: options?.exclusive }),
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
  importFromPath: (request) => nativeInvoke('media:importFromPath', request),
  importFromBytes: (request) => nativeInvoke('media:importFromBytes', request),
  captureApplicationSurface: (request) => nativeInvoke('media:captureApplicationSurface', request),
}

const clipboardApi: HenjiClipboardApi = {
  readClipboardFiles: () => nativeInvoke('clipboard:readFiles'),
  readText: () => nativeInvoke('clipboard:readText'),
  readImage: () => nativeInvoke('clipboard:readImage'),
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

const { imageApi, videoApi } = createImageVideoApis(nativeInvoke)
const imageEditorV3Api = createImageEditorV3Api(
  nativeInvoke,
  (channel, message, transfer) => ipcRenderer.postMessage(
    channel,
    message,
    transfer as Parameters<typeof ipcRenderer.postMessage>[2],
  ),
)

const assetLibraryApi: HenjiAssetLibraryApi = {
  createAsset: (input) => nativeInvoke('assetLibrary:createAsset', input),
  updateAsset: (id, name) => nativeInvoke('assetLibrary:updateAsset', { id, name }),
  deleteAsset: (id) => nativeInvoke('assetLibrary:deleteAsset', { id }),
  queryAssets: (input) => nativeInvoke('assetLibrary:queryAssets', input),
  touchAsset: (id) => nativeInvoke('assetLibrary:touchAsset', { id }),
  checkPaths: (filePaths) => nativeInvoke('assetLibrary:checkPaths', { filePaths }),
  inspectAsset: (id) => nativeInvoke('assetLibrary:inspectAsset', { id }),
  inspectAssets: (ids) => nativeInvoke('assetLibrary:inspectAssets', { ids }),
  relocateAsset: (id, filePath) => nativeInvoke('assetLibrary:relocateAsset', { id, filePath }),
  listLibraries: () => nativeInvoke('assetLibrary:listLibraries'),
  inspectLibrary: (id) => nativeInvoke('assetLibrary:inspectLibrary', { id }),
  createLibrary: (name) => nativeInvoke('assetLibrary:createLibrary', { name }),
  renameLibrary: (id, name) => nativeInvoke('assetLibrary:renameLibrary', { id, name }),
  deleteLibrary: (id) => nativeInvoke('assetLibrary:deleteLibrary', { id }),
  restoreLibrary: (snapshot) => nativeInvoke('assetLibrary:restoreLibrary', snapshot),
  addToLibrary: (libraryId, assetId) => nativeInvoke('assetLibrary:addToLibrary', { libraryId, assetId }),
  removeFromLibrary: (libraryId, assetId) => nativeInvoke('assetLibrary:removeFromLibrary', { libraryId, assetId }),
  listTags: () => nativeInvoke('assetLibrary:listTags'),
  setAssetTags: (assetId, tags) => nativeInvoke('assetLibrary:setAssetTags', { assetId, tags }),
  rebaseDataRoot: (oldRoot, newRoot) => nativeInvoke('assetLibrary:rebaseDataRoot', { oldRoot, newRoot }),
}

const cameraStageRenderApi: HenjiCameraStageRenderApi = {
  start: (request) => nativeInvoke('cameraStageRender:start', request),
  cancel: (requestId) => nativeInvoke('cameraStageRender:cancel', { requestId }),
  onEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiCameraStageRenderEvent): void => {
      handler(payload)
    }
    ipcRenderer.on('cameraStageRender:event', listener)
    return () => ipcRenderer.removeListener('cameraStageRender:event', listener)
  },
  workerReady: () => nativeInvoke('cameraStageRender:workerReady'),
  onWorkerJob: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiCameraStageRenderRequest): void => {
      handler(payload)
    }
    ipcRenderer.on('cameraStageRender:workerJob', listener)
    return () => ipcRenderer.removeListener('cameraStageRender:workerJob', listener)
  },
  onWorkerCancel: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string): void => {
      handler(requestId)
    }
    ipcRenderer.on('cameraStageRender:workerCancel', listener)
    return () => ipcRenderer.removeListener('cameraStageRender:workerCancel', listener)
  },
  reportWorkerEvent: (event) => nativeInvoke('cameraStageRender:workerEvent', event),
}

const audioApi: HenjiAudioApi = {
  extractSamples: (payload) => nativeInvoke('audio:extractSamples', payload),
}

const loggingApi: HenjiLoggingApi = {
  logFrontendEvents: (events) => nativeInvoke('logging:frontendEvents', { events }),
  onLogEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, events: HenjiLogEvent[]): void => {
      handler(events)
    }
    ipcRenderer.on('henji://log-event', listener)
    return () => {
      ipcRenderer.removeListener('henji://log-event', listener)
    }
  },
  setCaptureConfig: (mode) => nativeInvoke('logging:setCaptureConfig', { mode }),
  getCaptureConfig: () => nativeInvoke('logging:getCaptureConfig'),
  openLogWindow: () => nativeInvoke('logging:openWindow'),
  listLogDates: () => nativeInvoke('logging:listDates'),
  queryLogEvents: (params) => nativeInvoke('logging:query', params),
  exportDiagnosticBundle: (request) => nativeInvoke('logging:exportDiagnosticBundle', request),
  getAgentTraceCaptureMode: () => nativeInvoke('logging:agentTrace:getCaptureMode'),
  setAgentTraceCaptureMode: (mode) => nativeInvoke('logging:agentTrace:setCaptureMode', { mode }),
  queryAgentTraces: (params) => nativeInvoke('logging:agentTrace:query', params),
  getAgentTraceDetail: (traceId) => nativeInvoke('logging:agentTrace:getDetail', { traceId }),
  clearAgentTraces: (date) => nativeInvoke('logging:agentTrace:clear', { date }),
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
  runtimeInfo: {
    uiInspectionReadOnly: process.env['HENJI_UI_INSPECTION_READ_ONLY'] === '1',
    featureFlags: {
      imageEditorV3: process.env['HENJI_IMAGE_EDITOR_V3'] !== '0',
    },
  },
  assistant: assistantApi,
  ai: aiApi,
  llm: llmApi,
  db: dbApi,
  canvasProjects: canvasProjectsApi,
  storyboardProjects: storyboardProjectsApi,
  cameraStageProjects: cameraStageProjectsApi,
  projectCovers: projectCoversApi,
  cameraStageRender: cameraStageRenderApi,
  customModels: customModelsApi,
  fs: fsApi,
  dialog: dialogApi,
  shell: shellApi,
  paths: pathsApi,
  http: httpApi,
  media: mediaApi,
  image: imageApi,
  imageEditorV3: imageEditorV3Api,
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
  assetLibrary: assetLibraryApi,
}

contextBridge.exposeInMainWorld('henjiNative', api)
