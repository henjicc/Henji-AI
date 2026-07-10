export interface HenjiIpcErrorEnvelope {
  name: string
  message: string
  code: string
  stack?: string
}

export interface HenjiWindowStatePayload {
  isMaximized: boolean
}

export interface HenjiWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  toggleDevTools(): Promise<void>
  onStateChanged(handler: (payload: HenjiWindowStatePayload) => void): () => void
}

export interface HenjiDiagnosticsStreamEvent {
  streamId: string
  type: 'chunk' | 'done'
  data?: string
}

export interface HenjiDiagnosticsApi {
  ping(): Promise<{ pong: true; timestamp: number }>
  streamEcho(message: string, onEvent: (event: HenjiDiagnosticsStreamEvent) => void): Promise<() => Promise<void>>
}

export type HenjiSqlBindValue = string | number | boolean | null | Uint8Array

export interface HenjiSqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

export interface HenjiDbApi {
  execute(sql: string, params?: HenjiSqlBindValue[]): Promise<HenjiSqlExecuteResult>
  select<T = unknown>(sql: string, params?: HenjiSqlBindValue[]): Promise<T[]>
}

export interface HenjiCanvasProjectSummary {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export interface HenjiCanvasProjectSnapshot {
  nodes: unknown[]
  edges: unknown[]
  viewport: unknown
}

export interface HenjiCanvasProjectRecord extends HenjiCanvasProjectSummary, HenjiCanvasProjectSnapshot {}

export interface HenjiCanvasProjectsApi {
  listProjects(): Promise<HenjiCanvasProjectSummary[]>
  createProject(id: string, name: string, snapshot: HenjiCanvasProjectSnapshot): Promise<HenjiCanvasProjectRecord>
  getProject(projectId: string): Promise<HenjiCanvasProjectRecord | null>
  renameProject(projectId: string, name: string): Promise<void>
  saveProjectSnapshot(projectId: string, snapshot: HenjiCanvasProjectSnapshot): Promise<void>
  deleteProject(projectId: string): Promise<void>
}

export interface HenjiStoryboardProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
}

export interface HenjiStoryboardProjectRecord extends HenjiStoryboardProjectSummary {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

export interface HenjiStoryboardProjectsApi {
  listProjectSummaries(): Promise<HenjiStoryboardProjectSummary[]>
  getProjectRecord(projectId: string): Promise<HenjiStoryboardProjectRecord | null>
  upsertProjectRecord(record: HenjiStoryboardProjectRecord): Promise<void>
  updateProjectViewportRecord(projectId: string, viewportJson: string): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}

export interface HenjiCameraStageProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objectCount: number
}

export interface HenjiCameraStageProjectRecord extends HenjiCameraStageProjectSummary {
  sceneJson: string
}

export interface HenjiCameraStageProjectsApi {
  listProjectSummaries(): Promise<HenjiCameraStageProjectSummary[]>
  getProjectRecord(projectId: string): Promise<HenjiCameraStageProjectRecord | null>
  upsertProjectRecord(record: HenjiCameraStageProjectRecord): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}

