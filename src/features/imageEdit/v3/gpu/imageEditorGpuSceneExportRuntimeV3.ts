import {
  IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  createFloat32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3'
import { encodeImageEditorV3RenderedOutputTile } from '../export/outputTile'
import type { ImageEditorGpuRasterCompositorV3Like, ImageEditorGpuRasterTextureV3 } from './imageEditorGpuRasterPipelineContractsV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneExportRequestV3,
  type ImageEditorGpuSceneExportTilePlanV3,
  type ImageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneUploadTileV3,
  type ImageEditorGpuSceneWorkerEventV3,
} from './imageEditorGpuSceneProtocolV3'
import type { Target } from 'vgpu'
import {
  cropImageEditorGpuExportCoreV3 as cropCore,
  imageEditorGpuExportAbortErrorV3 as abortError,
  imageEditorGpuExportExactBufferV3 as exactBuffer,
  imageEditorGpuExportFullAnalysisLayoutV3 as fullAnalysisLayout,
  imageEditorGpuExportLayoutV3 as exportLayout,
  imageEditorGpuExportOutputRectV3 as outputRect,
  imageEditorGpuExportOverlapPatchesV3 as overlapPatches,
  imageEditorGpuExportRenderRectV3 as renderRect,
  maximumImageEditorGpuExportTileDimensionsV3 as maximumTileDimensions,
  scaleImageEditorGpuExportTilePlanV3 as scaleTilePlan,
  type ImageEditorGpuExportRectV3 as ExportRectV3,
} from './imageEditorGpuSceneExportGeometryV3'

interface ImageEditorGpuExportResidualV3Like {
  clone(source: Target, label: string): Promise<Target>
  read(localFull: Target, globalLow: Target, localLow: Target,
    region: readonly [number, number, number, number]): Promise<Float32Array>
  beginOverlapAdd(globalLow: Target, core: ExportRectV3,
    outputSize: readonly [number, number]): Promise<void>
  accumulatePatch(localFull: Target, localLow: Target, core: ExportRectV3,
    patchRender: ExportRectV3, patchCore: ExportRectV3,
    outputSize: readonly [number, number], tileSize: readonly [number, number]): Promise<void>
  readOverlapAdd(): Promise<Float32Array>
  dispose(): void
}


interface ExportJobV3 {
  request: ImageEditorGpuSceneExportRequestV3
  compositor: ImageEditorGpuRasterCompositorV3Like
  resources: Map<string, ImageEditorGpuRasterTextureV3>
  cancelled: boolean
  resourceWake: (() => void) | null
  consumedWake: (() => void) | null
  awaitingTile: readonly [number, number] | null
  residual: ImageEditorGpuExportResidualV3Like | null
  readbackCount: number
  extraResidentBytes: number
  residualTargetBytes: number
  retainedTargets: Set<Target>
}

interface ImageEditorGpuSceneExportRuntimeOptionsV3 {
  emit: (event: ImageEditorGpuSceneWorkerEventV3, transfer?: Transferable[]) => void
  createCompositor: (memoryBudgetBytes: number) => ImageEditorGpuRasterCompositorV3Like
  createResidual?: () => ImageEditorGpuExportResidualV3Like
  previewCompositor: () => ImageEditorGpuRasterCompositorV3Like | null
  previewResource: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null
  currentSceneGeneration: () => number
  deviceGeneration: () => number
  sessionBudgetBytes?: number
}

/**
 * 同一 Scene Worker/vGPU Context 内的导出 job。导出 compositor 与预览状态隔离，但
 * admission 始终扣除预览真实常驻量；命中的 source key 直接复用预览 atlas allocation。
 */
export class ImageEditorGpuSceneExportRuntimeV3 {
  private active: ExportJobV3 | null = null

  constructor(private readonly options: ImageEditorGpuSceneExportRuntimeOptionsV3) {}

  start(request: ImageEditorGpuSceneExportRequestV3, scene: ImageEditorGpuRasterSceneV3): void {
    this.cancelAll()
    const previewBytes = this.previewResidentBytes()
    const total = this.options.sessionBudgetBytes ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3
    const available = Math.max(1, total - previewBytes)
    const compositor = this.options.createCompositor(available)
    compositor.syncScene(scene)
    const job: ExportJobV3 = {
      request,
      compositor,
      resources: new Map(),
      cancelled: false,
      resourceWake: null,
      consumedWake: null,
      awaitingTile: null,
      residual: request.multiscaleAnalysis ? this.options.createResidual?.() ?? null : null,
      readbackCount: 0,
      extraResidentBytes: 0,
      residualTargetBytes: 0,
      retainedTargets: new Set(),
    }
    this.active = job
    void this.run(job, scene).catch((error) => {
      if (!job.cancelled && this.isCurrent(job)) {
        this.options.emit({
          type: 'failed',
          sceneGeneration: request.sceneGeneration,
          deviceGeneration: this.options.deviceGeneration(),
          requestId: request.requestId,
          code: 'export-not-ready',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        })
      }
    }).finally(() => this.release(job))
  }

