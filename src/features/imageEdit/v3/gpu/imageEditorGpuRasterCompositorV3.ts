import { draw, frame, surface, target, type Draw, type Gpu, type Surface, type Target, type Texture } from 'vgpu'

import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import layerShaderSource from './shaders/imageEditorGpuRasterLayerV3.wgsl?raw'
import presentShaderSource from './shaders/imageEditorGpuRasterPresentV3.wgsl?raw'
import type {
  ImageEditorGpuRasterLayerV3,
  ImageEditorGpuRasterSceneV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const
type NativeGpuBufferV3 = ReturnType<Gpu['gpu']['createBuffer']>
type NativeGpuBindGroupV3 = ReturnType<Gpu['gpu']['createBindGroup']>

export interface ImageEditorGpuRasterTextureV3 {
  readonly key: ImageEditorGpuSceneTileKeyV3
  readonly tile: Pick<ImageEditorV3SourceTile, 'originX' | 'originY' | 'width' | 'height'>
  readonly texture: Texture
  destroy(): void
}

export interface ImageEditorGpuRasterCompositorStatsV3 {
  uploadCount: number
  pipelineCompileCount: number
  frameCount: number
  diagnosticReadbackCount: number
}

export interface ImageEditorGpuRasterFrameV3 {
  bitmap: ImageBitmap
  stats: ImageEditorGpuRasterCompositorStatsV3
}

export interface ImageEditorGpuRasterCompositorV3Like {
  syncScene(scene: ImageEditorGpuRasterSceneV3 | null): void
  updateTransientTransform(layerId: string, transform: ImageEditTransformV3 | null): void
  updateViewport(layout: ImageEditorViewportLayoutV3): void
  uploadTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): ImageEditorGpuRasterTextureV3
  missingResources(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): ImageEditorGpuSceneTileKeyV3[]
  render(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<ImageEditorGpuRasterFrameV3>
  readLinearPixelsForTest(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<Float32Array>
  snapshotStats(): ImageEditorGpuRasterCompositorStatsV3
  dispose(): void
}

interface RetainedLayerStateV3 {
  buffer: NativeGpuBufferV3
  bindGroup: NativeGpuBindGroupV3
  resource: ImageEditorGpuRasterTextureV3
}

/** 会话级常驻基础栅格合成器；正式呈现由 2.2 接手，本阶段只产出隐藏 ImageBitmap。 */
export class ImageEditorGpuRasterCompositorV3 implements ImageEditorGpuRasterCompositorV3Like {
  private readonly output: Target
  private readonly rasterDraw: Draw
  private readonly presentDraw: Draw
  private readonly cameraBuffer: NativeGpuBufferV3
  private cameraBindGroup: NativeGpuBindGroupV3 | null = null
  private readonly layers = new Map<string, RetainedLayerStateV3>()
  private readonly transientTransforms = new Map<string, ImageEditTransformV3>()
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private layout: ImageEditorViewportLayoutV3 | null = null
  private canvas: OffscreenCanvas | null = null
  private canvasSurface: Surface | null = null
  private rasterCompilePromise: Promise<void> | null = null
  private presentCompilePromise: Promise<void> | null = null
  private frameQueue: Promise<void> = Promise.resolve()
  private rasterCompiled = false
  private presentCompiled = false
  private disposed = false
  private reportedError: Error | null = null
  private readonly unsubscribeError: () => void
  private stats: ImageEditorGpuRasterCompositorStatsV3 = {
    uploadCount: 0,
    pipelineCompileCount: 0,
    frameCount: 0,
    diagnosticReadbackCount: 0,
  }

  constructor(private readonly gpu: Gpu) {
    this.output = target(gpu, {
      size: [1, 1],
      format: 'rgba16float',
      clearColor: CLEAR,
      label: 'image-editor-gpu-raster-linear',
    })
    this.rasterDraw = draw(gpu, {
      shader: layerShaderSource,
      blend: 'premultiplied',
      vertices: 3,
      label: 'image-editor-gpu-raster-layer',
    })
    this.presentDraw = draw(gpu, {
      shader: presentShaderSource,
      vertices: 3,
      set: { sourceTexture: this.output.color },
      label: 'image-editor-gpu-raster-present',
    })
    this.cameraBuffer = gpu.gpu.createBuffer({
      size: 16,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      label: 'image-editor-gpu-raster-camera',
    })
    this.unsubscribeError = gpu.onError((error) => {
      this.reportedError = error instanceof Error ? error : new Error(String(error))
    })
  }

  syncScene(scene: ImageEditorGpuRasterSceneV3 | null): void {
    this.assertUsable()
    this.scene = scene
    this.transientTransforms.clear()
    const active = new Set(scene?.layers.map((layer) => layer.layerId) ?? [])
    for (const [layerId, state] of this.layers) {
      if (active.has(layerId)) continue
      state.buffer.destroy()
      this.layers.delete(layerId)
    }
  }

  updateTransientTransform(layerId: string, transform: ImageEditTransformV3 | null): void {
    this.assertUsable()
    if (transform) this.transientTransforms.set(layerId, [...transform])
    else this.transientTransforms.delete(layerId)
    const layer = this.scene?.layers.find((entry) => entry.layerId === layerId)
    const retained = this.layers.get(layerId)
    if (layer && retained) {
      this.writeLayerBuffer(layer, retained.buffer, this.resolveTransform(layer), retained.resource)
    }
  }

  updateViewport(layout: ImageEditorViewportLayoutV3): void {
    this.assertUsable()
    this.layout = layout
    const scale = layout.viewport.zoom * layout.viewport.devicePixelRatio
    this.gpu.gpu.queue.writeBuffer(this.cameraBuffer, 0, new Float32Array([
      layout.viewport.documentX,
      layout.viewport.documentY,
      scale,
      0,
    ]))
  }

  uploadTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): ImageEditorGpuRasterTextureV3 {
    this.assertUsable()
    assertBasicSourceTile(key, tile)
    const texture = this.gpu.device.createTexture({
      size: [tile.width, tile.height],
      format: 'rgba8unorm',
      usage: ['copy_dst', 'texture_binding'],
      label: `image-editor-gpu-raster-source:${key.resourceRef.slice(0, 20)}`,
    })
    this.gpu.gpu.queue.writeTexture(
      { texture: texture.gpu },
      tile.pixels,
      { bytesPerRow: tile.rowStride, rowsPerImage: tile.height },
      { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
    )
    this.stats.uploadCount += 1
    let destroyed = false
    return {
      key: { ...key },
      tile: { originX: tile.originX, originY: tile.originY, width: tile.width, height: tile.height },
      texture,
      destroy: () => {
        if (destroyed) return
        destroyed = true
        texture.destroy()
      },
    }
  }

  missingResources(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
  ): ImageEditorGpuSceneTileKeyV3[] {
    if (!this.scene) return []
    return this.scene.requiredResourceKeys.filter((key) => !resolve(key))
  }

  async render(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
  ): Promise<ImageEditorGpuRasterFrameV3> {
    return await this.enqueueFrame(async () => {
      await this.compose(resolve)
      const surfaceTarget = await this.ensurePresentationSurface()
      this.reportedError = null
      const submitted = frame(this.gpu, (currentFrame) => {
        currentFrame.pass({ target: surfaceTarget, clear: CLEAR }, this.presentDraw)
      })
      await submitted.done
      await this.gpu.settled()
      this.throwReportedError()
      const bitmap = this.canvas!.transferToImageBitmap()
      return { bitmap, stats: this.snapshotStats() }
    })
  }

  async readLinearPixelsForTest(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
  ): Promise<Float32Array> {
    return await this.enqueueFrame(async () => {
      await this.compose(resolve)
      this.stats.diagnosticReadbackCount += 1
      return await this.output.readFloats()
    })
  }

  snapshotStats(): ImageEditorGpuRasterCompositorStatsV3 {
    return { ...this.stats }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeError()
    for (const state of this.layers.values()) state.buffer.destroy()
    this.layers.clear()
    this.cameraBuffer.destroy()
    this.canvasSurface?.dispose()
    this.canvasSurface = null
    this.canvas = null
    this.output.color.destroy()
  }

  private async compose(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
  ): Promise<void> {
    this.assertUsable()
    if (!this.scene || !this.layout) throw new Error('GPU Scene 缺少场景或视口')
    const missing = this.missingResources(resolve)
    if (missing.length > 0) throw new Error(`GPU Scene 缺少 ${missing.length} 个源纹理`)
    const width = Math.max(1, Math.ceil(this.layout.viewport.width * this.layout.viewport.devicePixelRatio))
    const height = Math.max(1, Math.ceil(this.layout.viewport.height * this.layout.viewport.devicePixelRatio))
    if (this.output.size[0] !== width || this.output.size[1] !== height) {
      this.output.resize([width, height])
    }
    await this.ensureRasterCompiled()
    this.rasterDraw.group(1, this.cameraBindGroup!)
    const ordered: Array<{ layer: ImageEditorGpuRasterLayerV3; state: RetainedLayerStateV3 }> = []
    for (const layer of this.scene.layers) {
      if (!layer.visible || layer.opacity <= 0) continue
      const resource = resolve(layer.resourceKey)!
      ordered.push({ layer, state: this.ensureLayerState(layer, resource) })
    }
    this.reportedError = null
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: this.output, clear: CLEAR }, (pass) => {
        for (const entry of ordered) {
          this.rasterDraw.group(0, entry.state.bindGroup)
          pass.draw(this.rasterDraw)
        }
      })
    })
    await submitted.done
    await this.gpu.settled()
    this.throwReportedError()
    this.stats.frameCount += 1
  }

  private async ensureRasterCompiled(): Promise<void> {
    if (this.rasterCompiled) return
    this.rasterCompilePromise ??= (async () => {
      await this.rasterDraw.compile(this.output)
      this.cameraBindGroup = this.gpu.gpu.createBindGroup({
        layout: this.rasterDraw.layout(1),
        entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
      })
      this.rasterCompiled = true
      this.stats.pipelineCompileCount += 1
    })()
    try {
      await this.rasterCompilePromise
    } catch (error) {
      this.rasterCompilePromise = null
      throw error
    }
  }

  private ensureLayerState(
    layer: ImageEditorGpuRasterLayerV3,
    resource: ImageEditorGpuRasterTextureV3,
  ): RetainedLayerStateV3 {
    const existing = this.layers.get(layer.layerId)
    if (existing?.resource === resource) {
      this.writeLayerBuffer(layer, existing.buffer, this.resolveTransform(layer), resource)
      return existing
    }
    existing?.buffer.destroy()
    const buffer = this.gpu.gpu.createBuffer({
      size: 48,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      label: `image-editor-gpu-raster-layer:${layer.layerId}`,
    })
    const bindGroup = this.gpu.gpu.createBindGroup({
      layout: this.rasterDraw.layout(0),
      entries: [
        { binding: 0, resource: resource.texture.view },
        { binding: 1, resource: { buffer } },
      ],
    })
    const state = { buffer, bindGroup, resource }
    this.layers.set(layer.layerId, state)
    this.writeLayerBuffer(layer, buffer, this.resolveTransform(layer), resource)
    return state
  }

  private writeLayerBuffer(
    layer: ImageEditorGpuRasterLayerV3,
    buffer: NativeGpuBufferV3,
    transform: ImageEditTransformV3,
    resource?: ImageEditorGpuRasterTextureV3,
  ): void {
    const inverse = invertImageEditTransformV3(transform)
    const retainedResource = resource ?? null
    this.gpu.gpu.queue.writeBuffer(buffer, 0, new Float32Array([
      inverse[0], inverse[1], inverse[2], inverse[3],
      inverse[4], inverse[5], layer.opacity, 0,
      retainedResource?.tile.originX ?? 0,
      retainedResource?.tile.originY ?? 0,
      0,
      0,
    ]))
  }

  private resolveTransform(layer: ImageEditorGpuRasterLayerV3): ImageEditTransformV3 {
    return this.transientTransforms.get(layer.layerId) ?? layer.transform
  }

  private async ensurePresentationSurface(): Promise<Surface> {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('GPU Scene Worker 缺少 OffscreenCanvas')
    const size = this.output.size
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(size[0], size[1])
      this.canvasSurface = surface(this.gpu, this.canvas, {
        autoResize: false,
        size,
        alphaMode: 'premultiplied',
        colorSpace: 'srgb',
        label: 'image-editor-gpu-raster-presentation',
      })
    } else if (this.canvas.width !== size[0] || this.canvas.height !== size[1]) {
      this.canvasSurface!.resize(size)
    }
    if (!this.presentCompiled) {
      this.presentCompilePromise ??= (async () => {
        await this.presentDraw.compile({
          colors: [this.canvasSurface!.format],
          sampleCount: 1,
        })
        this.presentCompiled = true
        this.stats.pipelineCompileCount += 1
      })()
      try {
        await this.presentCompilePromise
      } catch (error) {
        this.presentCompilePromise = null
        throw error
      }
    }
    return this.canvasSurface!
  }

  private enqueueFrame<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.frameQueue.then(operation, operation)
    this.frameQueue = current.then(() => undefined, () => undefined)
    return current
  }

  private throwReportedError(): void {
    if (!this.reportedError) return
    const error = this.reportedError
    this.reportedError = null
    throw error
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU 基础栅格合成器已销毁')
  }
}

function assertBasicSourceTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): void {
  if (tile.resourceRef !== key.resourceRef || tile.mip !== key.mip
    || tile.tileX !== key.tileX || tile.tileY !== key.tileY) throw new Error('GPU 源瓦片身份不一致')
  if (tile.bitDepth !== 8 || tile.sampleFormat !== 'uint' || tile.numericRange !== 'unorm8'
    || tile.colorSpace !== 'srgb' || tile.transferFunction !== 'srgb'
    || tile.alphaMode !== 'straight' || tile.orientationApplied !== true || tile.halo !== 0) {
    throw new Error('基础 GPU 合成只接受无 halo 的 8-bit sRGB straight-alpha 瓦片')
  }
  if (tile.rowStride < tile.width * 4
    || tile.pixels.byteLength < tile.rowStride * tile.height) throw new Error('GPU 源瓦片像素缓冲区不完整')
}
