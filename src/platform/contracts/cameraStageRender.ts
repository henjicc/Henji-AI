export type CameraStageRenderResolutionPreset = '720p' | '1080p'
export type CameraStageRenderOutputKind = 'image' | 'video'

export interface CameraStageRenderRequest {
  requestId: string
  canvasProjectId: string
  nodeId: string
  cameraStageProjectId: string
  resolutionPreset: CameraStageRenderResolutionPreset
  outputKind: CameraStageRenderOutputKind
  selectedTimeSec?: number
}

export interface CameraStageImageRenderResult {
  kind: 'image'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  width: number
  height: number
  aspectRatio: string
  selectedTimeSec: number
}

export interface CameraStageVideoRenderResult {
  kind: 'video'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export type CameraStageRenderResult = CameraStageImageRenderResult | CameraStageVideoRenderResult

export type CameraStageRenderEvent =
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
      result: CameraStageRenderResult
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

export type CameraStageRenderTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface CameraStageRenderTaskScope {
  requestId: string
  canvasProjectId: string
  nodeId: string
}

export interface CameraStageRenderTaskSnapshot extends CameraStageRenderRequest {
  acknowledgedAt?: number
  status: CameraStageRenderTaskStatus
  phase: 'preparing' | 'rendering' | 'encoding' | null
  progress: number
  result: CameraStageRenderResult | null
  message: string | null
  createdAt: number
  updatedAt: number
}

export interface CameraStageRenderPlatform {
  start(request: CameraStageRenderRequest): Promise<{ task: CameraStageRenderTaskSnapshot; idempotent: boolean }>
  get(scope: CameraStageRenderTaskScope): Promise<CameraStageRenderTaskSnapshot | null>
  list(canvasProjectId: string): Promise<CameraStageRenderTaskSnapshot[]>
  cancel(scope: CameraStageRenderTaskScope): Promise<void>
  acknowledge(scope: CameraStageRenderTaskScope): Promise<void>
  onEvent(listener: (event: CameraStageRenderTaskSnapshot) => void): () => void
  workerReady(): Promise<void>
  onWorkerJob(listener: (request: CameraStageRenderRequest) => void): () => void
  onWorkerCancel(listener: (requestId: string) => void): () => void
  reportWorkerEvent(event: CameraStageRenderEvent): Promise<void>
}