  upload(requestId: string, tiles: readonly ImageEditorGpuSceneUploadTileV3[]): void {
    const job = this.active
    if (!job || job.request.requestId !== requestId || job.cancelled) return
    try {
      for (const entry of tiles) {
        const id = imageEditorGpuSceneTileKeyV3(entry.key)
        if (job.resources.has(id) || this.options.previewResource(entry.key)) continue
        const payload = job.compositor.uploadTile(entry.key, entry.tile)
        job.resources.set(id, payload)
        try {
          this.assertSharedBudget(job)
        } catch (error) {
          job.resources.delete(id)
          payload.destroy()
          throw error
        }
      }
    } catch (error) {
      this.options.emit({
        type: 'failed', sceneGeneration: job.request.sceneGeneration,
        deviceGeneration: this.options.deviceGeneration(), requestId,
        code: 'export-not-ready',
        message: error instanceof Error ? error.message : String(error), recoverable: true,
      })
      this.cancelAll()
      return
    }
    job.resourceWake?.()
    job.resourceWake = null
  }

  acknowledge(requestId: string, tileX: number, tileY: number): void {
    const job = this.active
    if (!job || job.request.requestId !== requestId
      || job.awaitingTile?.[0] !== tileX || job.awaitingTile[1] !== tileY) return
    job.awaitingTile = null
    job.consumedWake?.()
    job.consumedWake = null
  }

  cancel(requestId: string): void {
    if (this.active?.request.requestId !== requestId) return
    this.cancelAll()
  }

  cancelAll(): void {
    const job = this.active
    if (!job) return
    job.cancelled = true
    job.resourceWake?.()
    job.consumedWake?.()
    job.resourceWake = null
    job.consumedWake = null
    this.active = null
  }

  activeResidentGpuBytes(): number {
    const job = this.active
    return job ? (job.compositor.estimatedResidentGpuBytes?.() ?? 0) + job.extraResidentBytes : 0
  }

  private async run(job: ExportJobV3, scene: ImageEditorGpuRasterSceneV3): Promise<void> {
    const tiles = job.request.outputTiles
    const globalLow = await this.prepareGlobalAnalysis(job, scene)
    for (let index = 0; index < tiles.length; index += 1) {
      this.assertCurrent(job)
      const plan = tiles[index]!
      job.compositor.updateExportViewport?.(
        exportLayout(job.request.requestId, plan, scene, job.request.description.width),
        [job.request.description.width, job.request.description.height],
      )
      await this.waitForResources(job, job.compositor)
      this.assertSharedBudget(job)
      const core = globalLow
        ? await this.renderMultiscaleTile(job, scene, plan, globalLow)
        : cropCore(await this.readDirectTile(job), plan)
      job.readbackCount += 1
      this.assertCurrent(job)
      const linear = createFloat32PremultipliedRgbaTile(
        plan.width,
        plan.height,
        'linear-light',
        core,
        scene.color.workingSpace,
        scene.color.transferFunction,
        scene.color.hdrMetadata?.referenceWhiteNits ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
      )
      const encoded = encodeImageEditorV3RenderedOutputTile(
        linear,
        { x: plan.x, y: plan.y, width: plan.width, height: plan.height },
        job.request.description,
      )
      const pixels = exactBuffer(encoded.pixels)
      const stats = job.compositor.snapshotStats()
      const previewResidentBytes = this.previewResidentBytes()
      const sharedResidentBytes = previewResidentBytes
        + (job.compositor.estimatedResidentGpuBytes?.() ?? 0) + job.extraResidentBytes
      const consumed = new Promise<void>((resolve) => { job.consumedWake = resolve })
      job.awaitingTile = [plan.tileX, plan.tileY]
      this.options.emit({
        type: 'export-tile',
        sceneGeneration: job.request.sceneGeneration,
        deviceGeneration: this.options.deviceGeneration(),
        requestId: job.request.requestId,
        tileX: plan.tileX,
        tileY: plan.tileY,
        x: plan.x,
        y: plan.y,
        width: plan.width,
        height: plan.height,
        rowStride: encoded.rowStride,
        pixels,
        completed: index === tiles.length - 1,
        diagnostics: {
          readbackCount: job.readbackCount,
          maximumTargetWidth: Math.max(stats.maximumGraphTargetWidth ?? 0, plan.renderWidth),
          maximumTargetHeight: Math.max(stats.maximumGraphTargetHeight ?? 0, plan.renderHeight),
          residentTileCount: stats.residentTileCount,
          allocatedAtlasBytes: stats.allocatedAtlasBytes,
          previewResidentBytes,
          sharedResidentBytes,
        },
      }, [pixels])
      await consumed
      this.assertCurrent(job)
      this.releaseLocalResources(job)
    }
    if (globalLow) {
      job.retainedTargets.delete(globalLow)
      globalLow.color.destroy()
      job.extraResidentBytes -= globalLow.size[0] * globalLow.size[1] * 8
    }
  }

