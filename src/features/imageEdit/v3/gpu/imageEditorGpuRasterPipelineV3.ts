import { draw, frame, target, type Draw, type Gpu, type Target } from 'vgpu'
import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import layerShaderSource from './shaders/imageEditorGpuRasterLayerV3.wgsl?raw'
import type {
  ImageEditorGpuRasterLayerV3,
  ImageEditorGpuRasterSceneV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import {
  ImageEditorGpuRenderGraphExecutorV3,
  type ImageEditorGpuGraphSourcePlanV3,
} from './imageEditorGpuRenderGraphExecutorV3'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  type ImageEditorGpuSceneTileKeyV3,
} from './imageEditorGpuSceneProtocolV3'
import {
  imageEditorGpuSourceColorUniformV3,
  imageEditorGpuWorkingLinearSourceUniformV3,
  packImageEditorGpuColorMatrixRowsV3,
} from './imageEditorGpuColorPipelineV3'
import {
  type ImageEditorGpuPlannedLayerV3,
  type ImageEditorGpuPlannedTileV3,
} from './imageEditorGpuTilePlannerV3'
import {
  ImageEditorGpuTileAtlasV3,
} from './imageEditorGpuTileAtlasV3'
import {
  assertImageEditorGpuSourceTileV3,
  imageEditorGpuCameraUniformV3,
  imageEditorGpuOutputPixelSizeV3,
  imageEditorGpuRetainedStateKeyV3,
} from './imageEditorGpuRasterSupportV3'
import type {
  ImageEditorGpuRasterCompositorOptionsV3,
  ImageEditorGpuRasterCompositorStatsV3,
  ImageEditorGpuRasterCompositorV3Like,
  ImageEditorGpuRasterFrameV3,
  ImageEditorGpuRasterTextureV3,
} from './imageEditorGpuRasterPipelineContractsV3'
import { ImageEditorGpuRasterPresentationV3 } from './imageEditorGpuRasterPresentationV3'
import { resolveImageEditorGpuEffectViewportV3 } from './imageEditorGpuEffectViewportV3'
import { estimateImageEditorGpuGraphResidentBytesV3 } from './imageEditorGpuMemoryBudgetV3'
import { replanImageEditorGpuViewportTilesV3 } from './imageEditorGpuViewportPlansV3'
import { collectImageEditorGpuRequiredResourceKeysV3, findImageEditorGpuPlannedTileV3,
  pruneImageEditorGpuRetainedStatesV3,
  refreshImageEditorGpuAtlasStatsV3 } from './imageEditorGpuRasterPipelineStateV3'
const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const
const LINEAR_AND_PRESENT_BYTES_PER_PIXEL = 12
type NativeGpuBufferV3 = ReturnType<Gpu['gpu']['createBuffer']>
type NativeGpuBindGroupV3 = ReturnType<Gpu['gpu']['createBindGroup']>
interface RetainedLayerStateV3 {
  buffer: NativeGpuBufferV3
  bindGroup: NativeGpuBindGroupV3
  resource: ImageEditorGpuRasterTextureV3
}
/** 会话级常驻栅格/RenderGraph合成器；优先直呈Surface，失效时才产出ImageBitmap。 */
export class ImageEditorGpuRasterPipelineV3 implements ImageEditorGpuRasterCompositorV3Like {
  private readonly output: Target
  private readonly graph: ImageEditorGpuRenderGraphExecutorV3
  private readonly rasterDraw: Draw
  private readonly presentation: ImageEditorGpuRasterPresentationV3
  private readonly cameraBuffer: NativeGpuBufferV3
  private readonly atlas: ImageEditorGpuTileAtlasV3
  private readonly memoryBudgetBytes: number
  private readonly maxTextureDimension2D: number
  private reservedOutputBytes = LINEAR_AND_PRESENT_BYTES_PER_PIXEL
  private cameraBindGroup: NativeGpuBindGroupV3 | null = null
  private readonly layers = new Map<string, RetainedLayerStateV3>()
  private readonly transientTransforms = new Map<string, ImageEditTransformV3>()
  private readonly plannedLayers = new Map<string, ImageEditorGpuPlannedLayerV3>()
  private readonly plannedMasks = new Map<string, ImageEditorGpuPlannedLayerV3>()
  private readonly previousMips = new Map<string, number>()
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private layout: ImageEditorViewportLayoutV3 | null = null
  private expandEffects = true
  private effectRecipeSize: readonly [number, number] | null = null
  private rasterCompilePromise: Promise<void> | null = null
  private frameQueue: Promise<void> = Promise.resolve()
  private rasterCompiled = false
  private disposed = false
  private reportedError: Error | null = null
  private readonly unsubscribeError: () => void
  private stats: ImageEditorGpuRasterCompositorStatsV3 = {
    uploadCount: 0,
    pipelineCompileCount: 0,
    frameCount: 0,
    diagnosticReadbackCount: 0,
    exportReadbackCount: 0,
    transientUniformUpdateCount: 0,
    residentTileCount: 0,
    atlasPageCount: 0,
    allocatedAtlasBytes: 0,
    minimumPlannedMip: 0,
    maximumPlannedMip: 0,
    surfaceFrameCount: 0,
    imageBitmapFrameCount: 0,
    directSurfaceFailureCount: 0,
  }

