import type {
  AgentTraceCaptureMode,
  AgentTraceDetailResult,
  AgentTraceQuery,
  AgentTraceQueryResult,
} from '../../src/core/assistant/trace'

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
  writeFile(path: string, data: Uint8Array, options?: { exclusive?: boolean }): Promise<void>
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
  /** 解析 resources/ 下随应用分发的内置只读资源（如3D 镜头参考角色 GLB）的绝对路径，
   *  并把所在根目录注册进 henji-media:// 白名单；文件不存在或越界时返回 null。 */
  getBundledResourcePath(relativePath: string): Promise<string | null>
  /** 受控渲染层媒体导入：路径只在主进程校验、复制和探测，不把文件内容送过 IPC。 */
  importFromPath(request: import('../../src/core/media/localMediaImportContracts').ImportMediaFromPathRequest): Promise<import('../../src/core/media/localMediaImportContracts').LocalMediaImportResult>
  /** 仅供剪贴板或合成 Blob 等没有真实路径的媒体使用。 */
  importFromBytes(request: import('../../src/core/media/localMediaImportContracts').ImportMediaFromBytesRequest): Promise<import('../../src/core/media/localMediaImportContracts').LocalMediaImportResult>
  /** 只截取当前 Henji-AI 窗口内、由渲染层注册的应用表面区域，并在主进程覆盖敏感字段。 */
  captureApplicationSurface(request: import('../../src/core/assistant/surfaceObservation').SurfaceCaptureRequest): Promise<import('../../src/core/assistant/surfaceObservation').SurfaceCaptureResult>
}

export interface HenjiClipboardFileEntry {
  path: string
  data: string
  mimeType: string
}

export interface HenjiClipboardImage {
  dataUrl: string
  name: string
  origin: 'bitmap' | 'file'
}

export interface HenjiClipboardApi {
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

export type HenjiAssetMediaType = 'image' | 'video' | 'audio'
export type HenjiAssetSource = 'generated' | 'canvas' | 'camera-stage' | 'imported' | 'external'
export interface HenjiAssetRecord { id: string; wasExisting?: boolean; mediaType: HenjiAssetMediaType; displayName: string; filePath: string; displayUrl: string; source: HenjiAssetSource; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null; thumbnailPath: string | null; thumbnailUrl: string | null; inspectionStatus: 'pending' | 'ready' | 'missing' | 'failed'; inspectionError: string | null; fileModifiedAt: number | null; lastUsedAt: number | null; createdAt: number; updatedAt: number; tags: string[]; libraryIds: string[] }
export interface HenjiAssetLibraryRecord { id: string; name: string; createdAt: number; updatedAt: number }
export interface HenjiAssetLibrarySnapshot extends HenjiAssetLibraryRecord { assetIds: string[] }
export interface HenjiCreateAssetInput { filePath: string; mediaType: HenjiAssetMediaType; displayName?: string; source: HenjiAssetSource; libraryIds?: string[] }
export interface HenjiAssetQueryInput { mediaType?: HenjiAssetMediaType; libraryId?: string; tag?: string; keyword?: string; page?: number; pageSize?: number; sort?: 'created' | 'recent' }
export interface HenjiAssetPage { items: HenjiAssetRecord[]; total: number; page: number; pageSize: number }
export interface HenjiAssetLibraryApi {
  createAsset(input: HenjiCreateAssetInput): Promise<HenjiAssetRecord>
  updateAsset(id: string, name: string): Promise<HenjiAssetRecord>
  deleteAsset(id: string): Promise<void>
  queryAssets(input: HenjiAssetQueryInput): Promise<HenjiAssetPage>
  touchAsset(id: string): Promise<void>
  checkPaths(filePaths: string[]): Promise<boolean[]>
  inspectAsset(id: string): Promise<HenjiAssetRecord>
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
  rebaseDataRoot(oldRoot: string, newRoot: string): Promise<number>
}
