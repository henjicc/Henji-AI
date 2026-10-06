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
  /** 与渲染层 `WindowPopoutControlRequest`、主进程 `VideoEditPopoutControlRequest` 同形。 */
  controlPopout(request:
    | { panelKey: string; action: 'begin-move' | 'move'; x: number; y: number }
    | { panelKey: string; action: 'end-move' | 'collapse' | 'expand' | 'toggle-maximize' }): Promise<void>
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

/** 测试夹具（只在自动化 / 隔离测试模式下存在）：核对或清理正式界面没有入口的记录。 */
export interface HenjiTestFixturesApi {
  inspectGenerationSubmission(requestId: string): Promise<{ phase: string; createdAt: number; hasResponse: boolean } | null>
  deleteGenerationSubmission(requestId: string): Promise<boolean>
  /** 读画布文档（内容 + 视口 / 撤销会话状态）；不存在返回 null。经正式文档接口，见 canvas-test-fixtures.ts。 */
  readCanvas(id: string): Promise<HenjiCanvasTestFixture | null>
  /** 改写画布内容（保留未给的字段），给了 viewport 一并写会话状态；返回新版本号。 */
  writeCanvas(id: string, patch: HenjiCanvasTestFixturePatch): Promise<number>
  /** 新建已命名画布（可沿用固定 ID）；已有同 ID 时按 replace 改写或原样保留；同名时换带时间的名字。 */
  createCanvas(request: HenjiCanvasTestFixtureCreateRequest): Promise<{ id: string; name: string; path: string; created: boolean }>
  findCanvasByName(name: string): Promise<{ id: string; name: string; path: string } | null>
}

export interface HenjiCanvasTestFixture {
  id: string
  name: string
  path: string
  revision: number
  draft: boolean
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
  imagePool: string[]
  layerPackages: Record<string, string>
  viewport: unknown
  /** 会话状态里的撤销记录：{ revision, history: { past, future } }。 */
  history: unknown
}

export interface HenjiCanvasTestFixturePatch {
  nodes?: unknown[]
  edges?: unknown[]
  imagePool?: string[]
  viewport?: { x: number; y: number; zoom: number }
  /** 清掉撤销记录（改写内容后旧记录对不上版本，本来也不会恢复）。 */
  clearHistory?: boolean
}

export interface HenjiCanvasTestFixtureCreateRequest {
  id?: string
  name: string
  nodes?: unknown[]
  edges?: unknown[]
  viewport?: { x: number; y: number; zoom: number }
  container?: { kind: 'user' } | { kind: 'project'; projectId: string }
  /** 已有同 ID 的画布时改写它的内容（否则原样保留）。 */
  replace?: boolean
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
