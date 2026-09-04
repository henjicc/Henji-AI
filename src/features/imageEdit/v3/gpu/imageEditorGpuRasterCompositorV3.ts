import { draw, frame, surface, target, type Draw, type Gpu, type Surface, type Target } from 'vgpu'

import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  ImageEditorGpuRenderGraphExecutorV3,
  type ImageEditorGpuGraphTextureV3,
} from './imageEditorGpuRenderGraphExecutorV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import presentShaderSource from './shaders/imageEditorGpuRasterPresentV3.wgsl?raw'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const
type NativeBuffer = ReturnType<Gpu['gpu']['createBuffer']>

export interface ImageEditorGpuRasterTextureV3 extends ImageEditorGpuGraphTextureV3 {
  destroy(): void
}

export interface ImageEditorGpuRasterCompositorStatsV3 {
  uploadCount: number
  pipelineCompileCount: number
  frameCount: number
  diagnosticReadbackCount: number
  transientUniformUpdateCount: number
  renderedGraphNodeCount?: number
  graphCacheHitCount?: number
  invalidatedGraphNodeCount?: number
  fusedAdjustmentCount?: number
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

/** 现有会话唯一 GPU compositor 的 3.1 RenderGraph 门面。 */
export class ImageEditorGpuRasterCompositorV3 implements ImageEditorGpuRasterCompositorV3Like {
  private readonly graph: ImageEditorGpuRenderGraphExecutorV3
  private readonly presentDraw: Draw
  private readonly presentBuffer: NativeBuffer
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private layout: ImageEditorViewportLayoutV3 | null = null
  private canvas: OffscreenCanvas | null = null
  private canvasSurface: Surface | null = null
  private presentCompiled = false
  private presentCompilePromise: Promise<void> | null = null
  private presentSource: Target | null = null
  private frameQueue: Promise<void> = Promise.resolve()
  private disposed = false
  private reportedError: Error | null = null
  private readonly unsubscribeError: () => void
  private stats: ImageEditorGpuRasterCompositorStatsV3 = {
    uploadCount: 0, pipelineCompileCount: 0, frameCount: 0,
    diagnosticReadbackCount: 0, transientUniformUpdateCount: 0,
    renderedGraphNodeCount: 0, graphCacheHitCount: 0,
    invalidatedGraphNodeCount: 0, fusedAdjustmentCount: 0,
  }

  constructor(private readonly gpu: Gpu) {
    this.graph = new ImageEditorGpuRenderGraphExecutorV3(gpu, () => { this.stats.pipelineCompileCount += 1 })
    this.presentDraw = draw(gpu, { shader: presentShaderSource, vertices: 3, label: 'image-editor-gpu-raster-present' })
    this.presentBuffer = gpu.gpu.createBuffer({ size: 48, usage: BUFFER_UNIFORM | BUFFER_COPY_DST, label: 'image-editor-gpu-present-geometry' })
    this.unsubscribeError = gpu.onError((error) => {
      this.reportedError = error instanceof Error ? error : new Error(String(error))
    })
  }

  syncScene(scene: ImageEditorGpuRasterSceneV3 | null): void {
    this.assertUsable()
    this.scene = scene
    this.graph.syncScene(scene)
    this.writePresentBuffer()
  }

  updateTransientTransform(layerId: string, transform: ImageEditTransformV3 | null): void {
    this.assertUsable()
    this.graph.updateTransientTransform(layerId, transform)
    this.stats.transientUniformUpdateCount += 1
  }

  updateViewport(layout: ImageEditorViewportLayoutV3): void {
    this.assertUsable()
    this.layout = layout
    this.writePresentBuffer()
  }

  uploadTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): ImageEditorGpuRasterTextureV3 {
    this.assertUsable()
    assertSourceTile(key, tile)
    const mask = key.format === 'r8unorm'
    const texture = this.gpu.device.createTexture({
      size: [tile.width, tile.height], format: mask ? 'r8unorm' : 'rgba8unorm',
      usage: ['copy_dst', 'texture_binding'], label: `image-editor-gpu-${mask ? 'mask' : 'source'}:${key.resourceRef.slice(0, 20)}`,
    })
    if (mask) {
      const rgba = new Uint8Array(tile.pixels)
      const values = new Uint8Array(tile.width * tile.height)
      for (let pixel = 0; pixel < values.length; pixel += 1) values[pixel] = rgba[pixel * 4]
      this.gpu.gpu.queue.writeTexture({ texture: texture.gpu }, values,
        { bytesPerRow: tile.width, rowsPerImage: tile.height },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 })
    } else {
      this.gpu.gpu.queue.writeTexture({ texture: texture.gpu }, tile.pixels,
        { bytesPerRow: tile.rowStride, rowsPerImage: tile.height },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 })
    }
    this.stats.uploadCount += 1
    let destroyed = false
    return {
      key: { ...key },
      tile: { originX: tile.originX, originY: tile.originY, width: tile.width, height: tile.height },
      texture,
      destroy: () => { if (!destroyed) { destroyed = true; texture.destroy() } },
    }
  }

  missingResources(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): ImageEditorGpuSceneTileKeyV3[] {
    return this.scene?.requiredResourceKeys.filter((key) => !resolve(key)) ?? []
  }

  async render(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<ImageEditorGpuRasterFrameV3> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve)
      const surfaceTarget = await this.ensurePresentationSurface()
      this.bindPresentSource(output)
      this.reportedError = null
      const submitted = frame(this.gpu, (currentFrame) => currentFrame.pass({ target: surfaceTarget, clear: CLEAR }, this.presentDraw))
      await submitted.done
      await this.gpu.settled()
      this.throwReportedError()
      return { bitmap: this.canvas!.transferToImageBitmap(), stats: this.snapshotStats() }
    })
  }

  async readLinearPixelsForTest(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<Float32Array> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve)
      this.stats.diagnosticReadbackCount += 1
      return await output.readFloats()
    })
  }

  async readPresentedPixelsForTest(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<Uint8Array> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve)
      const viewport = this.layout!.viewport
      const presentation = target(this.gpu, {
        size: [
          Math.max(1, Math.ceil(viewport.width * viewport.devicePixelRatio)),
          Math.max(1, Math.ceil(viewport.height * viewport.devicePixelRatio)),
        ],
        format: 'rgba8unorm', clearColor: CLEAR, label: 'image-editor-gpu-presentation-test',
      })
      await this.presentDraw.compile(presentation)
      this.bindPresentSource(output)
      const submitted = frame(this.gpu, (currentFrame) => currentFrame.pass(presentation, this.presentDraw))
      await submitted.done
      this.stats.diagnosticReadbackCount += 1
      const pixels = await presentation.read()
      presentation.color.destroy()
      return pixels
    })
  }

  snapshotStats(): ImageEditorGpuRasterCompositorStatsV3 {
    const graph = this.graph.snapshotStats()
    return {
      ...this.stats,
      renderedGraphNodeCount: graph.renderedNodeCount,
      graphCacheHitCount: graph.cacheHitCount,
      invalidatedGraphNodeCount: graph.invalidatedNodeCount,
      fusedAdjustmentCount: graph.fusedAdjustmentCount,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeError()
    this.graph.dispose()
    this.presentBuffer.destroy()
    this.canvasSurface?.dispose()
    this.canvasSurface = null
    this.canvas = null
  }

  private async compose(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<Target> {
    this.assertUsable()
    if (!this.scene || !this.layout) throw new Error('GPU Scene 缺少场景或视口')
    const missing = this.missingResources(resolve)
    if (missing.length > 0) throw new Error(`GPU Scene 缺少 ${missing.length} 个源纹理`)
    this.reportedError = null
    const output = await this.graph.execute(resolve)
    if (!output) throw new Error('GPU RenderGraph 没有可呈现输出')
    await this.gpu.settled()
    this.throwReportedError()
    this.stats.frameCount += 1
    return output
  }

  private async ensurePresentationSurface(): Promise<Surface> {
    if (!this.layout || typeof OffscreenCanvas === 'undefined') throw new Error('GPU Scene Worker 缺少 OffscreenCanvas')
    const size: [number, number] = [
      Math.max(1, Math.ceil(this.layout.viewport.width * this.layout.viewport.devicePixelRatio)),
      Math.max(1, Math.ceil(this.layout.viewport.height * this.layout.viewport.devicePixelRatio)),
    ]
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(size[0], size[1])
      this.canvasSurface = surface(this.gpu, this.canvas, { autoResize: false, size, alphaMode: 'premultiplied', colorSpace: 'srgb', label: 'image-editor-gpu-raster-presentation' })
    } else if (this.canvas.width !== size[0] || this.canvas.height !== size[1]) this.canvasSurface!.resize(size)
    if (!this.presentCompiled) {
      this.presentCompilePromise ??= this.presentDraw.compile({ colors: [this.canvasSurface!.format], sampleCount: 1 }).then(() => {
        this.presentCompiled = true
        this.stats.pipelineCompileCount += 1
      })
      try { await this.presentCompilePromise } catch (error) { this.presentCompilePromise = null; throw error }
    }
    return this.canvasSurface!
  }

  private bindPresentSource(output: Target): void {
    if (this.presentSource === output) return
    const bindGroup = this.gpu.gpu.createBindGroup({
      layout: this.presentDraw.layout(0),
      entries: [
        { binding: 0, resource: output.color.view },
        { binding: 1, resource: { buffer: this.presentBuffer } },
      ],
    })
    this.presentDraw.group(0, bindGroup)
    this.presentSource = output
  }

  private writePresentBuffer(): void {
    if (!this.scene || !this.layout) return
    const { viewport } = this.layout
    const { geometry } = this.scene
    const rotate = geometry.orientation.rotate / 90
    this.gpu.gpu.queue.writeBuffer(this.presentBuffer, 0, new Float32Array([
      viewport.documentX, viewport.documentY, viewport.zoom * viewport.devicePixelRatio, 0,
      geometry.width, geometry.height, geometry.crop?.x ?? 0, geometry.crop?.y ?? 0,
      rotate, geometry.orientation.mirrored ? 1 : 0, 0, 0,
    ]))
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

  private assertUsable(): void { if (this.disposed) throw new Error('GPU 栅格合成器已销毁') }
}

function assertSourceTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): void {
  if (tile.resourceRef !== key.resourceRef || tile.mip !== key.mip || tile.tileX !== key.tileX || tile.tileY !== key.tileY) throw new Error('GPU 源瓦片身份不一致')
  if (tile.bitDepth !== 8 || tile.sampleFormat !== 'uint' || tile.numericRange !== 'unorm8'
    || tile.colorSpace !== 'srgb' || tile.transferFunction !== 'srgb'
    || tile.alphaMode !== 'straight' || tile.orientationApplied !== true || tile.halo !== 0) {
    throw new Error('GPU 合成只接受无 halo 的 8-bit sRGB straight-alpha 瓦片')
  }
  if (tile.rowStride < tile.width * 4 || tile.pixels.byteLength < tile.rowStride * tile.height) throw new Error('GPU 源瓦片像素缓冲区不完整')
}
