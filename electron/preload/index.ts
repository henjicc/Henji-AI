import { createApplicationControlApi } from './application-control-api'
import { encodeNativeErrorMessage } from '../../src/core/nativeErrors'
import type { AudioEditSpectralProgress } from '../../src/core/audioEdit/spectralPyramid'
import { createAudioLoudnessApi } from './audio-loudness-api'
import { createScreenRecordingApi } from './screen-recording-api'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createAudioCaptureApi } from './audio-capture-api'
import type {
  HenjiAudioApi,
  HenjiAssistantApi,
  HenjiAssetLibraryApi,
  HenjiDiagnosticsApi,
  HenjiDiagnosticsStreamEvent,
  HenjiAiApi,
  HenjiCameraStageRenderApi,
  HenjiCameraStageRenderWorkerJob,
  HenjiCameraStageRenderTaskSnapshot,
  HenjiClipboardApi,
  HenjiCustomModelsApi,
  HenjiTestFixturesApi,
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
  HenjiShellApi,
  HenjiUpdaterApi,
  HenjiUpdaterEvent,
  HenjiWindowApi,
  HenjiWindowStatePayload,
} from './api'


import { createImageVideoApis } from './image-video-api'
import { createImageEditorV3Api } from './image-editor-v3-api'
import { createEmbeddedAgentApi } from './embedded-agent-api'
import { createMcpApi } from './mcp-api'
import { createVideoFramesApi } from './video-frames-api'
import { createVideoDecoderApi } from './video-decoder-api'
import { createDocumentsApi } from './documents-api'
import { createCanvasTestFixturesApi } from './canvas-test-fixtures'
import { createWorkRootApi } from './work-root-api'
import { createLocalModelsApi } from './local-models-api'
import { createSoundLibraryApi } from './sound-library-api'
import { createFontsApi } from './fonts-api'
import { createSmartRegionsApi } from './smart-regions-api'
import { createTrackingApi } from './tracking-api'
import { createVideoProxyApi } from './video-proxy-api'
import { createMediaCacheApi } from './media-cache-api'
import { createSceneDetectionApi } from './scene-detection-api'
import { createWebReplayApi } from './web-replay-api'
import { createMusicAnalysisApi } from './music-analysis-api'
import { createGenerationHistoryApi, createPresetsApi, createSettingsApi } from './local-records-api'

type IpcResultEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: HenjiIpcErrorEnvelope }

async function nativeInvoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, payload) as IpcResultEnvelope<T>
  if (result.ok) {
    return result.data
  }

  // contextBridge 复制错误时丢掉 name：编进 message，平台层还原（src/core/nativeErrors.ts）
  const error = new Error(encodeNativeErrorMessage(result.error.name, result.error.message))
  error.name = result.error.name
  throw error
}

function subscribeChannel(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => { ipcRenderer.removeListener(channel, wrapped) }
}

const windowApi: HenjiWindowApi = {
  minimize: () => nativeInvoke('window:minimize'),
  toggleMaximize: () => nativeInvoke('window:toggleMaximize'),
  close: () => nativeInvoke('window:close'),
  isMaximized: () => nativeInvoke('window:isMaximized'),
  getContentSize: () => nativeInvoke('window:getContentSize'),
  getDisplayWorkArea: () => nativeInvoke('window:getDisplayWorkArea'),
  setZoomFactor: (factor) => nativeInvoke('window:setZoomFactor', { factor }),
  setAppearance: (appearance) => nativeInvoke('window:setAppearance', { windowBackground: appearance.windowBackground, colorScheme: appearance.colorScheme }),
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
  controlPopout: (request) => nativeInvoke('window:controlPopout', request),
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
  onMemoryChange: handler => { const listener = (): void => handler(); ipcRenderer.on('assistant:memory:changed', listener); return () => { ipcRenderer.removeListener('assistant:memory:changed', listener) } },
  getMemoryState: () => nativeInvoke('assistant:memory:getState'),
  updateMemorySettings: update => nativeInvoke('assistant:memory:updateSettings', update),
  readProjectMemory: projectId => nativeInvoke('assistant:memory:readProject', { projectId }),
  writeMemory: input => nativeInvoke('assistant:memory:write', input),
  recordMemoryChange: change => nativeInvoke('assistant:memory:recordChange', change),
  requestMemoryOrganization: () => nativeInvoke('assistant:memory:requestOrganization'),
  markMemoryOrganized: changes => nativeInvoke('assistant:memory:organized', { changes }),
}