  constructor(private readonly gpu: Gpu, options: ImageEditorGpuRasterCompositorOptionsV3 = {}) {
    this.memoryBudgetBytes = options.memoryBudgetBytes
      ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3
    this.maxTextureDimension2D = gpu.gpu.limits.maxTextureDimension2D
    this.atlas = new ImageEditorGpuTileAtlasV3(gpu, {
      memoryBudgetBytes: this.memoryBudgetBytes,
    })
    this.output = target(gpu, {
      size: [1, 1],
      format: 'rgba16float',
      clearColor: CLEAR,
      label: 'image-editor-gpu-raster-linear',
    })
    this.graph = new ImageEditorGpuRenderGraphExecutorV3(gpu, () => {
      this.stats.pipelineCompileCount += 1
    })
    this.rasterDraw = draw(gpu, {
      shader: layerShaderSource,
      blend: 'premultiplied',
      vertices: 3,
      label: 'image-editor-gpu-raster-layer',
    })
    this.presentation = new ImageEditorGpuRasterPresentationV3(gpu, () => {
      this.stats.pipelineCompileCount += 1
    })
    this.cameraBuffer = gpu.gpu.createBuffer({
      size: 48,
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
    this.graph.syncScene(scene)
    this.transientTransforms.clear()
    this.previousMips.clear()
    this.replanTiles()
    pruneImageEditorGpuRetainedStatesV3(this.layers, new Set())
  }
  updateTransientTransform(layerId: string, transform: ImageEditTransformV3 | null): void {
    this.assertUsable()
    if (transform) this.transientTransforms.set(layerId, [...transform])
    else this.transientTransforms.delete(layerId)
    this.graph.updateTransientTransform(layerId, transform)
    this.replanTiles()
    for (const [stateKey, retained] of this.layers) {
      if (!stateKey.startsWith(`${layerId}:`)) continue
      const layer = this.scene?.layers.find((entry) => entry.layerId === layerId)
      const planned = findImageEditorGpuPlannedTileV3(this.plannedLayers, stateKey)
      if (layer && planned) this.writeLayerBuffer(layer, planned, retained.buffer, retained.resource)
    }
    this.stats.transientUniformUpdateCount += 1
  }
  updateViewport(layout: ImageEditorViewportLayoutV3): void {
    this.setViewport(layout, true, null)
  }
  updateExportViewport(
    layout: ImageEditorViewportLayoutV3,
    effectRecipeSize?: readonly [number, number],
  ): void {
    this.setViewport(layout, false, effectRecipeSize ?? null)
  }
  private setViewport(
    layout: ImageEditorViewportLayoutV3,
    expandEffects: boolean,
    effectRecipeSize: readonly [number, number] | null,
  ): void {
    this.assertUsable()
    this.layout = layout
    this.expandEffects = expandEffects
    this.effectRecipeSize = effectRecipeSize
    if (this.scene) {
      this.gpu.gpu.queue.writeBuffer(
        this.cameraBuffer, 0, imageEditorGpuCameraUniformV3(layout, this.scene.geometry),
      )
    }
    const effectViewport = this.scene && expandEffects
      ? resolveImageEditorGpuEffectViewportV3(this.scene, layout)
      : { layout, expanded: false }
    const workingLayout = effectViewport.layout
    const [width, height] = imageEditorGpuOutputPixelSizeV3(workingLayout)
    const cropBytes = effectViewport.expanded
      ? imageEditorGpuOutputPixelSizeV3(layout)[0] * imageEditorGpuOutputPixelSizeV3(layout)[1] * 8
      : 0
    this.reservedOutputBytes = this.scene?.requiresRenderGraph
      ? estimateImageEditorGpuGraphResidentBytesV3(this.scene, [width, height]) + cropBytes
      : width * height * LINEAR_AND_PRESENT_BYTES_PER_PIXEL
    this.atlas.setMemoryBudgetBytes(Math.max(0, this.memoryBudgetBytes - this.reservedOutputBytes))
    this.replanTiles()
  }
  attachPresentationSurface(canvas: OffscreenCanvas, surfaceGeneration: number): void {
    this.assertUsable()
    this.presentation.attachSurface(canvas, surfaceGeneration)
  }
  memoryPressureBytes(): number {
    return Math.max(0, this.reservedOutputBytes + this.atlas.snapshot().allocatedBytes
      - this.memoryBudgetBytes)
  }
  estimatedResidentGpuBytes(): number {
    return this.reservedOutputBytes + this.atlas.snapshot().allocatedBytes
  }
  estimateTileGpuBytes(tile: ImageEditorV3SourceTile): number {
    return this.atlas.estimateTileBytes(tile)
  }
  uploadTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): ImageEditorGpuRasterTextureV3 {
    this.assertUsable()
    assertImageEditorGpuSourceTileV3(key, tile)
    const allocation = this.atlas.upload(key, tile)
    this.stats.uploadCount += 1
    this.refreshAtlasStats()
    return allocation
  }
  requiredResourceKeys(layerId?: string): readonly ImageEditorGpuSceneTileKeyV3[] {
    return collectImageEditorGpuRequiredResourceKeysV3(
      this.plannedLayers, this.plannedMasks, layerId,
    )
  }
  missingResources(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
  ): ImageEditorGpuSceneTileKeyV3[] {
    return this.requiredResourceKeys().filter((key) => !resolve(key))
  }
  async render(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
    surfaceGeneration: number,
    acceptsSurfaceSubmit: () => boolean,
  ): Promise<ImageEditorGpuRasterFrameV3> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve, false)
      this.reportedError = null
      const presentation = await this.presentation.render(
        output,
        this.scene!.color,
        surfaceGeneration,
        acceptsSurfaceSubmit,
      )
      // 呈现器已分别等待并收口 direct / bitmap pass 的异步错误；direct 失败后允许
      // 同一帧进入 ImageBitmap，不能让已处理的 Surface 错误污染成功降级结果。
      this.reportedError = null
      if (presentation.kind === 'webgpu-surface') this.stats.surfaceFrameCount += 1
      else {
        this.stats.imageBitmapFrameCount += 1
        if (presentation.surfaceFailureReason) this.stats.directSurfaceFailureCount += 1
      }
      const stats = this.snapshotStats()
      const usedResourceKeys = this.requiredResourceKeys()
      return presentation.kind === 'webgpu-surface'
        ? { presentation, stats, usedResourceKeys }
        : { presentation, stats, usedResourceKeys }
    })
  }
  async readLinearPixelsForTest(resolve: (
    key: ImageEditorGpuSceneTileKeyV3,
  ) => ImageEditorGpuRasterTextureV3 | null): Promise<Float32Array> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve)
      this.stats.diagnosticReadbackCount += 1
      return await output.readFloats()
    })
  }
  async readExportLinearPixels(resolve: (
    key: ImageEditorGpuSceneTileKeyV3,
  ) => ImageEditorGpuRasterTextureV3 | null): Promise<Float32Array> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve)
      this.stats.exportReadbackCount = (this.stats.exportReadbackCount ?? 0) + 1
      return await output.readFloats()
    })
  }
  async renderExportTarget(resolve: (
    key: ImageEditorGpuSceneTileKeyV3,
  ) => ImageEditorGpuRasterTextureV3 | null): Promise<Target> {
    return await this.enqueueFrame(async () => await this.compose(resolve))
  }
  async readPresentedPixelsForTest(resolve: (
    key: ImageEditorGpuSceneTileKeyV3,
  ) => ImageEditorGpuRasterTextureV3 | null): Promise<Uint8Array> {
    return await this.enqueueFrame(async () => {
      const output = await this.compose(resolve)
      this.stats.diagnosticReadbackCount += 1
      return await this.presentation.readPixels(output, this.scene!.color)
    })
  }
  snapshotStats(): ImageEditorGpuRasterCompositorStatsV3 {
    this.refreshAtlasStats()
    const graph = this.graph.snapshotStats()
    return {
      ...this.stats,
      renderedGraphNodeCount: graph.renderedNodeCount,
      graphCacheHitCount: graph.cacheHitCount,
      invalidatedGraphNodeCount: graph.invalidatedNodeCount,
      fusedAdjustmentCount: graph.fusedAdjustmentCount,
      maximumGraphTargetWidth: graph.maximumTargetWidth,
      maximumGraphTargetHeight: graph.maximumTargetHeight,
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeError()
    this.graph.dispose()
    for (const state of this.layers.values()) state.buffer.destroy()
    this.layers.clear()
    this.cameraBuffer.destroy()
    this.presentation.dispose()
    this.atlas.dispose()
    this.output.color.destroy()
  }
  private async compose(resolve: (
    key: ImageEditorGpuSceneTileKeyV3,
  ) => ImageEditorGpuRasterTextureV3 | null, awaitCompletion = true): Promise<Target> {
    this.assertUsable()
    if (!this.scene || !this.layout) throw new Error('GPU Scene 缺少场景或视口')
    const missing = this.missingResources(resolve)
    if (missing.length > 0) throw new Error(`GPU Scene 缺少 ${missing.length} 个源纹理`)
    const effectViewport = this.expandEffects
      ? resolveImageEditorGpuEffectViewportV3(this.scene, this.layout)
      : { layout: this.layout, cropOffset: [0, 0] as const, expanded: false }
    const [width, height] = imageEditorGpuOutputPixelSizeV3(effectViewport.layout)
    if (width > this.maxTextureDimension2D || height > this.maxTextureDimension2D) {
      throw new Error(`GPU Scene 输出 ${width}×${height} 超过设备 2D 纹理限制`)
    }
    if (this.memoryPressureBytes() > 0) {
      throw new Error('GPU Scene 合成目标与 atlas 超出会话显存预算')
    }
    if (this.scene.requiresRenderGraph) {
      pruneImageEditorGpuRetainedStatesV3(this.layers, new Set())
      const sourcePlans = new Map<string, ImageEditorGpuGraphSourcePlanV3>()
      for (const [layerId, plan] of this.plannedLayers) {
        sourcePlans.set(layerId, {
          plan,
          resources: plan.tiles.map((tile) => resolve(tile.key)!),
        })
      }
      const maskPlans = new Map<string, ImageEditorGpuGraphSourcePlanV3>()
      for (const [maskId, plan] of this.plannedMasks) {
        maskPlans.set(maskId, { plan, resources: plan.tiles.map((tile) => resolve(tile.key)!) })
      }
      this.reportedError = null
      const output = await this.graph.execute(
        resolve, sourcePlans, maskPlans, effectViewport.layout, this.layout,
        effectViewport.cropOffset, this.effectRecipeSize ?? undefined, awaitCompletion,
      )
      if (!output) throw new Error('GPU RenderGraph 没有可呈现输出')
      if (awaitCompletion) {
        await this.gpu.settled()
        this.throwReportedError()
      }
      this.stats.frameCount += 1
      return output
    }
    if (this.output.size[0] !== width || this.output.size[1] !== height) {
      this.output.resize([width, height])
    }
    await this.ensureRasterCompiled()
    this.rasterDraw.group(1, this.cameraBindGroup!)
    const ordered: Array<{ layer: ImageEditorGpuRasterLayerV3; state: RetainedLayerStateV3 }> = []
    const activeStates = new Set<string>()
    for (const layer of this.scene.layers) {
      if (!layer.visible || layer.opacity <= 0) continue
      const plan = this.plannedLayers.get(layer.layerId)
      if (!plan) continue
      for (const tile of plan.tiles) {
        const resource = resolve(tile.key)!
        const stateKey = imageEditorGpuRetainedStateKeyV3(layer.layerId, tile.key)
        activeStates.add(stateKey)
        ordered.push({ layer, state: this.ensureLayerState(stateKey, layer, tile, resource) })
      }
    }
    pruneImageEditorGpuRetainedStatesV3(this.layers, activeStates)
    this.reportedError = null
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: this.output, clear: CLEAR }, (pass) => {
        for (const entry of ordered) {
          this.rasterDraw.group(0, entry.state.bindGroup)
          pass.draw(this.rasterDraw)
        }
      })
    })
    if (awaitCompletion) {
      await submitted.done
      await this.gpu.settled()
      this.throwReportedError()
    }
    this.stats.frameCount += 1
    return this.output
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
    stateKey: string,
    layer: ImageEditorGpuRasterLayerV3,
    plannedTile: ImageEditorGpuPlannedTileV3,
    resource: ImageEditorGpuRasterTextureV3,
  ): RetainedLayerStateV3 {
    const existing = this.layers.get(stateKey)
    if (existing?.resource === resource) {
      this.writeLayerBuffer(layer, plannedTile, existing.buffer, resource)
      return existing
    }
    existing?.buffer.destroy()
    const buffer = this.gpu.gpu.createBuffer({
      size: 128,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      label: `image-editor-gpu-raster-tile:${layer.layerId}`,
    })
    const bindGroup = this.gpu.gpu.createBindGroup({
      layout: this.rasterDraw.layout(0),
      entries: [
        { binding: 0, resource: resource.textureView },
        { binding: 1, resource: { buffer } },
      ],
    })
    const state = { buffer, bindGroup, resource }
    this.layers.set(stateKey, state)
    this.writeLayerBuffer(layer, plannedTile, buffer, resource)
    return state
  }
  private writeLayerBuffer(
    layer: ImageEditorGpuRasterLayerV3,
    plannedTile: ImageEditorGpuPlannedTileV3,
    buffer: NativeGpuBufferV3,
    resource: ImageEditorGpuRasterTextureV3,
  ): void {
    const inverse = invertImageEditTransformV3(this.resolveTransform(layer))
    const scene = this.scene
    if (!scene) return
    const color = plannedTile.key.format === 'rgba16float'
      ? imageEditorGpuWorkingLinearSourceUniformV3(scene.color)
      : imageEditorGpuSourceColorUniformV3(resource.tile, scene.color)
    const matrix = packImageEditorGpuColorMatrixRowsV3(color.sourceToWorking)
    this.gpu.gpu.queue.writeBuffer(buffer, 0, new Float32Array([
      inverse[0], inverse[1], inverse[2], inverse[3],
      inverse[4], inverse[5], layer.opacity, 0,
      resource.tile.originX, resource.tile.originY, 2 ** plannedTile.key.mip, resource.atlasLayer,
      resource.tile.width, resource.tile.height, color.transferCode, color.referenceWhiteNits,
      plannedTile.coreOriginX, plannedTile.coreOriginY, plannedTile.coreWidth, plannedTile.coreHeight,
      ...matrix,
    ]))
  }
  private resolveTransform(layer: ImageEditorGpuRasterLayerV3): ImageEditTransformV3 {
    return this.transientTransforms.get(layer.layerId) ?? layer.transform
  }
  private replanTiles(): void {
    replanImageEditorGpuViewportTilesV3({
      scene: this.scene, layout: this.layout, transientTransforms: this.transientTransforms,
      previousMips: this.previousMips, plannedLayers: this.plannedLayers,
      plannedMasks: this.plannedMasks,
      expandEffects: this.expandEffects,
    })
  }
  private refreshAtlasStats(): void {
    refreshImageEditorGpuAtlasStatsV3(this.stats, this.atlas.snapshot(), this.plannedLayers)
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
