import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import { createLogger } from '@/core/logging'
import {
  createImageEditorV3RequestId,
  readImageEditorV3SourceTile,
} from '@/commands/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  createDefaultImageEditorGpuSceneClientV3,
  type ImageEditorGpuSceneClientV3Like,
} from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { imageEditorGpuSceneTileKeyV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import type {
  ImageEditorRenderSessionStateV3,
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'

const logger = createLogger('features.image_edit.v3.gpu_scene_bridge')

export class ImageEditorRenderSessionGpuBridgeV3 {
  private readonly client: ImageEditorGpuSceneClientV3Like | null
  private unsubscribe: () => void
  private sceneGeneration = 0
  private cameraSequence = 0
  private interactionSequence = 0
  private quality: ImageEditRenderQuality = 'draft'
  private layout: ImageEditorViewportLayoutV3 | null = null
  private readonly loadingTiles = new Set<string>()
  private pendingFrame = false
  private disposed = false

  constructor(
    sessionId: string,
    injectedClient: ImageEditorGpuSceneClientV3Like | null | undefined,
    private readonly publish: (patch: Partial<ImageEditorRenderSessionStateV3>) => void,
    private readonly diagnosticRenderingEnabled = false,
  ) {
    this.client = injectedClient === undefined
      ? createDefaultImageEditorGpuSceneClientV3(sessionId)
      : injectedClient
    this.unsubscribe = this.client?.subscribe((event) => this.handleEvent(event))
      ?? (() => undefined)
  }

  syncSnapshot(snapshot: ImageEditorRenderSnapshotV3): void {
    this.sceneGeneration = snapshot.renderGeneration
    this.interactionSequence = 0
    this.pendingFrame = false
    this.quality = snapshot.quality
    this.client?.syncScene(snapshot)
    if (this.layout) {
      this.client?.updateViewport(this.sceneGeneration, this.cameraSequence, this.layout)
      if (this.diagnosticRenderingEnabled) this.requestFrame(snapshot.quality)
    }
  }

  updateViewport(cameraSequence: number, layout: ImageEditorViewportLayoutV3): void {
    this.cameraSequence = cameraSequence
    this.layout = layout
    if (this.sceneGeneration > 0) {
      this.client?.updateViewport(this.sceneGeneration, cameraSequence, layout)
      if (this.diagnosticRenderingEnabled) this.requestFrame(this.quality)
    }
  }

  updateTransientLayerTransform(
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
  ): void {
    if (this.sceneGeneration <= 0 || interactionSequence < this.interactionSequence) return
    this.interactionSequence = interactionSequence
    this.client?.updateTransientLayerTransform(
      this.sceneGeneration,
      layerId,
      transform,
      interactionSequence,
    )
  }

  clearTransientLayerTransform(layerId: string, interactionSequence: number): void {
    if (this.sceneGeneration <= 0 || interactionSequence < this.interactionSequence) return
    this.interactionSequence = interactionSequence
    this.client?.clearTransientLayerTransform(
      this.sceneGeneration,
      layerId,
      interactionSequence,
    )
  }

  requestFrame(quality: ImageEditRenderQuality = this.quality): void {
    if (this.sceneGeneration <= 0) return
    this.pendingFrame = true
    this.client?.requestFrame(
      this.sceneGeneration,
      this.cameraSequence,
      this.interactionSequence,
      quality,
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loadingTiles.clear()
    this.unsubscribe()
    this.unsubscribe = () => undefined
    this.client?.dispose()
  }

  private handleEvent(event: ImageEditorGpuSceneWorkerEventV3): void {
    if (event.sceneGeneration !== this.sceneGeneration) return
    if (event.type === 'tiles-needed') {
      void this.loadTiles(event)
      return
    }
    if (event.type === 'frame-ready') {
      this.pendingFrame = false
      logger.info('图片编辑 GPU Scene 隐藏帧完成', {
        event: 'image_editor_v3.gpu_scene.hidden_frame_ready',
        requestId: event.requestId,
        context: event.diagnostics ?? {},
      })
      // 2.1 只证明 ImageBitmap 桥已打通；2.2 将在此处完成稳定帧交接。
      event.bitmap.close()
      return
    }
    if (event.type === 'ready') {
      this.publish({
        deviceStatus: 'ready',
        deviceGeneration: event.deviceGeneration,
        diagnostic: null,
      })
      if (this.pendingFrame) this.requestFrame(this.quality)
      return
    }
    if (event.type === 'device-lost') {
      this.publish({
        compositionBackend: 'cpu',
        presentationBackend: 'canvas2d',
        deviceStatus: 'lost',
        deviceGeneration: event.deviceGeneration,
        diagnostic: event.reason,
      })
      return
    }
    if (event.type === 'failed' && event.code === 'initialization-failed') {
      this.publish({
        compositionBackend: 'cpu',
        presentationBackend: 'canvas2d',
        deviceStatus: 'fallback',
        diagnostic: event.message,
      })
    }
  }

  private async loadTiles(
    event: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'tiles-needed' }>,
  ): Promise<void> {
    const generation = event.sceneGeneration
    const keys = event.keys.filter((key) => {
      const id = imageEditorGpuSceneTileKeyV3(key)
      if (this.loadingTiles.has(id)) return false
      this.loadingTiles.add(id)
      return true
    })
    try {
      const tiles = await Promise.all(keys.map(async (key) => ({
        key,
        tile: await readImageEditorV3SourceTile({
          requestId: createImageEditorV3RequestId('gpu-scene-tile'),
          resourceRef: key.resourceRef,
          mip: key.mip,
          tileX: key.tileX,
          tileY: key.tileY,
          halo: 0,
          bitDepth: 8,
        }),
      })))
      if (this.disposed || generation !== this.sceneGeneration || tiles.length === 0) return
      this.client?.uploadTiles(generation, tiles.map(({ key, tile }) => ({
        key,
        tile,
        estimatedGpuBytes: tile.width * tile.height * 4,
        protections: ['viewport', 'stable-frame'],
      })))
      if (this.pendingFrame) this.requestFrame(this.quality)
    } catch (error) {
      logger.warn('图片编辑 GPU Scene 源纹理读取失败', {
        event: 'image_editor_v3.gpu_scene.tile_load_failed',
        context: {
          sceneGeneration: generation,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      for (const key of keys) this.loadingTiles.delete(imageEditorGpuSceneTileKeyV3(key))
    }
  }
}
