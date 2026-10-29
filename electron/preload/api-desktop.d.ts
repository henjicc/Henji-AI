import type {
  AgentTraceCaptureMode,
  AgentTraceDetailResult,
  AgentTraceQuery,
  AgentTraceQueryResult,
} from '../../src/core/assistant/trace'
import type { FsDirPage, FsDirPageOptions } from '../../src/platform/contracts/system'

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
  readFile(path: string, options?: { maxBytes: number }): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array, options?: { exclusive?: boolean; position?: number }): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readDir(path: string): Promise<HenjiFsDirEntry[]>
  readDirPage(path: string, options?: FsDirPageOptions): Promise<FsDirPage>
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

export type HenjiUserFolderKey = 'projects' | 'generated' | 'uploads' | 'exports' | 'skills'

/** 程序目录与用户目录快照，唯一来源为主进程 `services/appPaths.ts`。 */
export interface HenjiAppDirectories {
  programDir: string
  userRoot: string
  defaultUserRoot: string
  isCustomUserRoot: boolean
  folderNames: Record<HenjiUserFolderKey, string>
  folders: Record<HenjiUserFolderKey, string>
  thumbnailsDir: string
}

export interface HenjiPathsApi {
  appLocalDataDir(): Promise<string>
  /** uiLanguage 只在首次确定默认用户目录名称时生效。 */
  appDirectories(options?: { uiLanguage?: string }): Promise<HenjiAppDirectories>
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
  /** 本次请求的总时限（毫秒，1–300000）；省略时主进程用默认时限。与 PAL 契约 `system.ts` 一致。 */
  timeoutMs?: number
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
  enqueueRecycle(paths: string[], protectedBy?: string[]): Promise<void>
  /** 直接拿渲染层 File 对象对应的本地文件系统路径（webUtils.getPathForFile），
   *  文件不是来自真实磁盘文件（如剪贴板生成的合成 Blob）时返回空字符串。 */
  getPathForFile(file: File): string
  /** 解析 resources/ 下随应用分发的内置只读资源（如3D 镜头参考角色 GLB）的绝对路径，
   *  文件不存在或不属于此命名空间时返回 null。 */
  getBundledResourcePath(relativePath: string): Promise<string | null>
  /** 受控渲染层媒体导入：路径只在主进程校验、复制和探测，不把文件内容送过 IPC。 */
  importFromPath(request: import('../../src/core/media/localMediaImportContracts').ImportMediaFromPathRequest): Promise<import('../../src/core/media/localMediaImportContracts').LocalMediaImportResult>
  /** 仅供剪贴板或合成 Blob 等没有真实路径的媒体使用。 */
  importFromBytes(request: import('../../src/core/media/localMediaImportContracts').ImportMediaFromBytesRequest): Promise<import('../../src/core/media/localMediaImportContracts').LocalMediaImportResult>
  /** 只截取当前 Henji-AI 窗口内、由渲染层注册的应用表面区域，并在主进程覆盖敏感字段。 */
  captureApplicationSurface(request: import('../../src/core/application-control/surfaceObservation').SurfaceCaptureRequest): Promise<import('../../src/core/application-control/surfaceObservation').SurfaceCaptureResult>
}

export interface HenjiClipboardFileEntry {
  path: string
  size: number
  mimeType: string
}

// 本任务的桌面视频取消声明合并到既有媒体 API；不引入第二套桥接接口。
declare module './api-media' {
  interface HenjiVideoTrimVideoSourcePayload { requestId?: string }
  interface HenjiVideoCompressVideoToFitPayload { requestId?: string }
  interface HenjiVideoApi { cancelProcessing(requestId: string): Promise<void> }
}

export interface HenjiClipboardImage {
  dataUrl: string
  name: string
  origin: 'bitmap' | 'file'
}

export interface HenjiClipboardApi {
  writeText(text: string): Promise<void>
  readClipboardFiles(): Promise<HenjiClipboardFileEntry[]>
  readText(): Promise<string>
  readImage(): Promise<HenjiClipboardImage | null>
  writeImageFromPath(filePath: string): Promise<void>
  writeImageFromSource(source: string): Promise<void>
}

