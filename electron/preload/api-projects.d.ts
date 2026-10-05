import type {
  CameraStageRenderEvent,
  CameraStageRenderOutputKind,
  CameraStageRenderRequest,
  CameraStageRenderWorkerJob,
  CameraStageRenderResolutionPreset,
  CameraStageRenderResult,
  CameraStageRenderTaskScope,
  CameraStageRenderTaskSnapshot,
  CameraStageRenderTaskStatus,
} from '../../src/platform/contracts/cameraStageRender'

export interface HenjiWindowStatePayload {
  isMaximized: boolean
}

export interface HenjiWindowContentSize {
  width: number
  height: number
}

export interface HenjiWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  getContentSize(): Promise<HenjiWindowContentSize>
  setZoomFactor(factor: import('../../src/core/theme/uiScale').UiScaleFactor): Promise<void>
  /** 同步主题窗口底色与 color-scheme 到主进程（窗口创建与缩放露底用） */
  setAppearance(appearance: { windowBackground: string; colorScheme: 'dark' | 'light' }): Promise<void>
  toggleDevTools(): Promise<void>
  onStateChanged(handler: (payload: HenjiWindowStatePayload) => void): () => void
  onCloseRequested(handler: () => void): () => void
  confirmClose(): Promise<void>
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

/** 测试夹具（只在自动化 / 隔离测试模式下存在）：核对或清理正式界面没有入口的记录。 */
export interface HenjiTestFixturesApi {
  inspectGenerationSubmission(requestId: string): Promise<{ phase: string; createdAt: number; hasResponse: boolean } | null>
  deleteGenerationSubmission(requestId: string): Promise<boolean>
}

/** 原始 SQL 通道（测试专用，只在自动化 / 隔离测试模式下存在；3.4 删除）。 */
export interface HenjiDbApi {
  execute(sql: string, params?: HenjiSqlBindValue[]): Promise<HenjiSqlExecuteResult>
  select<T = unknown>(sql: string, params?: HenjiSqlBindValue[]): Promise<T[]>
}

export type HenjiCameraStageRenderResolutionPreset = CameraStageRenderResolutionPreset
export type HenjiCameraStageRenderOutputKind = CameraStageRenderOutputKind
export type HenjiCameraStageRenderRequest = CameraStageRenderRequest
export type HenjiCameraStageRenderWorkerJob = CameraStageRenderWorkerJob
export type HenjiCameraStageRenderResult = CameraStageRenderResult
export type HenjiCameraStageRenderEvent = CameraStageRenderEvent
export type HenjiCameraStageRenderTaskStatus = CameraStageRenderTaskStatus
export type HenjiCameraStageRenderTaskScope = CameraStageRenderTaskScope
export type HenjiCameraStageRenderTaskSnapshot = CameraStageRenderTaskSnapshot

export interface HenjiCameraStageRenderApi {
  start(request: HenjiCameraStageRenderRequest): Promise<{ task: HenjiCameraStageRenderTaskSnapshot; idempotent: boolean }>
  get(scope: HenjiCameraStageRenderTaskScope): Promise<HenjiCameraStageRenderTaskSnapshot | null>
  list(canvasProjectId?: string): Promise<HenjiCameraStageRenderTaskSnapshot[]>
  cancel(scope: HenjiCameraStageRenderTaskScope): Promise<void>
  acknowledge(scope: HenjiCameraStageRenderTaskScope): Promise<void>
  onEvent(handler: (event: HenjiCameraStageRenderTaskSnapshot) => void): () => void
  workerReady(): Promise<void>
  onWorkerJob(handler: (request: HenjiCameraStageRenderWorkerJob) => void): () => void
  onWorkerCancel(handler: (requestId: string) => void): () => void
  reportWorkerEvent(event: HenjiCameraStageRenderEvent): Promise<void>
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
