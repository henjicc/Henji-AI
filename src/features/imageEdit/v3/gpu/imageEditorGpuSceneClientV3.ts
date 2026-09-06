import { createLogger } from '@/core/logging'
import { createImageEditorV3RequestId } from '@/commands/imageEditorV3'
import { readSharedImageEditorSourcePyramidV3 } from '../execution/imageEditorSourcePyramidsV3'
import { IMAGE_EDITOR_GPU_RESOURCE_RETRY_DELAY_MS_V3, isTransientImageEditorGpuResourceFailureV3 } from '../execution/imageEditorGpuResourceRetryV3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3ResourceRef } from '@/platform/contracts/imageEditorV3'
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
  type ImageEditorGpuSceneExportRequestV3,
  type ImageEditorGpuSceneWorkerEventV3,
  type ImageEditorGpuSceneWorkerFactoryV3,
  type ImageEditorGpuSceneWorkerPortV3,
  type ImageEditorGpuSceneWorkerRequestV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneSequenceGateV3 } from './imageEditorGpuSceneSequenceV3'

const logger = createLogger('features.image_edit.v3.gpu_scene')
export const IMAGE_EDITOR_GPU_SCENE_DIAGNOSTIC_EVENT_V3 = 'henji:image-editor-gpu-scene-diagnostic'

export interface ImageEditorGpuSceneClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorGpuSceneWorkerFactoryV3
  memoryBudgetBytes?: number
  /** 仅测试可显式关闭；正式会话默认请求 Surface / ImageBitmap GPU 帧。 */
  renderingEnabled?: boolean
  sourcePyramidReader?: typeof readSharedImageEditorSourcePyramidV3
}