export interface HenjiDragApi {
  startNativeFileDrag(filePath: string, iconPath?: string): Promise<void>
  startNativeFileDragImmediate(filePath: string, iconPath?: string): void
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

/** 历史日志查询参数（2.3 历史日志回读），语义见 `electron/main/services/logging/query.ts`。 */
export interface HenjiLogQueryParams {
  date: string
  level?: HenjiLogEvent['level']
  source?: HenjiLogEvent['source']
  domainPrefix?: string
  requestId?: string
  keyword?: string
  beforeTimestamp?: string
  afterTimestamp?: string
  beforeLine?: number
  limit?: number
}

export interface HenjiLogQueryResult {
  /** 命中事件，按时间戳降序排列（最新在前）。 */
  events: HenjiLogEvent[]
  hasMore: boolean
  corruptedLines: number
  nextBeforeLine?: number
}

export interface HenjiLoggingApi {
  logFrontendEvents(events: HenjiLogEventBridgeDto[]): Promise<void>
  onLogEvent(handler: (events: HenjiLogEvent[]) => void): () => void
  setCaptureConfig(mode: HenjiLogCaptureMode): Promise<void>
  getCaptureConfig(): Promise<HenjiLogCaptureMode>
  /** 打开（或聚焦已存在的）独立日志窗口（2.1 日志窗口骨架）。 */
  openLogWindow(): Promise<void>
  /** 列出当前存在的日志文件对应的日期（降序），供历史模式日期选择器使用。 */
  listLogDates(): Promise<string[]>
  /** 按日期流式查询历史日志事件，过滤/分页均在主进程完成。 */
  queryLogEvents(params: HenjiLogQueryParams): Promise<HenjiLogQueryResult>
  exportDiagnosticBundle(
    request: import('../../src/core/logging/diagnosticBundle').ImageEditorDiagnosticBundleRequest,
  ): Promise<import('../../src/core/logging/diagnosticBundle').ImageEditorDiagnosticBundleResult>
  getAgentTraceCaptureMode(): Promise<AgentTraceCaptureMode>
  setAgentTraceCaptureMode(mode: AgentTraceCaptureMode): Promise<void>
  queryAgentTraces(params: AgentTraceQuery): Promise<AgentTraceQueryResult>
  getAgentTraceDetail(traceId: string): Promise<AgentTraceDetailResult | null>
  clearAgentTraces(date?: string): Promise<void>
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

export type HenjiAssetMediaType = 'image' | 'video' | 'audio' | 'code'
export interface HenjiAssetFileContent { sizeBytes: number; fileModifiedAt: number; contentIdentity: string }
export type HenjiAssetSource = 'generated' | 'canvas' | 'camera-stage' | 'imported' | 'external' | 'video-edit'
export interface HenjiAssetRecord { id: string; wasExisting?: boolean; mediaType: HenjiAssetMediaType; displayName: string; filePath: string; displayUrl: string; source: HenjiAssetSource; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null; thumbnailPath: string | null; thumbnailUrl: string | null; inspectionStatus: 'pending' | 'ready' | 'missing' | 'failed'; inspectionError: string | null; fileModifiedAt: number | null; contentIdentity?: string | null; lastUsedAt: number | null; createdAt: number; updatedAt: number; tags: string[]; libraryIds: string[] }
export interface HenjiAssetLibraryRecord { id: string; name: string; createdAt: number; updatedAt: number }
export interface HenjiAssetLibrarySnapshot extends HenjiAssetLibraryRecord { assetIds: string[] }
export interface HenjiCreateAssetInput { filePath: string; mediaType: HenjiAssetMediaType; displayName?: string; source: HenjiAssetSource; libraryIds?: string[] }
export interface HenjiAssetQueryInput { mediaType?: HenjiAssetMediaType; libraryId?: string; tag?: string; keyword?: string; page?: number; pageSize?: number; sort?: 'created' | 'recent' }
export interface HenjiAssetPage { items: HenjiAssetRecord[]; total: number; page: number; pageSize: number }
export interface HenjiAssetLibraryApi {
  searchAppStoreIcons(input: import('../../src/core/appStoreIcons').SearchAppStoreIconsInput): Promise<import('../../src/core/appStoreIcons').AppStoreIconSearchResult>
  saveAppStoreIcon(input: import('../../src/core/appStoreIcons').SaveAppStoreIconInput): Promise<import('../../src/core/appStoreIcons').SavedAppStoreIcon>
  createAsset(input: HenjiCreateAssetInput): Promise<HenjiAssetRecord>
  updateAsset(id: string, name: string): Promise<HenjiAssetRecord>
  deleteAsset(id: string): Promise<void>
  queryAssets(input: HenjiAssetQueryInput): Promise<HenjiAssetPage>
  touchAsset(id: string): Promise<void>
  checkPaths(filePaths: string[]): Promise<boolean[]>
  inspectAsset(id: string): Promise<HenjiAssetRecord>
  inspectFileContent(filePath: string, mediaType: HenjiAssetMediaType, verifyImport?: boolean): Promise<HenjiAssetFileContent>
  inspectAssets(ids: string[]): Promise<HenjiAssetRecord[]>
  relocateAsset(id: string, filePath: string): Promise<HenjiAssetRecord>
  listLibraries(): Promise<HenjiAssetLibraryRecord[]>
  inspectLibrary(id: string): Promise<HenjiAssetLibrarySnapshot>
  createLibrary(name: string): Promise<HenjiAssetLibraryRecord>
  renameLibrary(id: string, name: string): Promise<HenjiAssetLibraryRecord>
  deleteLibrary(id: string): Promise<void>
  restoreLibrary(snapshot: HenjiAssetLibrarySnapshot): Promise<HenjiAssetLibraryRecord>
  addToLibrary(libraryId: string, assetId: string): Promise<void>
  removeFromLibrary(libraryId: string, assetId: string): Promise<void>
  listTags(): Promise<string[]>
  setAssetTags(assetId: string, tags: string[]): Promise<HenjiAssetRecord>
}