  private async waitForResources(
    job: ExportJobV3,
    compositor: ImageEditorGpuRasterCompositorV3Like,
  ): Promise<void> {
    for (;;) {
      this.assertCurrent(job)
      const missing = compositor.missingResources((key) => this.resolve(job, key))
      if (missing.length === 0) return
      const uploaded = new Promise<void>((resolve) => { job.resourceWake = resolve })
      this.options.emit({
        type: 'tiles-needed',
        sceneGeneration: job.request.sceneGeneration,
        deviceGeneration: this.options.deviceGeneration(),
        exportRequestId: job.request.requestId,
        keys: missing,
      })
      await uploaded
    }
  }

  private async prepareGlobalAnalysis(
    job: ExportJobV3,
    scene: ImageEditorGpuRasterSceneV3,
  ): Promise<Target | null> {
    const analysis = job.request.multiscaleAnalysis
    const residual = job.residual
    if (!analysis) return null
    if (!residual) throw new Error('GPU Scene 缺少有界多尺度残差合成器')
    const bytes = analysis.width * analysis.height * 8
    const available = Math.max(1, this.totalBudgetBytes() - this.previewResidentBytes()
      - (job.compositor.estimatedResidentGpuBytes?.() ?? 0) - bytes)
    const compositor = this.options.createCompositor(available)
    try {
      compositor.syncScene(scene)
      compositor.updateExportViewport?.(fullAnalysisLayout(job.request.requestId, analysis, scene))
      await this.waitForResources(job, compositor)
      this.assertCompositorBudget(job, compositor, bytes)
      const target = await this.renderTarget(compositor, job)
      const cloned = await residual.clone(target, 'image-editor-export-global-analysis')
      job.retainedTargets.add(cloned)
      job.extraResidentBytes += bytes
      this.assertSharedBudget(job)
      return cloned
    } finally {
      compositor.dispose()
    }
  }

  private async renderMultiscaleTile(
    job: ExportJobV3,
    scene: ImageEditorGpuRasterSceneV3,
    plan: ImageEditorGpuSceneExportTilePlanV3,
    globalLow: Target,
  ): Promise<Float32Array> {
    const analysis = job.request.multiscaleAnalysis!
    const residual = job.residual!
    const outputSize = [job.request.description.width, job.request.description.height] as const
    const tileSize = maximumTileDimensions(job.request.outputTiles)
    const residualBytes = plan.width * plan.height * 16 * 2
    if (residualBytes > job.residualTargetBytes) {
      this.assertSharedBudget(job, residualBytes - job.residualTargetBytes)
      job.extraResidentBytes += residualBytes - job.residualTargetBytes
      job.residualTargetBytes = residualBytes
    }
    await residual.beginOverlapAdd(globalLow, outputRect(plan), outputSize)
    try {
      for (const patch of overlapPatches(job.request.outputTiles, plan)) {
        await this.accumulatePatch(job, scene, plan, patch, analysis, outputSize, tileSize)
      }
      return await residual.readOverlapAdd()
    } finally {
      job.compositor.updateExportViewport?.(
        exportLayout(job.request.requestId, plan, scene, job.request.description.width),
        outputSize,
      )
    }
  }