export interface ImageEditorGpuSceneClientV3Like {
  attachPresentationSurface?(surfaceGeneration: number, canvas: OffscreenCanvas): void
  syncScene(snapshot: ImageEditorRenderSnapshotV3): void
  uploadTiles(sceneGeneration: number, tiles: readonly ImageEditorGpuSceneUploadTileV3[]): void
  uploadExportTiles?(
    sceneGeneration: number,
    exportRequestId: string,
    tiles: readonly ImageEditorGpuSceneUploadTileV3[],
  ): void
  requestExport?(request: ImageEditorGpuSceneExportRequestV3): void
  cancelExport?(requestId: string): void
  acknowledgeExportTile?(requestId: string, tileX: number, tileY: number): void
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
  private preparingScene: AbortController | null = null
  private pendingSceneMessages: Array<{ message: ImageEditorGpuSceneWorkerRequestV3; transfer?: Transferable[] }> = []
  private deviceGeneration = 0
  private lostDeviceGeneration = -1
  private readyDeviceGeneration = -1
  private sceneResourcesReady = false
  private latestSnapshot: ImageEditorRenderSnapshotV3 | null = null
  private resourceRetryTimer: ReturnType<typeof setTimeout> | null = null

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
      window.addEventListener(IMAGE_EDITOR_GPU_SCENE_DIAGNOSTIC_EVENT_V3, this.diagnosticEventListener)
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
    this.clearResourceRetry()
    this.preparingScene?.abort()
    this.pendingSceneMessages = []
    this.latestSnapshot = snapshot
    this.sceneResourcesReady = false
    this.prepareScene(snapshot, true)
  }

  private prepareScene(snapshot: ImageEditorRenderSnapshotV3, retryAllowed: boolean): void {
    logger.debug('开始准备图片编辑 GPU 场景资源', {
      event: 'image_editor_v3.gpu_scene.resources.start',
      context: { sceneGeneration: snapshot.renderGeneration, retry: !retryAllowed },
    })
    const request = {
      type: 'sync-scene',
      sceneGeneration: snapshot.renderGeneration,
      document: snapshot.document,
      resourceDescriptors: snapshot.resourceDescriptors,
    } as const
    const refs = rasterSourceRefs(snapshot.document.layers)
    if (refs.length === 0) {
      this.preparingScene = null
      this.worker.postMessage({ ...request, sourcePyramids: {} })
      this.publishResourcesReady(snapshot.renderGeneration)
      return
    }
    const controller = new AbortController()
    this.preparingScene = controller
    const readPyramid = this.options.sourcePyramidReader ?? readSharedImageEditorSourcePyramidV3
    void Promise.all(refs.map(async (resourceRef) => [resourceRef, await readPyramid({
      requestId: createImageEditorV3RequestId('gpu-source-pyramid'), resourceRef,
    }, controller.signal)] as const)).then((entries) => {
      if (controller.signal.aborted || this.disposed || this.preparingScene !== controller) return
      this.worker.postMessage({ ...request, sourcePyramids: Object.fromEntries(entries) })
      this.preparingScene = null
      const pending = this.pendingSceneMessages
      this.pendingSceneMessages = []
      for (const queued of pending) this.worker.postMessage(queued.message, queued.transfer)
      this.publishResourcesReady(snapshot.renderGeneration)
    }).catch((error: unknown) => {
      if (controller.signal.aborted || this.disposed || this.preparingScene !== controller) return
      this.pendingSceneMessages = this.pendingSceneMessages.filter(({ message }) => (
        message.type === 'update-viewport' || message.type === 'update-transform'
      ))
      this.preparingScene = null
      controller.abort()
      this.handleEvent({
        type: 'failed', sceneGeneration: snapshot.renderGeneration, deviceGeneration: this.deviceGeneration,
        requestId: null, code: 'scene-resources-failed', recoverable: true,
        message: `读取图片资源几何失败：${error instanceof Error ? error.message : String(error)}`,
      })
      if (retryAllowed && isTransientImageEditorGpuResourceFailureV3(error)) {
        this.resourceRetryTimer = setTimeout(() => {
          this.resourceRetryTimer = null
          if (!this.disposed && this.latestSnapshot === snapshot) this.prepareScene(snapshot, false)
        }, IMAGE_EDITOR_GPU_RESOURCE_RETRY_DELAY_MS_V3)
      }
    })
  }

  private publishResourcesReady(sceneGeneration: number): void {
    this.sceneResourcesReady = true
    logger.debug('完成图片编辑 GPU 场景资源准备', {
      event: 'image_editor_v3.gpu_scene.resources.completed', context: { sceneGeneration },
    })
    this.handleEvent({ type: 'scene-resources-ready', sceneGeneration, deviceGeneration: this.deviceGeneration })
  }

  private clearResourceRetry(): void {
    if (this.resourceRetryTimer !== null) clearTimeout(this.resourceRetryTimer)
    this.resourceRetryTimer = null
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
    this.postSceneMessage(
      { type: 'upload-tiles', sceneGeneration, tiles },
      tiles.map((entry) => entry.tile.pixels),
    )
  }

  uploadExportTiles(
    sceneGeneration: number,
    exportRequestId: string,
    tiles: readonly ImageEditorGpuSceneUploadTileV3[],
  ): void {
    this.assertUsable()
    if (sceneGeneration !== this.sequence.snapshot().sceneGeneration || tiles.length === 0) return
    this.postSceneMessage(
      { type: 'upload-tiles', sceneGeneration, exportRequestId, tiles },
      tiles.map((entry) => entry.tile.pixels),
    )
  }

  requestExport(request: ImageEditorGpuSceneExportRequestV3): void {
    this.assertUsable()
    if (request.sceneGeneration !== this.sequence.snapshot().sceneGeneration) return
    this.postSceneMessage(request)
  }

  cancelExport(requestId: string): void {
    if (this.disposed) return
    this.pendingSceneMessages = this.pendingSceneMessages.filter(({ message }) => (
      message.type !== 'export' || message.requestId !== requestId
    ))
    this.worker.postMessage({ type: 'cancel-export', requestId })
  }

  acknowledgeExportTile(requestId: string, tileX: number, tileY: number): void {
    if (this.disposed) return
    this.worker.postMessage({ type: 'export-tile-consumed', requestId, tileX, tileY })
  }

  updateTransientLayerTransform(
    sceneGeneration: number,
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
  ): void {
    this.assertUsable()
    if (!this.sequence.updateInteraction(sceneGeneration, interactionSequence)) return
    this.postSceneMessage({
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
    this.postSceneMessage({
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
    this.postSceneMessage({ type: 'update-viewport', sceneGeneration, cameraSequence, layout })
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
    this.postSceneMessage({
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
    this.preparingScene?.abort()
    this.clearResourceRetry()
    this.pendingSceneMessages = []
    this.worker.postMessage({ type: 'dispose' })
    this.worker.terminate()
    this.worker.onmessage = null
    this.worker.onerror = null
    if (this.diagnosticEventListener) {
      window.removeEventListener(IMAGE_EDITOR_GPU_SCENE_DIAGNOSTIC_EVENT_V3, this.diagnosticEventListener)
    }
    this.listeners.clear()
  }

  private handleEvent(event: ImageEditorGpuSceneWorkerEventV3): void {
    if (this.disposed) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    if (event.deviceGeneration < this.deviceGeneration) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    if (event.deviceGeneration <= this.lostDeviceGeneration
      && (event.type === 'frame-ready' || event.type === 'surface-frame-ready'
        || event.type === 'tiles-needed' || event.type === 'export-tile')) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    // 设备生命周期独立于场景；ready 可能在 sync-scene 发送前就由 Worker 发出。
    if (event.type === 'ready' || event.type === 'device-lost') {
      if (event.type === 'ready') {
        if (event.deviceGeneration <= this.lostDeviceGeneration
          || event.deviceGeneration === this.readyDeviceGeneration) return
        this.readyDeviceGeneration = event.deviceGeneration
      }
      this.deviceGeneration = event.deviceGeneration
      event = { ...event, sceneGeneration: this.sequence.snapshot().sceneGeneration }
    }
    if (event.type === 'device-lost'
      || (event.type === 'failed' && event.code === 'initialization-failed')) {
      this.lostDeviceGeneration = event.deviceGeneration
      event = { ...event, sceneGeneration: this.sequence.snapshot().sceneGeneration }
      this.clearResourceRetry()
      this.preparingScene?.abort()
      this.preparingScene = null
      // 尚未同步的新场景仍需最新相机/手势；丢弃旧设备的像素、帧和导出任务。
      this.pendingSceneMessages = this.pendingSceneMessages.filter(({ message }) => (
        message.type === 'update-viewport' || message.type === 'update-transform'
      ))
    }
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
        event: event.code === 'scene-resources-failed'
          ? 'image_editor_v3.gpu_scene.resources.failed'
          : expectedFallback
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
    if (event.type === 'ready' && event.recovered && !this.sceneResourcesReady && !this.preparingScene
      && this.latestSnapshot) this.prepareScene(this.latestSnapshot, true)
  }

  private handleWorkerError(event: ErrorEvent): void {
    const current = this.sequence.snapshot()
    this.handleEvent({
      type: 'failed',
      sceneGeneration: current.sceneGeneration,
      deviceGeneration: this.deviceGeneration,
      requestId: null,
      code: 'initialization-failed',
      message: event.message || 'GPU Scene Worker 启动失败',
      recoverable: true,
    })
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU Scene 客户端已销毁')
  }

  private postSceneMessage(message: ImageEditorGpuSceneWorkerRequestV3, transfer?: Transferable[]): void {
    if (this.sceneResourcesReady && !this.preparingScene) {
      this.worker.postMessage(message, transfer)
      return
    }
    if (message.type === 'update-viewport' || message.type === 'render' || message.type === 'update-transform') {
      this.pendingSceneMessages = this.pendingSceneMessages.filter(({ message: previous }) => (
        previous.type !== message.type
        || (previous.type === 'update-transform' && message.type === 'update-transform'
          && previous.layerId !== message.layerId)
      ))
    }
    this.pendingSceneMessages.push({ message, transfer })
  }
}

function rasterSourceRefs(layers: ImageEditDocumentV3['layers']): ImageEditorV3ResourceRef[] {
  return [...new Set(layers.flatMap((layer): ImageEditorV3ResourceRef[] => {
    if (layer.type === 'group') return rasterSourceRefs(layer.children)
    return layer.type === 'raster' && layer.source.kind === 'resource'
      ? [layer.source.resourceId as ImageEditorV3ResourceRef] : []
  }))]
}

export function createDefaultImageEditorGpuSceneClientV3(
  sessionId: string,
): ImageEditorGpuSceneClientV3Like | null {
  return typeof Worker === 'undefined' ? null : new ImageEditorGpuSceneClientV3({ sessionId })
}