function createStreamId(): string {
  return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const diagnosticsApi: HenjiDiagnosticsApi = {
  memoryInfo: () => nativeInvoke('system:memoryInfo'),
  ping: () => nativeInvoke('system:ping'),
  async streamEcho(message, onEvent) {
    const streamId = createStreamId()
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiDiagnosticsStreamEvent): void => {
      if (payload.streamId === streamId) {
        onEvent(payload)
      }
    }
    ipcRenderer.on('diagnostics:streamEcho:event', listener)
    try {
      await nativeInvoke('diagnostics:streamEcho', { streamId, message })
    } catch (error) {
      ipcRenderer.removeListener('diagnostics:streamEcho:event', listener)
      throw error
    }
    return async () => {
      ipcRenderer.removeListener('diagnostics:streamEcho:event', listener)
      await nativeInvoke('diagnostics:cancelStream', { streamId })
    }
  },
}

/**
 * 自动化 / 隔离测试模式：主进程只在此模式下注册测试夹具 IPC（见 electron/main/services/automationMode.ts），
 * 这里用同样的判断决定是否暴露 `henjiNative.testFixtures`；正常启动的渲染层没有它。
 */
const automationTestMode = process.env['HENJI_AUTOMATION'] === '1' || Boolean(process.env['HENJI_ISOLATED_APP_DATA']?.trim())

/** 测试夹具（测试专用）：经拥有该表的仓库核对或清理记录；画布读写经正式文档接口（canvas-test-fixtures.ts）。 */
const testFixturesApi: HenjiTestFixturesApi = {
  recordingControl: action => nativeInvoke('testFixtures:recordingControl', action),
  inspectGenerationSubmission: (requestId) => nativeInvoke('testFixtures:generationSubmission:inspect', { requestId }),
  deleteGenerationSubmission: (requestId) => nativeInvoke('testFixtures:generationSubmission:delete', { requestId }),
  ...createCanvasTestFixturesApi(createDocumentsApi(nativeInvoke)),
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
  listTtsVoices: (modelId) => nativeInvoke('ai:listTtsVoices', { modelId }),
  // 与转录一致，错误信封按值跨桥；不能在 preload 抛带自定义事实的 Error。
  generate: (request) => ipcRenderer.invoke('ai:generate', request),
  continuePolling: (request) => ipcRenderer.invoke('ai:continuePolling', request),
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
      const reply = await ipcRenderer.invoke('llm:chatStream', { streamId, request }) as IpcResultEnvelope<void>
      if (!reply.ok) {
        if (!terminalReceived) await waitForOptionalTerminalEvent(terminalEvent)
        return reply
      }
      if (!terminalReceived) {
        await terminalEvent
      }
      return reply
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
      return await ipcRenderer.invoke('llm:modelStep', { streamId, input })
    } finally {
      ipcRenderer.removeListener('llm:modelStep:event', listener)
    }
  },
  verifyModelCapabilities: request => ipcRenderer.invoke('llm:verifyModelCapabilities', request),
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
  readFile: (path, options) => nativeInvoke('fs:readFile', { path, ...(options ? { maxBytes: options.maxBytes } : {}) }),
  readTextFile: (path) => nativeInvoke('fs:readTextFile', { path }),
  writeFile: (path, data, options) => nativeInvoke('fs:writeFile', { path, data, exclusive: options?.exclusive, position: options?.position }),
  writeTextFile: (path, data) => nativeInvoke('fs:writeTextFile', { path, data }),
  exists: (path) => nativeInvoke('fs:exists', { path }),
  mkdir: (path, options) => nativeInvoke('fs:mkdir', { path, recursive: options?.recursive }),
  readDir: (path) => nativeInvoke('fs:readDir', { path }),
  readDirPage: (path, options) => nativeInvoke('fs:readDir', { path, ...options, paged: true }),
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
  appDirectories: (options) => nativeInvoke('paths:appDirectories', options),
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
  enqueueRecycle: (paths, protectedBy = []) => nativeInvoke('media:enqueueRecycle', { paths, protectedBy }),
  allowRoot: (rootPath) => nativeInvoke('media:allowRoot', { rootPath }),
  isPathAllowed: (targetPath) => nativeInvoke('media:isPathAllowed', { targetPath }),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBundledResourcePath: (relativePath) => nativeInvoke('media:getBundledResourcePath', { relativePath }),
  importFromPath: (request) => nativeInvoke('media:importFromPath', request),
  importFromBytes: (request) => nativeInvoke('media:importFromBytes', request),
  captureApplicationSurface: (request) => nativeInvoke('media:captureApplicationSurface', request),
}

