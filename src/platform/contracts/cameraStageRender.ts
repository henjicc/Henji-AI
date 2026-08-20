export type CameraStageRenderResolutionPreset = '720p' | '1080p'
export type CameraStageRenderOutputKind = 'image' | 'video'

export interface CameraStageRenderRequest {
  requestId: string
  nodeId: string
  projectId: string
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

export interface CameraStageRenderPlatform {
  start(request: CameraStageRenderRequest): Promise<{ accepted: true }>
  cancel(requestId: string): Promise<void>
  onEvent(listener: (event: CameraStageRenderEvent) => void): () => void
  workerReady(): Promise<void>
  onWorkerJob(listener: (request: CameraStageRenderRequest) => void): () => void
  onWorkerCancel(listener: (requestId: string) => void): () => void
  reportWorkerEvent(event: CameraStageRenderEvent): Promise<void>
}
