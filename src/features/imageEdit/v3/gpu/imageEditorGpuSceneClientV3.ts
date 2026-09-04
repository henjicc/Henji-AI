import { createLogger } from '@/core/logging'
import {
  isUiInspectionActive,
  isUiInspectionGpuInitializationFailure,
} from '@/platform/runtime'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorRenderSnapshotV3 } from '../execution/imageEditorRenderSessionContractsV3'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneUploadTileV3,
  type ImageEditorGpuSceneWorkerEventV3,
  type ImageEditorGpuSceneWorkerFactoryV3,
  type ImageEditorGpuSceneWorkerPortV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneSequenceGateV3 } from './imageEditorGpuSceneSequenceV3'

const logger = createLogger('features.image_edit.v3.gpu_scene')
const GPU_SCENE_DIAGNOSTIC_EVENT = 'henji:image-editor-gpu-scene-diagnostic'

export interface ImageEditorGpuSceneClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorGpuSceneWorkerFactoryV3
  memoryBudgetBytes?: number
  /** 仅测试可显式关闭；正式会话默认请求 Surface / ImageBitmap GPU 帧。 */
  renderingEnabled?: boolean
}

export interface ImageEditorGpuSceneClientV3Like {
  attachPresentationSurface?(surfaceGeneration: number, canvas: OffscreenCanvas): void
  syncScene(snapshot: ImageEditorRenderSnapshotV3): void
  uploadTiles(sceneGeneration: number, tiles: readonly ImageEditorGpuSceneUploadTileV3[]): void
  updateTransientLayerTransform(
    sceneGeneration: number,
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
  ): void
  clearTransientLayerTransform(
    sceneGeneration: number,
    layerId: string,
    interactionSequence: number,
  ): void
  updateViewport(
    sceneGeneration: number,
    cameraSequence: number,
    layout: ImageEditorViewportLayoutV3,
  ): void
  requestFrame(
    sceneGeneration: number,
    cameraSequence: number,
    interactionSequence: number,
    quality: ImageEditRenderQuality,
  ): void
  subscribe(listener: (event: ImageEditorGpuSceneWorkerEventV3) => void): () => void
  dispose(): void
}

function createDefaultWorker(): ImageEditorGpuSceneWorkerPortV3 {
  return new Worker(
    new URL('./imageEditorGpuScene.worker.ts', import.meta.url),
    { type: 'module', name: 'image-editor-gpu-scene-v3' },
  )
}

export class ImageEditorGpuSceneClientV3 implements ImageEditorGpuSceneClientV3Like {
  private readonly worker: ImageEditorGpuSceneWorkerPortV3
  private readonly sequence = new ImageEditorGpuSceneSequenceGateV3()
  private readonly listeners = new Set<(event: ImageEditorGpuSceneWorkerEventV3) => void>()
  private readonly renderingEnabled: boolean
  private requestSequence = 0
  private surfaceGeneration = 0
  private readonly diagnosticEventListener: EventListener | null
  private disposed = false

  constructor(private readonly options: ImageEditorGpuSceneClientOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('GPU Scene 会话 ID 不能为空')
    this.worker = (options.workerFactory ?? createDefaultWorker)()
    this.renderingEnabled = options.renderingEnabled !== false
    this.worker.onmessage = (message) => this.handleEvent(message.data)
    this.worker.onerror = (event) => this.handleWorkerError(event)
    const diagnosticInspection = isUiInspectionActive()
    this.diagnosticEventListener = diagnosticInspection
      ? ((event) => {
          const detail = (event as CustomEvent<{
            recovery?: unknown
          }>).detail
          const recovery = detail?.recovery
          if (recovery !== 'success' && recovery !== 'failure') return
          this.worker.postMessage({ type: 'diagnostic-device-loss', recovery })
        })
      : null
    if (this.diagnosticEventListener) {
      window.addEventListener(GPU_SCENE_DIAGNOSTIC_EVENT, this.diagnosticEventListener)
    }
    logger.info('开始初始化图片编辑 GPU Scene', {
      event: 'image_editor_v3.gpu_scene.initialize.start',
      context: { sessionId: options.sessionId },
    })
    this.worker.postMessage({
      type: 'initialize',
      protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
      sessionId: options.sessionId,
      memoryBudgetBytes: options.memoryBudgetBytes
        ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
      diagnosticInitializationFailure: isUiInspectionGpuInitializationFailure(),
    })
  }

  syncScene(snapshot: ImageEditorRenderSnapshotV3): void {
    this.assertUsable()
    if (!this.sequence.syncScene(snapshot.renderGeneration)) return
    this.worker.postMessage({
      type: 'sync-scene',
      sceneGeneration: snapshot.renderGeneration,
      document: snapshot.document,
      resourceDescriptors: snapshot.resourceDescriptors,
    })
  }

  attachPresentationSurface(surfaceGeneration: number, canvas: OffscreenCanvas): void {
    this.assertUsable()
    if (!Number.isSafeInteger(surfaceGeneration) || surfaceGeneration <= this.surfaceGeneration) return
    this.surfaceGeneration = surfaceGeneration
    this.worker.postMessage({
      type: 'attach-presentation-surface',
      surfaceGeneration,
      canvas,
    }, [canvas])
  }

  uploadTiles(sceneGeneration: number, tiles: readonly ImageEditorGpuSceneUploadTileV3[]): void {
    this.assertUsable()
    if (sceneGeneration !== this.sequence.snapshot().sceneGeneration || tiles.length === 0) return
    this.worker.postMessage(
      { type: 'upload-tiles', sceneGeneration, tiles },
      tiles.map((entry) => entry.tile.pixels),
    )
  }