const clipboardApi: HenjiClipboardApi = {
  writeText: (text) => nativeInvoke('clipboard:writeText', { text }),
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
  searchAppStoreIcons: input => nativeInvoke('assetLibrary:searchAppStoreIcons', input),
  saveAppStoreIcon: input => nativeInvoke('assetLibrary:saveAppStoreIcon', input),
  createAsset: (input) => nativeInvoke('assetLibrary:createAsset', input),
  updateAsset: (id, name) => nativeInvoke('assetLibrary:updateAsset', { id, name }),
  deleteAsset: (id) => nativeInvoke('assetLibrary:deleteAsset', { id }),
  queryAssets: (input) => nativeInvoke('assetLibrary:queryAssets', input),
  touchAsset: (id) => nativeInvoke('assetLibrary:touchAsset', { id }),
  checkPaths: (filePaths) => nativeInvoke('assetLibrary:checkPaths', { filePaths }),
  inspectAsset: (id) => nativeInvoke('assetLibrary:inspectAsset', { id }),
  inspectFileContent: (filePath, mediaType) => nativeInvoke('assetLibrary:inspectFileContent', { filePath, mediaType }),
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
}

const cameraStageRenderApi: HenjiCameraStageRenderApi = {
  start: (request) => nativeInvoke('cameraStageRender:start', request),
  get: (scope) => nativeInvoke('cameraStageRender:get', scope),
  list: (canvasProjectId) => nativeInvoke('cameraStageRender:list', { canvasProjectId }),
  cancel: (scope) => nativeInvoke('cameraStageRender:cancel', scope),
  acknowledge: (scope) => nativeInvoke('cameraStageRender:acknowledge', scope),
  onEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiCameraStageRenderTaskSnapshot): void => {
      handler(payload)
    }
    ipcRenderer.on('cameraStageRender:event', listener)
    return () => ipcRenderer.removeListener('cameraStageRender:event', listener)
  },
  workerReady: () => nativeInvoke('cameraStageRender:workerReady'),
  onWorkerJob: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HenjiCameraStageRenderWorkerJob): void => {
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
  recording: {
    write: input => nativeInvoke('audioEdit:explanation', input),
    read: (sessionId, chunkId) => nativeInvoke('audioEdit:explanation', { action: 'read', sessionId, chunkId }),
    erase: sessionId => nativeInvoke('audioEdit:explanation', { action: 'erase', sessionId }),
    release: sessionId => nativeInvoke('audioEdit:explanation', { action: 'release', sessionId }),
    archive: sessionId => nativeInvoke('audioEdit:explanation', { action: 'archive', sessionId }),
    restore: input => nativeInvoke('audioEdit:explanation', input),
    transcribe: input => ipcRenderer.invoke('audioEdit:explanation', input),
    preflight: input => nativeInvoke('audioEdit:explanation', input),
    cancel: sessionId => nativeInvoke('audioEdit:explanation', { action: 'cancel', sessionId }),
  },
  loudness: createAudioLoudnessApi(nativeInvoke),
  extractSamples: (payload) => nativeInvoke('audio:extractSamples', payload),
  extractRangeSamples: (payload) => nativeInvoke('audio:extractSamples', { ...payload, mode: 'range' }),
  extractWaveformPyramid: (payload) => nativeInvoke('audio:extractSamples', { ...payload, mode: 'pyramid' }),
  cancelExtractSamples: (requestId) => nativeInvoke('audio:cancelExtractSamples', { requestId }),
  spliceEditAudio: request => nativeInvoke('audioEdit:splice', request),
  probeEditSource: (sourcePath, requestId) => nativeInvoke('audioEdit:source:probe', { sourcePath, requestId }),
  verifyEditSource: (projectId) => nativeInvoke('audioEdit:source:verify', { projectId }),
  relinkEditSource: (projectId, sourcePath) => nativeInvoke('audioEdit:source:relink', { projectId, sourcePath }),
  detectEditSilence: (payload) => nativeInvoke('audioEdit:silence', payload),
  detectEditBreaths: (projectId) => nativeInvoke('audioEdit:breaths', { projectId }),
  listEditTasks: (projectId) => nativeInvoke('audioEdit:tasks:list', { projectId }),
  cancelEditTask: (requestId) => nativeInvoke('audioEdit:tasks:cancel', { requestId }),
  prepareEditProcessing: (projectId, requestId) => nativeInvoke('audioEdit:processing', { projectId, requestId }),
  listAsrModels: () => nativeInvoke('audioEdit:asr:list'),
  preflightTranscription: input => nativeInvoke('audioEdit:asr:preflight', input),
  transcribeEditProject: (payload) => ipcRenderer.invoke('audioEdit:asr:transcribe', payload),
  exportEditProject: (payload) => nativeInvoke('audioEdit:export', payload),
  listEditProcessors: () => nativeInvoke('audioEdit:processors:list'),
  spectralTile: payload => nativeInvoke('audioEdit:spectralTile', payload),
  spectralCancel: requestId => nativeInvoke('audioEdit:spectralCancel', { requestId }),
  onSpectralProgress: handler => {
    const listener = (_event: Electron.IpcRendererEvent, progress: AudioEditSpectralProgress): void => handler(progress)
    ipcRenderer.on('audioEdit:spectralProgress', listener)
    return () => ipcRenderer.removeListener('audioEdit:spectralProgress', listener)
  },
  renderEditAudio: payload => nativeInvoke('audioEdit:render', payload),
  editedSourceAudio: payload => nativeInvoke('audioEdit:editedSource', payload),
  matchAudioEditLoudness: payload => nativeInvoke('audioEdit:matchLoudness', payload),
  detectAudioEditMouthClicks: payload => nativeInvoke('audioEdit:detectMouthClicks', payload),
  prepareEditPreviewChunk: (payload) => nativeInvoke('audioEdit:preview:chunk', payload),
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
  appMenu: {
    update: menus => nativeInvoke('appMenu:update', menus),
    onInvoke: listener => subscribeChannel('appMenu:invoke', payload => {
      if (payload && typeof payload === 'object' && 'id' in payload && typeof payload.id === 'string') listener({ id: payload.id })
    }),
  },
  embeddedAgent: createEmbeddedAgentApi(nativeInvoke),
  mcp: createMcpApi(nativeInvoke),
  applicationControl: createApplicationControlApi(nativeInvoke),
  runtimeInfo: {
    uiInspectionActive: process.env['HENJI_UI_INSPECTION_ALLOW_OVERSIZE'] === '1',
    uiInspectionGpuInitializationFailure:
      process.env['HENJI_UI_INSPECTION_GPU_INIT_FAILURE'] === '1',
    uiInspectionReadOnly: process.env['HENJI_UI_INSPECTION_READ_ONLY'] === '1',
  },
  assistant: assistantApi,
  ai: aiApi,
  llm: llmApi,
  ...(automationTestMode ? { testFixtures: testFixturesApi } : {}),
  generationHistory: createGenerationHistoryApi(nativeInvoke),
  presets: createPresetsApi(nativeInvoke),
  settings: createSettingsApi(nativeInvoke),
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
  videoFrames: createVideoFramesApi(nativeInvoke),
  videoDecoder: createVideoDecoderApi(nativeInvoke),
  audio: audioApi,
  clipboard: clipboardApi,
  drag: dragApi,
  logging: loggingApi,
  updater: updaterApi,
  modelscope: {},
  window: windowApi,
  diagnostics: diagnosticsApi,
  assetLibrary: assetLibraryApi,
  documents: createDocumentsApi(nativeInvoke),
  workRoot: createWorkRootApi(nativeInvoke, subscribeChannel),
  localModels: createLocalModelsApi(nativeInvoke, subscribeChannel),
  soundLibrary: createSoundLibraryApi(nativeInvoke, subscribeChannel),
  audioCapture: createAudioCaptureApi(nativeInvoke, subscribeChannel),
  fonts: createFontsApi(nativeInvoke, subscribeChannel),
  smartRegions: createSmartRegionsApi(nativeInvoke, subscribeChannel),
  tracking: createTrackingApi(nativeInvoke, subscribeChannel),
  videoProxy: createVideoProxyApi(nativeInvoke, subscribeChannel),
  mediaCache: createMediaCacheApi(nativeInvoke, subscribeChannel),
  sceneDetection: createSceneDetectionApi(nativeInvoke, subscribeChannel),
  webReplay: createWebReplayApi(nativeInvoke, subscribeChannel),
  musicAnalysis: createMusicAnalysisApi(nativeInvoke, subscribeChannel),
  screenRecording: createScreenRecordingApi(nativeInvoke, subscribeChannel),
}

contextBridge.exposeInMainWorld('henjiNative', api)
