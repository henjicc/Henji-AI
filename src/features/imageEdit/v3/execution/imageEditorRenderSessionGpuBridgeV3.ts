import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import { createLogger } from '@/core/logging'
import {
  createImageEditorV3RequestId,
  readImageEditorV3BrushTiles,
  readImageEditorV3SourceTile,
} from '@/commands/imageEditorV3'
import { readImageEditorV3SourceTiles } from '@/commands/imageEditorV3Tiles'
import type { ImageEditorV3ResourceDescriptor, ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from '../application/imageEditorResourceDescriptorsV3'
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
const GPU_SOURCE_TILE_BATCH_SIZE = 16

export class ImageEditorRenderSessionGpuBridgeV3 {
  private readonly client: ImageEditorGpuSceneClientV3Like | null
  private unsubscribe: () => void
  private sceneGeneration = 0
  private cameraSequence = 0
  private interactionSequence = 0
  private latestInteractionSequence = 0
  private quality: ImageEditRenderQuality = 'draft'
  private sourceBitDepth: 8 | 16 | 32 = 8
  private layout: ImageEditorViewportLayoutV3 | null = null
  private readonly loadingTiles = new Set<string>()
  private resourceDescriptors = new Map<string, ImageEditorV3ResourceDescriptor>()
  private tileLoadQueue: Promise<void> = Promise.resolve()
  private tileLoadAbortController = new AbortController()
  private pendingFrame = false
  private frameInFlight = false
  private deviceReady = false
  private gpuPresented = false
  private interactionEventTimestamp: number | null = null
  private inFlightEventTimestamp: number | null = null
  private pendingTransform: {
    layerId: string
    transform: ImageEditTransformV3 | null
    interactionSequence: number
  } | null = null
  private disposed = false

  constructor(
    sessionId: string,
    injectedClient: ImageEditorGpuSceneClientV3Like | null | undefined,
    private readonly publish: (patch: Partial<ImageEditorRenderSessionStateV3>) => void,
    private readonly diagnosticRenderingEnabled = false,
    private readonly presentFrame?: (
      event: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'frame-ready' }>,
      layout: ImageEditorViewportLayoutV3,
      eventToPresentMs: number | null,
    ) => boolean,
    private readonly fallbackToStableFrame?: () => void,
    private readonly readBrushTiles = readImageEditorV3BrushTiles,
  ) {
    this.client = injectedClient === undefined
      ? createDefaultImageEditorGpuSceneClientV3(sessionId)
      : injectedClient
    this.unsubscribe = this.client?.subscribe((event) => this.handleEvent(event))
      ?? (() => undefined)
  }

  syncSnapshot(snapshot: ImageEditorRenderSnapshotV3): void {
    this.tileLoadAbortController.abort()
    this.tileLoadAbortController = new AbortController()
    this.loadingTiles.clear()
    this.sceneGeneration = snapshot.renderGeneration
    this.interactionSequence = 0
    this.latestInteractionSequence = 0
    this.pendingFrame = false
    this.frameInFlight = false
    this.pendingTransform = null
    this.interactionEventTimestamp = snapshot.eventTimestamp ?? null
    this.quality = snapshot.quality
    this.sourceBitDepth = snapshot.document.color.bitDepth === 8
      ? 8
      : snapshot.document.color.bitDepth === 16 ? 16 : 32
    this.resourceDescriptors = new Map(snapshot.resourceDescriptors.map((entry) => [entry.resourceRef, entry]))
    this.client?.syncScene(snapshot)
    if (this.layout) {
      this.client?.updateViewport(this.sceneGeneration, this.cameraSequence, this.layout)
      this.requestFrame(snapshot.quality)
    }
  }

  updateViewport(cameraSequence: number, layout: ImageEditorViewportLayoutV3): void {
    this.cameraSequence = cameraSequence
    this.layout = layout
    if (this.sceneGeneration > 0) {
      this.client?.updateViewport(this.sceneGeneration, cameraSequence, layout)
      this.frameInFlight = false
      this.requestFrame(this.quality)
    }
  }

  updateTransientLayerTransform(
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
    eventTimestamp?: number,
  ): void {
    if (this.sceneGeneration <= 0 || interactionSequence < this.latestInteractionSequence) return
    this.latestInteractionSequence = interactionSequence
    this.interactionEventTimestamp = eventTimestamp ?? null
    this.pendingTransform = { layerId, transform: [...transform], interactionSequence }
  }

  clearTransientLayerTransform(layerId: string, interactionSequence: number): void {
    if (this.sceneGeneration <= 0 || interactionSequence < this.latestInteractionSequence) return
    this.latestInteractionSequence = interactionSequence
    this.interactionEventTimestamp = null
    this.pendingTransform = { layerId, transform: null, interactionSequence }
  }

  requestFrame(quality: ImageEditRenderQuality = this.quality): void {
    if (this.sceneGeneration <= 0) return
    this.pendingFrame = true
    this.quality = quality
    this.dispatchFrame()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.tileLoadAbortController.abort()
    this.loadingTiles.clear()
    this.unsubscribe()
    this.unsubscribe = () => undefined
    this.client?.dispose()
  }

  private handleEvent(event: ImageEditorGpuSceneWorkerEventV3): void {
    if (event.sceneGeneration !== this.sceneGeneration) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    if (event.type === 'tiles-needed') {
      this.queueTileLoad(event)
      return
    }
    if (event.type === 'frame-ready') {
      if (event.cameraSequence !== this.cameraSequence
        || event.interactionSequence !== this.interactionSequence) {
        event.bitmap.close()
        return
      }
      const queuedFrame = this.pendingFrame
      this.pendingFrame = false
      this.frameInFlight = false
      const layout = this.layout
      const eventToPresentMs = this.inFlightEventTimestamp === null
        ? null
        : Math.max(0, performance.now() - this.inFlightEventTimestamp)
      this.inFlightEventTimestamp = null
      let presented = false
      try {
        presented = Boolean(layout && this.presentFrame?.(event, layout, eventToPresentMs))
      } finally {
        event.bitmap.close()
      }
      const frameLog = {
        event: this.diagnosticRenderingEnabled
          ? 'image_editor_v3.gpu_scene.hidden_frame_ready'
          : 'image_editor_v3.gpu_scene.frame_presented',
        requestId: event.requestId,
        context: { ...event.diagnostics, eventToPresentMs, presented },
      }
      if (this.diagnosticRenderingEnabled) logger.info('图片编辑 GPU Scene 帧完成', frameLog)
      else logger.debug('图片编辑 GPU Scene 帧完成', frameLog)
      if (presented && !this.gpuPresented) {
        this.gpuPresented = true
        this.publish({
          compositionBackend: 'gpu',
          presentationBackend: 'gpu-image-bitmap',
          coverage: 1,
          targetMipCoverage: 1,
          targetMip: 0,
          fallbackRequired: false,
          diagnostic: null,
        })
      } else if (!presented) {
        this.fallback('GPU ImageBitmap 无法交接到当前稳定表面')
      }
      if (queuedFrame) {
        this.pendingFrame = true
        this.dispatchFrame()
      }
      return
    }
    if (event.type === 'ready') {
      this.publish({
        deviceStatus: 'ready',
        deviceGeneration: event.deviceGeneration,
        diagnostic: null,
      })
      this.deviceReady = true
      if (this.pendingFrame) this.requestFrame(this.quality)
      return
    }
    if (event.type === 'device-lost') {
      this.deviceReady = false
      this.frameInFlight = false
      this.pendingFrame = true
      this.fallback(event.reason, 'lost', event.deviceGeneration)
      return
    }
    if (event.type === 'failed') {
      this.frameInFlight = false
      if (event.code === 'composition-not-ready'
        && event.recoverable
        && (!this.deviceReady || this.loadingTiles.size > 0)) {
        this.pendingFrame = true
        return
      }
      this.pendingFrame = false
      this.fallback(event.message)
    }
  }

  private dispatchFrame(): void {
    if (!this.client || !this.deviceReady || this.frameInFlight || !this.pendingFrame) return
    const pending = this.pendingTransform
    this.pendingTransform = null
    if (pending) this.interactionSequence = pending.interactionSequence
    if (pending?.transform) {
      this.client.updateTransientLayerTransform(
        this.sceneGeneration, pending.layerId, pending.transform, pending.interactionSequence,
      )
    } else if (pending) {
      this.client.clearTransientLayerTransform(
        this.sceneGeneration, pending.layerId, pending.interactionSequence,
      )
    }
    this.pendingFrame = false
    this.frameInFlight = true
    this.inFlightEventTimestamp = this.interactionEventTimestamp
    this.client.requestFrame(
      this.sceneGeneration, this.cameraSequence, this.interactionSequence, this.quality,
    )
  }

  private fallback(
    diagnostic: string,
    deviceStatus: 'lost' | 'fallback' = 'fallback',
    deviceGeneration?: number,
  ): void {
    this.gpuPresented = false
    this.fallbackToStableFrame?.()
    this.publish({
      compositionBackend: 'cpu',
      presentationBackend: 'canvas2d',
      deviceStatus,
      ...(deviceGeneration === undefined ? {} : { deviceGeneration }),
      diagnostic,
    })
  }

  private queueTileLoad(
    event: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'tiles-needed' }>,
  ): void {
    const generation = event.sceneGeneration
    const keys = event.keys.filter((key) => {
      const id = `${generation}:${imageEditorGpuSceneTileKeyV3(key)}`
      if (this.loadingTiles.has(id)) return false
      this.loadingTiles.add(id)
      return true
    })
    if (keys.length === 0) return
    const signal = this.tileLoadAbortController.signal
    const operation = () => this.loadTiles(generation, keys, signal)
    const current = this.tileLoadQueue.then(operation, operation)
    this.tileLoadQueue = current.then(() => undefined, () => undefined)
  }

  private async loadTiles(
    generation: number,
    keys: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'tiles-needed' }>['keys'],
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || this.disposed || generation !== this.sceneGeneration) return
    try {
      for (const key of keys.filter((entry) => entry.format !== undefined)) {
        if (signal.aborted || this.disposed || generation !== this.sceneGeneration) return
        const tile = await this.loadTile(key, signal)
        if (signal.aborted || this.disposed || generation !== this.sceneGeneration) return
        this.client?.uploadTiles(generation, [{
          key, tile,
          estimatedGpuBytes: tile.width * tile.height * 4 * (tile.bitDepth / 8),
          protections: ['viewport', 'stable-frame'],
        }])
      }
      const dynamicKeys = keys.filter((entry) => entry.format === undefined)
      for (let offset = 0; offset < dynamicKeys.length; offset += GPU_SOURCE_TILE_BATCH_SIZE) {
        if (signal.aborted || this.disposed || generation !== this.sceneGeneration) return
        const keyBatch = dynamicKeys.slice(offset, offset + GPU_SOURCE_TILE_BATCH_SIZE)
        const batch = await readImageEditorV3SourceTiles({
          requestId: createImageEditorV3RequestId('gpu-scene-tiles'),
          tiles: keyBatch.map((key, index) => ({
            resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
            halo: 1, bitDepth: this.sourceBitDepth, priority: index,
          })),
        }, signal)
        if (signal.aborted || this.disposed || generation !== this.sceneGeneration) return
        if (batch.tiles.length !== keyBatch.length) {
          throw new Error('GPU 源瓦片批次响应数量与请求不一致')
        }
        this.client?.uploadTiles(generation, keyBatch.map((key, index) => {
          const tile = batch.tiles[index]!
          return {
            key, tile,
            estimatedGpuBytes: tile.width * tile.height * 4 * (tile.bitDepth / 8),
            protections: ['viewport'] as const,
          }
        }))
      }
      if (this.pendingFrame) this.dispatchFrame()
    } catch (error) {
      if (signal.aborted || generation !== this.sceneGeneration
        || (error instanceof Error && error.name === 'AbortError')) return
      logger.warn('图片编辑 GPU Scene 源纹理读取失败', {
        event: 'image_editor_v3.gpu_scene.tile_load_failed',
        context: {
          sceneGeneration: generation,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      if (!this.disposed && generation === this.sceneGeneration) {
        this.pendingFrame = false
        this.frameInFlight = false
        this.fallback(`GPU 源瓦片读取失败：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      for (const key of keys) {
        this.loadingTiles.delete(`${generation}:${imageEditorGpuSceneTileKeyV3(key)}`)
      }
    }
  }

  private async loadTile(
    key: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'tiles-needed' }>['keys'][number],
    signal: AbortSignal,
  ): Promise<ImageEditorV3SourceTile> {
    const descriptor = this.resourceDescriptors.get(key.resourceRef)
    if (key.format === 'r8unorm' && descriptor?.mediaType === IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE) {
      const loaded = await this.readBrushTiles({
        requestId: createImageEditorV3RequestId('gpu-scene-mask-tile'),
        tiles: [{
          tileKey: `${key.mip}/${key.tileX}/${key.tileY}`,
          resource: { resourceId: key.resourceRef, byteSize: descriptor.byteLength },
        }],
      }, signal)
      const mask = loaded.tiles[0]?.tile
      if (!mask || mask.storage !== 'mask-float32') throw new Error('GPU Scene 蒙版资源不是 Float32 单通道瓦片')
      const rgba = new Uint8Array(mask.width * mask.height * 4)
      for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
        const value = Math.round(Math.max(0, Math.min(1, mask.data[pixel])) * 255)
        const offset = pixel * 4
        rgba[offset] = value
        rgba[offset + 1] = value
        rgba[offset + 2] = value
        rgba[offset + 3] = 255
      }
      return {
        resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
        halo: 0, width: mask.width, height: mask.height, channels: 4, bitDepth: 8,
        sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
        rowStride: mask.width * 4, colorSpace: 'srgb', transferFunction: 'srgb',
        alphaMode: 'straight', orientationApplied: true,
        originX: key.tileX * 512, originY: key.tileY * 512, pixels: rgba.buffer,
      }
    }
    return await readImageEditorV3SourceTile({
      requestId: createImageEditorV3RequestId('gpu-scene-tile'),
      resourceRef: key.resourceRef,
      mip: key.mip,
      tileX: key.tileX,
      tileY: key.tileY,
      halo: 0,
      bitDepth: 8,
    }, signal)
  }
}