  updateTransientLayerTransform(
    sceneGeneration: number,
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
  ): void {
    this.assertUsable()
    if (!this.sequence.updateInteraction(sceneGeneration, interactionSequence)) return
    this.worker.postMessage({
      type: 'update-transform', sceneGeneration, interactionSequence, layerId, transform,
    })
  }

  clearTransientLayerTransform(
    sceneGeneration: number,
    layerId: string,
    interactionSequence: number,
  ): void {
    this.assertUsable()
    if (!this.sequence.updateInteraction(sceneGeneration, interactionSequence)) return
    this.worker.postMessage({
      type: 'update-transform', sceneGeneration, interactionSequence, layerId, transform: null,
    })
  }

  updateViewport(
    sceneGeneration: number,
    cameraSequence: number,
    layout: ImageEditorViewportLayoutV3,
  ): void {
    this.assertUsable()
    if (!this.sequence.updateCamera(sceneGeneration, cameraSequence)) return
    this.worker.postMessage({ type: 'update-viewport', sceneGeneration, cameraSequence, layout })
  }

  requestFrame(
    sceneGeneration: number,
    cameraSequence: number,
    interactionSequence: number,
    quality: ImageEditRenderQuality,
  ): void {
    this.assertUsable()
    if (!this.renderingEnabled) return
    const current = this.sequence.snapshot()
    if (sceneGeneration !== current.sceneGeneration
      || cameraSequence !== current.cameraSequence
      || interactionSequence !== current.interactionSequence) return
    this.worker.postMessage({
      type: 'render',
      requestId: `${this.options.sessionId}:gpu-frame:${++this.requestSequence}`,
      sceneGeneration,
      cameraSequence,
      interactionSequence,
      surfaceGeneration: this.surfaceGeneration,
      quality,
    })
  }

  subscribe(listener: (event: ImageEditorGpuSceneWorkerEventV3) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.postMessage({ type: 'dispose' })
    this.worker.terminate()
    this.worker.onmessage = null
    this.worker.onerror = null
    if (this.diagnosticEventListener) {
      window.removeEventListener(GPU_SCENE_DIAGNOSTIC_EVENT, this.diagnosticEventListener)
    }
    this.listeners.clear()
  }

  private handleEvent(event: ImageEditorGpuSceneWorkerEventV3): void {
    if (!this.sequence.acceptsEvent(event)) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    if ((event.type === 'frame-ready' || event.type === 'surface-frame-ready')
      && event.surfaceGeneration !== this.surfaceGeneration) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    if (event.type === 'ready') {
      logger.info('完成初始化图片编辑 GPU Scene', {
        event: 'image_editor_v3.gpu_scene.initialize.completed',
        context: {
          sessionId: this.options.sessionId,
          deviceGeneration: event.deviceGeneration,
          recovered: event.recovered,
        },
      })
    } else if (event.type === 'device-lost') {
      logger.warn('图片编辑 GPU Scene 设备丢失，保留 CPU 后备', {
        event: 'image_editor_v3.gpu_scene.device_lost',
        context: {
          sessionId: this.options.sessionId,
          deviceGeneration: event.deviceGeneration,
          retryAfterMs: event.retryAfterMs,
          reason: event.reason,
        },
      })
    } else if (event.type === 'failed') {
      const expectedFallback = event.code === 'resource-budget-exceeded' && event.recoverable
      const metadata = {
        event: expectedFallback
          ? 'image_editor_v3.gpu_scene.resource_budget_fallback'
          : event.code === 'composition-not-ready' && event.recoverable
            ? 'image_editor_v3.gpu_scene.composition_deferred'
            : 'image_editor_v3.gpu_scene.failed',
        requestId: event.requestId ?? undefined,
        context: {
          sessionId: this.options.sessionId,
          code: event.code,
          recoverable: event.recoverable,
          diagnosticDeviceAcquireCount: event.diagnostics?.deviceAcquireCount,
          diagnosticSurfaceFrameCount: event.diagnostics?.surfaceFrameCount,
        },
      }
      if (event.code === 'composition-not-ready' && event.recoverable) {
        logger.debug('图片编辑 GPU Scene 等待场景或源纹理', metadata)
      } else if (event.diagnostic) {
        logger.warn('Reality 已注入图片编辑 GPU Scene 失败', metadata)
      } else if (expectedFallback) {
        logger.warn('图片编辑 GPU Scene 超出显存预算，切换 CPU 后备', metadata)
      } else {
        logger.error('图片编辑 GPU Scene 运行失败', new Error(event.message), metadata)
      }
    } else if (event.type === 'frame-ready' && event.surfaceFailureReason) {
      logger.warn('图片编辑 GPU Surface 失效，已降级到 GPU ImageBitmap', {
        event: 'image_editor_v3.gpu_scene.surface_fallback',
        requestId: event.requestId,
        context: {
          sessionId: this.options.sessionId,
          surfaceGeneration: event.surfaceGeneration,
          reason: event.surfaceFailureReason,
        },
      })
    }
    for (const listener of this.listeners) listener(event)
  }

  private handleWorkerError(event: ErrorEvent): void {
    const current = this.sequence.snapshot()
    this.handleEvent({
      type: 'failed',
      sceneGeneration: current.sceneGeneration,
      deviceGeneration: 0,
      requestId: null,
      code: 'initialization-failed',
      message: event.message || 'GPU Scene Worker 启动失败',
      recoverable: true,
    })
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU Scene 客户端已销毁')
  }
}

export function createDefaultImageEditorGpuSceneClientV3(
  sessionId: string,
): ImageEditorGpuSceneClientV3Like | null {
  return typeof Worker === 'undefined' ? null : new ImageEditorGpuSceneClientV3({ sessionId })
}