export interface HenjiCustomModelRecord {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: Record<string, unknown>
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface HenjiInsertCustomModelPayload {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: Record<string, unknown>
  isEnabled: boolean
}

export interface HenjiUpdateCustomModelPayload {
  name?: string
  config?: Record<string, unknown>
  isEnabled?: boolean
}

export interface HenjiCustomModelsApi {
  insertModel(model: HenjiInsertCustomModelPayload): Promise<void>
  listModels(providerId?: string): Promise<HenjiCustomModelRecord[]>
  getModel(modelId: string): Promise<HenjiCustomModelRecord | null>
  updateModel(modelId: string, updates: HenjiUpdateCustomModelPayload): Promise<void>
  deleteModel(modelId: string): Promise<void>
}

export interface HenjiProviderKeyStatus {
  providerId: string
  configured: boolean
}

export interface HenjiAiGenerateRequest {
  modelId: string
  params: Record<string, unknown>
  requestId?: string
}

export interface HenjiAiContinuePollingRequest {
  modelId: string
  taskId: string
  params?: Record<string, unknown>
}

export interface HenjiAiGetProgressEstimateRequest {
  modelId: string
  params?: Record<string, unknown>
}

export interface HenjiAiRecordProgressSampleRequest {
  modelId: string
  params?: Record<string, unknown>
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

export interface HenjiAiGenerateResponse {
  status: 'completed' | 'pending' | 'failed'
  url: string
  filePath?: string
  taskId?: string
  metadata?: unknown
  trace?: unknown
}

export interface HenjiAiProgressEstimate {
  durationMs: number
  source: 'time-bucket' | 'global' | 'seed' | 'meta' | 'default'
  profileKey: string
  timeBucket: 'night' | 'day' | 'evening'
  globalSampleCount: number
  bucketSampleCount: number
  defaultDurationMs: number
  globalEstimateMs: number
  bucketEstimateMs?: number
  recentGlobalDurationsMs: number[]
  recentBucketDurationsMs: number[]
}

export interface HenjiAiRecordProgressSampleResponse {
  actualDurationMs: number
  estimate: HenjiAiProgressEstimate
}

export interface HenjiKeystoreApi {
  setKey(namespace: string, providerId: string, apiKey: string): Promise<void>
  removeKey(namespace: string, providerId: string): Promise<void>
  getKey(namespace: string, providerId: string): Promise<string | null>
  hasKey(namespace: string, providerId: string): Promise<boolean>
}

export interface HenjiAiApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(): Promise<HenjiProviderKeyStatus[]>
  generate(request: HenjiAiGenerateRequest): Promise<HenjiAiGenerateResponse>
  continuePolling(request: HenjiAiContinuePollingRequest): Promise<HenjiAiGenerateResponse>
  cancelTask(taskId: string): Promise<void>
  reloadModelManifest(): Promise<number>
  getProgressEstimate(request: HenjiAiGetProgressEstimateRequest): Promise<HenjiAiProgressEstimate>
  recordProgressSample(request: HenjiAiRecordProgressSampleRequest): Promise<HenjiAiRecordProgressSampleResponse>
  consumePendingResult(serverTaskId: string): Promise<{ url?: string; filePath?: string; metadata?: unknown } | null>
}

export interface HenjiLlmApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(providerIds: string[]): Promise<HenjiProviderKeyStatus[]>
  chatStream(request: HenjiLlmChatRequest, onEvent: (event: HenjiLlmStreamEvent) => void): Promise<void>
  cancelTask(taskId: string): Promise<void>
  discoverModels(providerId: string, baseUrl: string): Promise<Array<{ modelId: string; displayName: string }>>
}

export type HenjiLlmRole = 'system' | 'user' | 'assistant'

export interface HenjiLlmContentPart {
  type: string
  text?: string
  imageUrl?: unknown
  videoUrl?: unknown
  inputAudio?: unknown
  [key: string]: unknown
}

export interface HenjiLlmChatMessage {
  role: HenjiLlmRole
  content?: string | HenjiLlmContentPart[] | null
  name?: string
  [key: string]: unknown
}

