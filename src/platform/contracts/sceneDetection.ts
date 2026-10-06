import type { SceneDetectionRequest, SceneDetectionResult } from '../../core/videoEdit/sceneDetection'

export const SCENE_DETECTION_CHANNELS = { detect: 'video:scene-detect', cancel: 'video:scene-cancel', validate: 'video:scene-validate', progress: 'video:scene-progress' } as const
export interface SceneDetectionPlatform {
  detect(request: SceneDetectionRequest): Promise<SceneDetectionResult>
  cancel(requestId: string): Promise<void>
  validate(source: string, contentIdentity: string): Promise<boolean>
  onProgress(listener: (event: { requestId: string; progress: number }) => void): () => void
}