  private async accumulatePatch(
    job: ExportJobV3,
    scene: ImageEditorGpuRasterSceneV3,
    core: ImageEditorGpuSceneExportTilePlanV3,
    patch: ImageEditorGpuSceneExportTilePlanV3,
    analysis: NonNullable<ImageEditorGpuSceneExportRequestV3['multiscaleAnalysis']>,
    outputSize: readonly [number, number],
    tileSize: readonly [number, number],
  ): Promise<void> {
    const residual = job.residual!
    job.compositor.updateExportViewport?.(
      exportLayout(job.request.requestId, patch, scene, outputSize[0]), outputSize,
    )
    await this.waitForResources(job, job.compositor)
    const highTarget = await this.renderTarget(job.compositor, job)
    const highBytes = highTarget.size[0] * highTarget.size[1] * 8
    this.assertSharedBudget(job, highBytes * 2)
    const high = await residual.clone(highTarget, 'image-editor-export-overlap-full')
    job.extraResidentBytes += highBytes
    const lowPlan = scaleTilePlan(patch, job.request.description, analysis)
    job.compositor.updateExportViewport?.(
      exportLayout(job.request.requestId, lowPlan, scene, analysis.width),
      [analysis.width, analysis.height],
    )
    await this.waitForResources(job, job.compositor)
    const lowTarget = await this.renderTarget(job.compositor, job)
    const lowBytes = lowTarget.size[0] * lowTarget.size[1] * 8
    this.assertSharedBudget(job, lowBytes)
    const low = await residual.clone(lowTarget, 'image-editor-export-overlap-analysis')
    job.extraResidentBytes += lowBytes
    try {
      await residual.accumulatePatch(high, low, outputRect(core), renderRect(patch),
        outputRect(patch), outputSize, tileSize)
    } finally {
      high.color.destroy()
      low.color.destroy()
      job.extraResidentBytes -= highBytes + lowBytes
    }
  }

  private async readDirectTile(job: ExportJobV3): Promise<Float32Array> {
    if (!job.compositor.readExportLinearPixels) throw new Error('GPU Scene compositor 未实现导出回读')
    return await job.compositor.readExportLinearPixels((key) => this.resolve(job, key))
  }

  private async renderTarget(
    compositor: ImageEditorGpuRasterCompositorV3Like,
    job: ExportJobV3,
  ): Promise<Target> {
    if (!compositor.renderExportTarget) throw new Error('GPU Scene compositor 未实现多尺度 Target 导出')
    return await compositor.renderExportTarget((key) => this.resolve(job, key)) as Target
  }

  private resolve(job: ExportJobV3, key: ImageEditorGpuSceneTileKeyV3): ImageEditorGpuRasterTextureV3 | null {
    return this.options.previewResource(key)
      ?? job.resources.get(imageEditorGpuSceneTileKeyV3(key))
      ?? null
  }

  private assertSharedBudget(job: ExportJobV3, additionalBytes = 0): void {
    const total = this.totalBudgetBytes()
    const exportBytes = job.compositor.estimatedResidentGpuBytes?.() ?? 0
    if (this.previewResidentBytes() + exportBytes + job.extraResidentBytes + additionalBytes > total
      || job.compositor.memoryPressureBytes() > 0) {
      throw new Error('GPU Scene 预览与导出常驻资源超过共享 256 MiB 会话预算')
    }
  }

  private assertCompositorBudget(
    job: ExportJobV3,
    compositor: ImageEditorGpuRasterCompositorV3Like,
    reservedBytes: number,
  ): void {
    const used = compositor.estimatedResidentGpuBytes?.() ?? 0
    if (this.previewResidentBytes() + used + reservedBytes > this.totalBudgetBytes()
      || compositor.memoryPressureBytes() > 0) {
      throw new Error('GPU Scene 全局分析超过共享 256 MiB 会话预算')
    }
    this.assertCurrent(job)
  }

  private totalBudgetBytes(): number {
    return this.options.sessionBudgetBytes ?? IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3
  }

  private previewResidentBytes(): number {
    return this.options.previewCompositor()?.estimatedResidentGpuBytes?.() ?? 0
  }

  private isCurrent(job: ExportJobV3): boolean {
    return !job.cancelled
      && this.active === job
      && job.request.sceneGeneration === this.options.currentSceneGeneration()
  }

  private assertCurrent(job: ExportJobV3): void {
    if (!this.isCurrent(job)) throw abortError()
  }

  private releaseLocalResources(job: ExportJobV3): void {
    for (const value of job.resources.values()) value.destroy()
    job.resources.clear()
  }

  private release(job: ExportJobV3): void {
    if (this.active === job) this.active = null
    this.releaseLocalResources(job)
    for (const target of job.retainedTargets) target.color.destroy()
    job.retainedTargets.clear()
    job.residual?.dispose()
    job.compositor.dispose()
  }
}