export interface HenjiLlmChatRequest {
  requestId?: string
  providerId: string
  modelId: string
  adapter?: string
  baseUrl?: string
  reasoning?: boolean
  messages: HenjiLlmChatMessage[]
  capabilities?: Record<string, unknown>
  tools?: unknown
  policy?: Record<string, unknown>
  memory?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface HenjiLlmTrace {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

export type HenjiLlmStreamEvent =
  | { type: 'Token'; data: string }
  | { type: 'ReasoningToken'; data: string }
  | { type: 'Done'; data: HenjiLlmTrace }
  | { type: 'Error'; data: string }

export interface HenjiLlmStreamEventPayload {
  streamId: string
  event: HenjiLlmStreamEvent
}

export interface HenjiImageMergeStoryboardImagesPayload {
  frameSources: string[]
  rows: number
  cols: number
  cellGap: number
  outerPadding: number
  noteHeight: number
  fontSize: number
  backgroundColor: string
  maxDimension: number
  showFrameIndex?: boolean
  showFrameNote?: boolean
  notePlacement?: 'overlay' | 'bottom'
  imageFit?: 'cover' | 'contain'
  frameIndexPrefix?: string
  textColor?: string
  frameNotes?: string[]
}

export interface HenjiImageMergeStoryboardImagesResult {
  imagePath: string
  canvasWidth: number
  canvasHeight: number
  cellWidth: number
  cellHeight: number
  gap: number
  padding: number
  noteHeight: number
  fontSize: number
  textOverlayApplied: boolean
  metadataEmbedded?: boolean
}

export interface HenjiImageStoryboardImageMetadata {
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

export interface HenjiImagePrepareNodeImageSourceResult {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
}

export interface HenjiImageCropImageSourcePayload {
  source: string
  aspectRatio?: string
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}

export interface HenjiImageInfoResult {
  source: string
  fileName: string | null
  extension: string
  width: number
  height: number
  fileSizeBytes: number
  createdAt: number | null
  modifiedAt: number | null
}

export interface HenjiImageApi {
  splitImage(imageBase64: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  splitImageSource(source: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  prepareNodeImageSource(source: string, maxPreviewDimension: number): Promise<HenjiImagePrepareNodeImageSourceResult>
  prepareNodeImageBinary(bytes: Uint8Array, extension: string | undefined, maxPreviewDimension: number): Promise<HenjiImagePrepareNodeImageSourceResult>
  cropImageSource(payload: HenjiImageCropImageSourcePayload): Promise<string>
  mergeStoryboardImages(payload: HenjiImageMergeStoryboardImagesPayload): Promise<HenjiImageMergeStoryboardImagesResult>
  readStoryboardImageMetadata(source: string): Promise<HenjiImageStoryboardImageMetadata | null>
  embedStoryboardImageMetadata(source: string, metadata: HenjiImageStoryboardImageMetadata): Promise<string>
  loadImage(filePath: string): Promise<string>
  persistImageSource(source: string): Promise<string>
  persistImageBinary(bytes: Uint8Array, extension: string): Promise<string>
  saveImageSourceToDownloads(source: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToPath(source: string, targetPath: string): Promise<string>
  saveImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToAppDebugDir(source: string, category: string, suggestedFileName?: string): Promise<string>
  readImageInfo(source: string): Promise<HenjiImageInfoResult>
  compressImageSource(payload: {
    source: string
    maxPixels?: number
    quality?: number
    maxDimension?: number
  }): Promise<{ fullPath: string; dataUrl: string }>
  generateThumbnailBytes(payload: { source: string; maxSize?: number }): Promise<{ bytes: Uint8Array }>
}

export interface HenjiVideoInfoResult {
  durationSeconds: number
  width: number
  height: number
}

export interface HenjiVideoTrimVideoSourcePayload {
  source: string
  startSeconds: number
  endSeconds: number
}

export interface HenjiVideoTrimVideoSourceResult {
  path: string
  durationSeconds: number
}

export interface HenjiVideoCompressVideoToFitPayload {
  source: string
  maxSizeMB: number
}

export interface HenjiVideoCompressVideoToFitResult {
  path: string
  sizeBytes: number
}

export interface HenjiVideoStartFrameExportPayload {
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
}

export interface HenjiVideoAppendFrameExportPayload {
  sessionId: string
  frameIndex: number
  dataUrl: string
}

export interface HenjiVideoFinishFrameExportPayload {
  sessionId: string
  targetPath?: string
}

export interface HenjiVideoFrameExportResult {
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export interface HenjiVideoApi {
  readVideoInfo(source: string): Promise<HenjiVideoInfoResult>
  trimVideoSource(payload: HenjiVideoTrimVideoSourcePayload): Promise<HenjiVideoTrimVideoSourceResult>
  compressVideoToFit(payload: HenjiVideoCompressVideoToFitPayload): Promise<HenjiVideoCompressVideoToFitResult>
  generateThumbnail(payload: { source: string; timeOffsetSeconds?: number }): Promise<{ dataUrl: string }>
  generateThumbnailBytes(payload: { source: string; maxSize?: number }): Promise<{ bytes: Uint8Array }>
  startFrameExport(payload: HenjiVideoStartFrameExportPayload): Promise<{ sessionId: string }>
  appendFrameExport(payload: HenjiVideoAppendFrameExportPayload): Promise<{ frameIndex: number }>
  finishFrameExport(payload: HenjiVideoFinishFrameExportPayload): Promise<HenjiVideoFrameExportResult>
  cancelFrameExport(sessionId: string): Promise<void>
}

export interface HenjiAudioExtractSamplesResult {
  rms: number[]
  peak: number[]
  durationSeconds: number
}

export interface HenjiAudioApi {
  extractSamples(payload: { source: string; bucketCount: number }): Promise<HenjiAudioExtractSamplesResult>
}

export interface HenjiFsDirEntry {
  name: string
  isDirectory: boolean
}

export interface HenjiDialogFilter {
  name: string
  extensions: string[]
}

export interface HenjiDialogSaveOptions {
  defaultPath?: string
  filters?: HenjiDialogFilter[]
}

export interface HenjiDialogOpenOptions {
  directory?: boolean
  multiple?: boolean
  defaultPath?: string
  filters?: HenjiDialogFilter[]
}

export interface HenjiFsApi {
  readFile(path: string): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readDir(path: string): Promise<HenjiFsDirEntry[]>
  copyFile(src: string, dest: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
}

export interface HenjiDialogApi {
  save(options?: HenjiDialogSaveOptions): Promise<string | null>
  open(options?: HenjiDialogOpenOptions): Promise<string | string[] | null>
}

export interface HenjiShellApi {
  openExternal(url: string): Promise<void>
}

export interface HenjiPathsApi {
  appLocalDataDir(): Promise<string>
  downloadDir(): Promise<string>
  join(...parts: string[]): Promise<string>
  dirname(path: string): Promise<string>
  tempDir(): Promise<string>
}

export interface HenjiNativeFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface HenjiNativeFetchResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: Uint8Array
}

export interface HenjiHttpApi {
  fetch(request: HenjiNativeFetchRequest): Promise<HenjiNativeFetchResponse>
}

export interface HenjiMediaApi {
  allowRoot(rootPath: string): Promise<void>
  /** 判断某个绝对路径是否在 henji-media:// 协议允许读取的根目录范围内
   *  （应用本地数据目录/系统下载目录/系统临时目录/已动态注册的根目录）。
   *  用于在复用 getPathForFile 返回的原始路径前确认协议真的能读到它，
   *  避免出现"路径有效但协议 403 拒绝"的静默失败。 */
  isPathAllowed(targetPath: string): Promise<boolean>
  /** 直接拿渲染层 File 对象对应的本地文件系统路径（webUtils.getPathForFile），
   *  文件不是来自真实磁盘文件（如剪贴板生成的合成 Blob）时返回空字符串。 */
  getPathForFile(file: File): string
  /** 解析 resources/ 下随应用分发的内置只读资源（如运镜控制角色 GLB）的绝对路径，
   *  并把所在根目录注册进 henji-media:// 白名单；文件不存在或越界时返回 null。 */
  getBundledResourcePath(relativePath: string): Promise<string | null>
}

export interface HenjiClipboardFileEntry {
  path: string
  data: string
  mimeType: string
}

export interface HenjiClipboardApi {
  readClipboardFiles(): Promise<HenjiClipboardFileEntry[]>
  readText(): Promise<string>
  writeImageFromPath(filePath: string): Promise<void>
  writeImageFromSource(source: string): Promise<void>
}

export interface HenjiDragApi {
  startNativeFileDrag(filePath: string, iconPath?: string): Promise<void>
  startNativeFileDragImmediate(filePath: string, iconPath?: string): void
}

export interface HenjiPackageMediaFile {
  srcPath: string
  packagePath: string
}

export interface HenjiImportedProjectPackage {
  manifestJson: string
  pathMap: Record<string, string>
}

export interface HenjiProjectPackageApi {
  exportProjectPackage(manifestJson: string, mediaFiles: HenjiPackageMediaFile[], targetPath: string): Promise<void>
  importProjectPackage(zipPath: string): Promise<HenjiImportedProjectPackage>
}

export interface HenjiLogEventBridgeDto {
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

export interface HenjiLogEvent {
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
  source: 'frontend' | 'backend'
  /** 单条事件体积保险丝命中时为 true，此时 context/error 已被主进程强制丢弃，见 `MainLogEvent`。 */
  truncatedByLimit?: boolean
}

/** 日志捕获模式：standard 沿用截断策略节省体积；full 长文本/图片 base64 不截断。 */
export type HenjiLogCaptureMode = 'standard' | 'full'

export interface HenjiLoggingApi {
  logFrontendEvents(events: HenjiLogEventBridgeDto[]): Promise<void>
  onLogEvent(handler: (events: HenjiLogEvent[]) => void): () => void
  setCaptureConfig(mode: HenjiLogCaptureMode): Promise<void>
  getCaptureConfig(): Promise<HenjiLogCaptureMode>
  /** 打开（或聚焦已存在的）独立日志窗口（2.1 日志窗口骨架）。 */
  openLogWindow(): Promise<void>
}

export type HenjiUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface HenjiUpdaterReleaseInfo {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
}

export interface HenjiUpdaterProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface HenjiUpdaterCheckResult {
  status: HenjiUpdaterStatus
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseInfo?: HenjiUpdaterReleaseInfo
  progress?: HenjiUpdaterProgressInfo
  errorMessage?: string
}

export type HenjiUpdaterEvent =
  | { type: 'checking'; result: HenjiUpdaterCheckResult }
  | { type: 'available'; result: HenjiUpdaterCheckResult }
  | { type: 'not-available'; result: HenjiUpdaterCheckResult }
  | { type: 'download-progress'; result: HenjiUpdaterCheckResult }
  | { type: 'downloaded'; result: HenjiUpdaterCheckResult }
  | { type: 'error'; result: HenjiUpdaterCheckResult }

export interface HenjiUpdaterApi {
  getStatus(): Promise<HenjiUpdaterCheckResult>
  checkForUpdates(): Promise<HenjiUpdaterCheckResult>
  downloadUpdate(): Promise<HenjiUpdaterCheckResult>
  quitAndInstall(): Promise<void>
  onEvent(handler: (event: HenjiUpdaterEvent) => void): () => void
}

export interface HenjiNativeApi {
  ai: HenjiAiApi
  llm: HenjiLlmApi
  db: HenjiDbApi
  canvasProjects: HenjiCanvasProjectsApi
  storyboardProjects: HenjiStoryboardProjectsApi
  cameraStageProjects: HenjiCameraStageProjectsApi
  customModels: HenjiCustomModelsApi
  keystore: HenjiKeystoreApi
  fs: HenjiFsApi
  dialog: HenjiDialogApi
  shell: HenjiShellApi
  paths: HenjiPathsApi
  http: HenjiHttpApi
  media: HenjiMediaApi
  image: HenjiImageApi
  video: HenjiVideoApi
  audio: HenjiAudioApi
  clipboard: HenjiClipboardApi
  drag: HenjiDragApi
  projectPackage: HenjiProjectPackageApi
  logging: HenjiLoggingApi
  updater: HenjiUpdaterApi
  modelscope: Record<string, never>
  window: HenjiWindowApi
  diagnostics: HenjiDiagnosticsApi
}

declare global {
  interface Window {
    henjiNative?: HenjiNativeApi
  }
}

export {}
