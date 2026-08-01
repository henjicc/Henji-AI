import { createLogger } from '@/core/logging'

import { persistSceneScreenshot } from '../export/cameraStageScreenshot'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'

const logger = createLogger('features.cameraStage.viewport_observer')

export interface CameraStageViewportCaptureProvider {
  capture: () => string | null
  dimensions: () => { width: number; height: number }
}

export interface CameraStageViewportObservation {
  previewRef: { kind: 'media.image'; id: string }
  projectId: string
  surfaceId: 'tool.camera_stage'
  source: { viewportId: string; kind: 'director' | 'fixed' | 'camera'; cameraId?: string; fixedView?: string }
  width: number
  height: number
  dataClass: 'C1'
  maskPolicyId: 'camera_stage.viewport_declared_region'
  lifecycle: 'application_media'
  capturedAt: string
}

let provider: CameraStageViewportCaptureProvider | null = null

export function registerCameraStageViewportCaptureProvider(
  next: CameraStageViewportCaptureProvider,
): () => void {
  provider = next
  return () => {
    if (provider === next) provider = null
  }
}

export async function observeCameraStageViewport(projectId: string): Promise<CameraStageViewportObservation> {
  logger.info('三维视口观察开始', {
    event: 'camera_stage.viewport.observe.start',
    projectId,
    surfaceId: 'tool.camera_stage',
  })
  try {
    const state = useCameraStageStore.getState()
    if (state.currentProjectId !== projectId) throw new Error('STALE_CONTEXT')
    if (!provider) throw new Error('VIEWPORT_OBSERVER_NOT_AVAILABLE')
    const dataUrl = provider.capture()
    if (!dataUrl) throw new Error('VIEWPORT_CAPTURE_FAILED')
    const persisted = await persistSceneScreenshot(dataUrl)
    const viewport = useCameraStageViewportStore.getState()
    const viewportId = viewport.activeViewportId
    const source = viewport.viewports[viewportId].source
    const dimensions = provider.dimensions()
    const result: CameraStageViewportObservation = {
      previewRef: { kind: 'media.image', id: persisted.mediaUrl },
      projectId,
      surfaceId: 'tool.camera_stage',
      source: source.kind === 'camera'
        ? { viewportId, kind: 'camera', cameraId: source.cameraId }
        : source.kind === 'fixed'
          ? { viewportId, kind: 'fixed', fixedView: source.view }
          : { viewportId, kind: 'director' },
      width: dimensions.width,
      height: dimensions.height,
      dataClass: 'C1',
      maskPolicyId: 'camera_stage.viewport_declared_region',
      lifecycle: 'application_media',
      capturedAt: new Date().toISOString(),
    }
    logger.info('三维视口观察完成', {
      event: 'camera_stage.viewport.observe.completed',
      projectId,
      surfaceId: result.surfaceId,
      width: result.width,
      height: result.height,
      sourceKind: result.source.kind,
    })
    return result
  } catch (error) {
    logger.error('三维视口观察失败', error, {
      event: 'camera_stage.viewport.observe.failed',
      projectId,
      surfaceId: 'tool.camera_stage',
    })
    throw error
  }
}
