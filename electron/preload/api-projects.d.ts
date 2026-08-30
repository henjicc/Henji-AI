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
  setZoomFactor(factor: 0.9 | 1 | 1.1): Promise<void>
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
  coverPath: string | null
}

export interface HenjiStoryboardProjectRecord extends HenjiStoryboardProjectSummary {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

export type HenjiStoryboardProjectWrite = Omit<HenjiStoryboardProjectRecord, 'coverPath'>

export interface HenjiStoryboardProjectsApi {
  listProjectSummaries(): Promise<HenjiStoryboardProjectSummary[]>
  getProjectRecord(projectId: string): Promise<HenjiStoryboardProjectRecord | null>
  upsertProjectRecord(record: HenjiStoryboardProjectWrite): Promise<void>
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
  coverPath: string | null
}

export interface HenjiCameraStageProjectRecord extends HenjiCameraStageProjectSummary {
  sceneJson: string
}

export type HenjiCameraStageProjectWrite = Omit<HenjiCameraStageProjectRecord, 'coverPath'>

export type HenjiProjectCoverScope = 'canvas' | 'camera-stage'
export type HenjiProjectCoverSourceKind = 'image' | 'video'

export interface HenjiProjectCoverSource {
  source: string
  sourceKind: HenjiProjectCoverSourceKind
}

export interface HenjiProjectCoverRequest {
  scope: HenjiProjectCoverScope
  projectId: string
  sources: HenjiProjectCoverSource[]
}

export interface HenjiProjectCoverResult {
  projectId: string
  coverPath: string | null
}

export interface HenjiProjectCoversApi {
  saveCover(request: HenjiProjectCoverRequest): Promise<HenjiProjectCoverResult>
}

export interface HenjiCameraStageProjectsApi {
  listProjectSummaries(): Promise<HenjiCameraStageProjectSummary[]>
  getProjectRecord(projectId: string): Promise<HenjiCameraStageProjectRecord | null>
  upsertProjectRecord(record: HenjiCameraStageProjectWrite): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}

export type HenjiCameraStageRenderResolutionPreset = '720p' | '1080p'
export type HenjiCameraStageRenderOutputKind = 'image' | 'video'

export interface HenjiCameraStageRenderRequest {
  requestId: string
  nodeId: string
  projectId: string
  resolutionPreset: HenjiCameraStageRenderResolutionPreset
  outputKind: HenjiCameraStageRenderOutputKind
  selectedTimeSec?: number
}

export interface HenjiCameraStageImageRenderResult {
  kind: 'image'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  width: number
  height: number
  aspectRatio: string
  selectedTimeSec: number
}

export interface HenjiCameraStageVideoRenderResult {
  kind: 'video'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export type HenjiCameraStageRenderResult = HenjiCameraStageImageRenderResult | HenjiCameraStageVideoRenderResult

export type HenjiCameraStageRenderEvent =
  | {
      type: 'progress'
      requestId: string
      nodeId: string
      phase: 'preparing' | 'rendering' | 'encoding'
      progress: number
    }
  | {
      type: 'completed'
      requestId: string
      nodeId: string
      result: HenjiCameraStageRenderResult
    }
  | {
      type: 'failed'
      requestId: string
      nodeId: string
      message: string
    }
  | {
      type: 'cancelled'
      requestId: string
      nodeId: string
    }

export interface HenjiCameraStageRenderApi {
  start(request: HenjiCameraStageRenderRequest): Promise<{ accepted: true }>
  cancel(requestId: string): Promise<void>
  onEvent(handler: (event: HenjiCameraStageRenderEvent) => void): () => void
  workerReady(): Promise<void>
  onWorkerJob(handler: (request: HenjiCameraStageRenderRequest) => void): () => void
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
