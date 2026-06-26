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
}

export interface HenjiLlmApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(providerIds: string[]): Promise<HenjiProviderKeyStatus[]>
  chatStream(request: HenjiLlmChatRequest, onEvent: (event: HenjiLlmStreamEvent) => void): Promise<void>
  cancelTask(taskId: string): Promise<void>
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

export interface HenjiRuntimeRequestPreviewPayload {
  requestId: string
  taskId?: string
  modelId: string
  providerId: string
  method: string
  route: string
  requestBody: unknown
}

export interface HenjiLoggingApi {
  logFrontendEvents(events: HenjiLogEventBridgeDto[]): Promise<void>
  onRuntimeRequestPreview(handler: (payload: HenjiRuntimeRequestPreviewPayload) => void): () => void
  onLlmRuntimeRequestPreview(handler: (payload: HenjiRuntimeRequestPreviewPayload) => void): () => void
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
  keystore: HenjiKeystoreApi
  fs: HenjiFsApi
  dialog: HenjiDialogApi
  shell: HenjiShellApi
  paths: HenjiPathsApi
  http: HenjiHttpApi
  media: HenjiMediaApi
  image: HenjiImageApi
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
