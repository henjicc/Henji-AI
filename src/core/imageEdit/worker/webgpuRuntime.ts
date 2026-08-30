import baselineShaderSource from './baseline.wgsl?raw'
import type { DiffusionRecipe } from '../diffusionRecipe'
import {
  rebaseVgpuGlowRecipeForScale,
  type VgpuGlowRecipe,
} from '../vgpuGlowRecipe'
import {
  createRenderPipelineChecked,
  createShaderModuleChecked,
  ImageEditWebGpuDeviceManager,
} from '../webgpu/deviceManager'
import {
  WebGpuDiffusionRenderer,
  type DiffusionRenderInput,
  type DiffusionScatterPyramid,
} from '../webgpu/diffusionRenderer'
import {
  rebaseDiffusionRecipeForScale,
  rebaseDiffusionRecipeForTile,
  renderDiffusionExport,
} from '../webgpu/exportRenderer'
import {
  createImageEditExportPlan,
  fitWithinPixelBudget,
  IMAGE_EDIT_PREVIEW_MAX_PIXELS,
} from './exportPrototype'
import {
  VgpuGlowRenderer,
  type VgpuGlowGlobalScatter,
} from '../webgpu/vgpuGlowRenderer'
import { collectRelevantGpuLimits } from './webgpuCapabilities'
import type {
  ImageEditExportFormat,
  ImageEditWorkerComposition,
  ImageEditWorkerCapabilities,
  ImageEditWorkerInitializationFailure,
  ImageEditWorkerInitializationFailureCode,
  ImageEditWorkerSource,
} from './protocol'
import { drawMarkItems } from '@/features/imageMark/render/drawMarks'
import { createImageEditCanvas } from '@/features/imageMark/render/canvasAdapter'
import { renderOrientedImage } from '@/features/imageMark/render/orientedImage'
import { clampCropRect } from '@/features/imageMark/domain/geometry'
import {
  createViewportBuffer,
  decodeSource,
  getWebGpuContext,
  renderPass,
  unavailableCapabilities,
  type GpuAdapter,
  type GpuCanvasContext,
  type GpuDevice,
  type GpuProvider,
  type GpuRenderPipeline,
  type GpuTexture,
} from './webgpuRuntimeSupport'

const TEXTURE_COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const TEXTURE_RENDER_ATTACHMENT = 0x10

interface RuntimeState {
  provider: GpuProvider
  adapter: GpuAdapter
  device: GpuDevice
  sampler: unknown
  linearizePipeline: GpuRenderPipeline
  encodePipeline: GpuRenderPipeline
  diffusionRenderer: WebGpuDiffusionRenderer
  vgpuGlowRenderer: VgpuGlowRenderer | null
  vgpuGlowRendererInitialization: Promise<VgpuGlowRenderer> | null
  canvasFormat: string
}

class WorkerWebGpuInitializationError extends Error {
  constructor(readonly failure: ImageEditWorkerInitializationFailure) {
    super(failure.detail)
    this.name = 'WorkerWebGpuInitializationError'
  }
}

export interface WebGpuExportOptions {
  format: ImageEditExportFormat
  quality?: number
  tileSize?: number
  halo?: number
  globalScatterMaxDimension?: number
  recipe?: DiffusionRecipe
  vgpuGlowRecipe?: VgpuGlowRecipe
  composition?: ImageEditWorkerComposition
  isCancelled: () => boolean
  onProgress: (completedTiles: number, totalTiles: number) => void
}

export class WorkerWebGpuRuntime {
  private state: RuntimeState | null = null
  private readonly deviceManager = new ImageEditWebGpuDeviceManager()
  private deviceLostHandler: ((reason: string) => void) | null = null
  private cachedUrlSource: { url: string; bitmap: ImageBitmap } | null = null

  constructor() {
    this.deviceManager.onDeviceLost((reason) => {
      if (this.state) this.destroyRuntimeState(this.state)
      this.state = null
      this.deviceLostHandler?.(reason)
    })
  }

  onDeviceLost(handler: (reason: string) => void): void {
    this.deviceLostHandler = handler
  }

  async initialize(): Promise<ImageEditWorkerCapabilities> {
    try {
      this.disposeState()
      const state = await this.createState()
      this.state = state
      return this.describeCapabilities(state)
    } catch (error) {
      return unavailableCapabilities(describeInitializationFailure(error))
    }
  }

  async renderPreview(
    source: ImageEditWorkerSource,
    maxPixels = IMAGE_EDIT_PREVIEW_MAX_PIXELS,
    recipe?: DiffusionRecipe,
    vgpuGlowRecipe?: VgpuGlowRecipe,
    composition?: ImageEditWorkerComposition,
    cacheKey?: string,
    isCancelled?: () => boolean
  ): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
    const state = await this.ensureState()
    const decoded = await this.acquireSource(source)
    try {
      // 预览的所有 GPU 输入都必须先落在预算内。仅缩小最终 Canvas 会让超大原图仍被
      // 上传为一张全尺寸 source texture，既拖慢调参，也会不必要地占用显存。
      const previewSource = await createPreviewBitmap(decoded.bitmap, maxPixels)
      try {
        const composed = this.applyOrientation(previewSource.bitmap, composition)
        try {
        const sourceCacheKey = `${cacheKey ?? (source.kind === 'url' ? `url:${source.url}` : `blob:${Date.now()}`)}:${orientationCacheKey(composition)}`
        if (vgpuGlowRecipe) {
          const previewRecipe = rebaseVgpuGlowRecipeForScale(
            vgpuGlowRecipe,
            composed.bitmap.width,
            composed.bitmap.height
          )
          const bitmap = await this.renderVgpuGlowBitmap(
            state,
            composed.bitmap,
            composed.bitmap.width,
            composed.bitmap.height,
            previewRecipe,
            isCancelled
          )
          return {
            bitmap,
            width: composed.bitmap.width,
            height: composed.bitmap.height,
          }
        }
        if (recipe) {
          const bitmap = await this.renderDiffusionBitmap(
            state,
            composed.bitmap,
            composed.bitmap.width,
            composed.bitmap.height,
            recipe,
            sourceCacheKey,
            isCancelled
          )
          return {
            bitmap,
            width: composed.bitmap.width,
            height: composed.bitmap.height,
          }
        }
        const intermediate = await this.createIntermediate(
          state,
          composed.bitmap,
          composed.bitmap.width,
          composed.bitmap.height
        )
        try {
          const canvas = new OffscreenCanvas(composed.bitmap.width, composed.bitmap.height)
          const context = getWebGpuContext(canvas)
          await this.renderToCanvas(state, intermediate, context, { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 })
          return {
            bitmap: canvas.transferToImageBitmap(),
            width: composed.bitmap.width,
            height: composed.bitmap.height,
          }
        } finally {
          intermediate.destroy()
        }
        } finally {
          if (composed.owned) composed.bitmap.close()
        }
      } finally {
        if (previewSource.owned) previewSource.bitmap.close()
      }
    } finally {
      if (decoded.owned) decoded.bitmap.close()
    }
  }

  async exportImage(
    source: ImageEditWorkerSource,
    options: WebGpuExportOptions
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const state = await this.ensureState()
    const decoded = await this.acquireSource(source)
    try {
      const composed = this.applyOrientation(decoded.bitmap, options.composition)
      try {
        if (options.vgpuGlowRecipe) {
          return await this.exportVgpuGlow(
            state,
            composed.bitmap,
            options,
            options.vgpuGlowRecipe
          )
        }
        const recipe = options.recipe
        if (!recipe) throw new Error('柔光导出请求缺少共享执行配方')
        const exportSourceKey = source.kind === 'url'
          ? `url:${source.url}`
          : `blob-export:${Date.now()}`
        let globalScatter: DiffusionScatterPyramid | null = null
        return await renderDiffusionExport({
        width: composed.bitmap.width,
        height: composed.bitmap.height,
        recipe,
        format: options.format,
        quality: options.quality,
        tileSize: options.tileSize,
        halo: options.halo,
        globalScatterMaxDimension: options.globalScatterMaxDimension,
        maxTextureDimension: state.adapter.limits?.maxTextureDimension2D,
        isCancelled: options.isCancelled,
        onProgress: options.onProgress,
        renderGlobal: async (width, height) => {
          const resized = await createImageBitmap(composed.bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          })
          try {
            return await this.renderDiffusionBitmap(
              state,
              resized,
              width,
              height,
              recipe,
              `${exportSourceKey}:${orientationCacheKey(options.composition)}:global:${width}x${height}`,
              options.isCancelled
            )
          } finally {
            resized.close()
          }
        },
        buildGlobalScatter: async (width, height) => {
          const resized = await createImageBitmap(composed.bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          })
          try {
            // 散射尺度按比例定义，所以在降采样后的整图上重新编译一遍配方，
            // 得到的是同一组归一化尺度。
            const pyramid = await state.diffusionRenderer.buildScatterPyramid({
              width,
              height,
              recipe: rebaseDiffusionRecipeForScale(recipe, width, height),
              isCancelled: options.isCancelled,
              createLinearBase: async () =>
                await this.createIntermediate(state, resized, width, height),
            })
            globalScatter = pyramid
            return { release: () => { globalScatter = null; pyramid.release() } }
          } finally {
            resized.close()
          }
        },
        renderTile: async (tile) => {
          const tileBitmap = await createImageBitmap(
            composed.bitmap,
            tile.expandedX,
            tile.expandedY,
            tile.expandedWidth,
            tile.expandedHeight
          )
          try {
            return await this.renderDiffusionBitmap(
              state,
              tileBitmap,
              tile.expandedWidth,
              tile.expandedHeight,
              rebaseDiffusionRecipeForTile(
                recipe,
                tile.expandedWidth,
                tile.expandedHeight
              ),
              `${exportSourceKey}:${orientationCacheKey(options.composition)}:tile:${tile.index}`,
              options.isCancelled,
              globalScatter
                ? { pyramid: globalScatter, region: tile.scatterRegion }
                : undefined
            )
          } finally {
            tileBitmap.close()
          }
        },
        postProcess: async (canvas) => this.applyAnnotationsAndCrop(canvas, options.composition),
        })
      } finally {
        if (composed.owned) composed.bitmap.close()
      }
    } finally {
      if (decoded.owned) decoded.bitmap.close()
    }
  }

  private applyOrientation(
    bitmap: ImageBitmap,
    composition: ImageEditWorkerComposition | undefined
  ): { bitmap: ImageBitmap; owned: boolean } {
    const orientation = composition?.orientation
    if (!orientation || (orientation.rotate === 0 && !orientation.mirrored)) {
      return { bitmap, owned: false }
    }
    const canvas = renderOrientedImage(bitmap, orientation, 'offscreen') as OffscreenCanvas
    return { bitmap: canvas.transferToImageBitmap(), owned: true }
  }

  private async applyAnnotationsAndCrop(
    canvas: OffscreenCanvas,
    composition: ImageEditWorkerComposition | undefined
  ): Promise<OffscreenCanvas> {
    if (composition?.annotations?.items.length) {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('OffscreenCanvas 2D context 不可用')
      drawMarkItems(context, composition.annotations.items, canvas.width, canvas.height, {
        baseCanvas: canvas,
        canvasKind: 'offscreen',
      })
    }
    if (!composition?.crop?.rect) return canvas
    const crop = clampCropRect(composition.crop.rect, canvas.width, canvas.height)
    const { canvas: cropped, context } = createImageEditCanvas(crop.width, crop.height, 'offscreen')
    context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, cropped.width, cropped.height)
    return cropped as OffscreenCanvas
  }

  destroy(): void {
    this.disposeState()
    this.deviceManager.destroy()
    this.cachedUrlSource?.bitmap.close()
    this.cachedUrlSource = null
  }

  private async ensureState(): Promise<RuntimeState> {
    if (this.state) return this.state
    this.state = await this.createState()
    return this.state
  }

  private async acquireSource(
    source: ImageEditWorkerSource
  ): Promise<{ bitmap: ImageBitmap; owned: boolean }> {
    if (source.kind === 'blob') {
      return { bitmap: await decodeSource(source), owned: true }
    }
    if (this.cachedUrlSource?.url === source.url) {
      return { bitmap: this.cachedUrlSource.bitmap, owned: false }
    }
    const bitmap = await decodeSource(source)
    this.cachedUrlSource?.bitmap.close()
    this.cachedUrlSource = { url: source.url, bitmap }
    return { bitmap, owned: false }
  }

  private async createState(): Promise<RuntimeState> {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      throw createInitializationError(
        'worker-canvas-api-unavailable',
        'Worker 未提供 OffscreenCanvas 或 ImageBitmap'
      )
    }
    const { provider, adapter, device } = await this.acquireDevice()
    const module = await this.createBaselineShaderModule(device)
    const canvasFormat = this.getPreferredCanvasFormat(provider)
    const shared = {
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex_main' },
      primitive: { topology: 'triangle-list' },
    }
    const { linearizePipeline, encodePipeline } = await this.createBaselinePipelines(
      device,
      module,
      canvasFormat,
      shared
    )
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    const diffusionRenderer = await this.createDiffusionRenderer(device, sampler)
    const state: RuntimeState = {
      provider,
      adapter,
      device,
      sampler,
      linearizePipeline,
      encodePipeline,
      diffusionRenderer,
      // VGPU 只在用户真正启用辉光 Pro 时初始化。普通图片编辑不会创建它的 target、
      // effect 和 uniform 资源，也不会承担新图形库初始化失败的风险。
      vgpuGlowRenderer: null,
      vgpuGlowRendererInitialization: null,
      canvasFormat,
    }
    return state
  }

  private async acquireDevice(): Promise<{
    provider: GpuProvider
    adapter: GpuAdapter
    device: GpuDevice
  }> {
    try {
      return await this.deviceManager.acquire()
    } catch (error) {
      const detail = getErrorDetail(error)
      const code = detail.includes('navigator.gpu')
        ? 'webgpu-api-unavailable'
        : detail.includes('GPU adapter')
          ? 'webgpu-adapter-unavailable'
          : 'webgpu-device-request-failed'
      throw createInitializationError(code, detail)
    }
  }

  private async createBaselineShaderModule(device: GpuDevice): Promise<unknown> {
    try {
      return await createShaderModuleChecked(
        device,
        baselineShaderSource,
        'Worker WebGPU 基线着色器'
      )
    } catch (error) {
      throw createInitializationError('webgpu-baseline-pipeline-failed', error)
    }
  }

  private getPreferredCanvasFormat(provider: GpuProvider): string {
    try {
      return provider.getPreferredCanvasFormat()
    } catch (error) {
      throw createInitializationError('webgpu-canvas-format-unavailable', error)
    }
  }

  private async createBaselinePipelines(
    device: GpuDevice,
    module: unknown,
    canvasFormat: string,
    shared: { layout: string; vertex: unknown; primitive: { topology: string } }
  ): Promise<{ linearizePipeline: GpuRenderPipeline; encodePipeline: GpuRenderPipeline }> {
    try {
      const linearizePipeline = await createRenderPipelineChecked(device, {
        ...shared,
        fragment: {
          module,
          entryPoint: 'fragment_linearize',
          targets: [{ format: 'rgba16float' }],
        },
      }, 'Worker WebGPU 线性化 Pipeline')
      const encodePipeline = await createRenderPipelineChecked(device, {
        ...shared,
        fragment: {
          module,
          entryPoint: 'fragment_encode',
          targets: [{ format: canvasFormat }],
        },
      }, 'Worker WebGPU 输出编码 Pipeline')
      return { linearizePipeline, encodePipeline }
    } catch (error) {
      throw createInitializationError('webgpu-baseline-pipeline-failed', error)
    }
  }

  private async createDiffusionRenderer(
    device: GpuDevice,
    sampler: unknown
  ): Promise<WebGpuDiffusionRenderer> {
    try {
      return await WebGpuDiffusionRenderer.create(device, sampler)
    } catch (error) {
      throw createInitializationError('webgpu-diffusion-pipeline-failed', error)
    }
  }

  private async createVgpuGlowRenderer(device: GpuDevice): Promise<VgpuGlowRenderer> {
    try {
      return await VgpuGlowRenderer.create(device)
    } catch (error) {
      throw createInitializationError('webgpu-vgpu-glow-pipeline-failed', error)
    }
  }

  private async ensureVgpuGlowRenderer(state: RuntimeState): Promise<VgpuGlowRenderer> {
    if (state.vgpuGlowRenderer) return state.vgpuGlowRenderer
    const initialization = state.vgpuGlowRendererInitialization
      ?? this.createVgpuGlowRenderer(state.device)
    state.vgpuGlowRendererInitialization = initialization
    try {
      const renderer = await initialization
      // 初始化期间设备可能已丢失或 runtime 已销毁。旧 renderer 不能挂回新 state，
      // 也不能遗留它创建的 target / effect 资源。
      if (this.state !== state) {
        renderer.destroy()
        throw new Error('VGPU 辉光初始化期间 GPU 运行时已失效')
      }
      state.vgpuGlowRenderer = renderer
      return renderer
    } finally {
      if (state.vgpuGlowRendererInitialization === initialization) {
        state.vgpuGlowRendererInitialization = null
      }
    }
  }

  private async createIntermediate(
    state: RuntimeState,
    decoded: ImageBitmap,
    width: number,
    height: number
  ): Promise<GpuTexture> {
    this.assertTextureSize(state, width, height)
    const sourceTexture = state.device.createTexture({
      size: [decoded.width, decoded.height],
      format: 'rgba8unorm',
      usage: TEXTURE_COPY_DST | TEXTURE_BINDING | TEXTURE_RENDER_ATTACHMENT,
    })
    const intermediate = state.device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage: TEXTURE_RENDER_ATTACHMENT | TEXTURE_BINDING,
    })
    const uniform = createViewportBuffer(state.device, 1, 1, 0, 0)
    try {
      state.device.pushErrorScope('validation')
      state.device.queue.copyExternalImageToTexture(
        { source: decoded },
        { texture: sourceTexture },
        [decoded.width, decoded.height]
      )
      renderPass(
        state.device,
        state.linearizePipeline,
        sourceTexture,
        state.sampler,
        uniform,
        intermediate
      )
      await state.device.queue.onSubmittedWorkDone()
      const renderError = await state.device.popErrorScope()
      if (renderError) {
        throw new Error(
          `Worker WebGPU FP16 Pass 校验失败：${renderError.message ?? '未知错误'}`
        )
      }
      return intermediate
    } finally {
      uniform.destroy()
      sourceTexture.destroy()
    }
  }

  private async renderDiffusionBitmap(
    state: RuntimeState,
    decoded: ImageBitmap,
    width: number,
    height: number,
    recipe: DiffusionRecipe,
    sourceKey: string,
    isCancelled?: () => boolean,
    scatter?: DiffusionRenderInput['scatter']
  ): Promise<ImageBitmap> {
    const rendered = await state.diffusionRenderer.render({
      sourceKey,
      width,
      height,
      recipe,
      isCancelled,
      scatter,
      createLinearBase: async () => await this.createIntermediate(
        state,
        decoded,
        width,
        height
      ),
    })
    try {
      const canvas = new OffscreenCanvas(width, height)
      const context = getWebGpuContext(canvas)
      await this.renderToCanvas(state, rendered.texture, context, {
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      })
      return canvas.transferToImageBitmap()
    } finally {
      rendered.release()
    }
  }

  private async renderVgpuGlowBitmap(
    state: RuntimeState,
    decoded: ImageBitmap,
    width: number,
    height: number,
    recipe: VgpuGlowRecipe,
    isCancelled?: () => boolean,
    scatter?: {
      global: VgpuGlowGlobalScatter
      region: readonly [number, number, number, number]
    }
  ): Promise<ImageBitmap> {
    this.assertTextureSize(state, width, height)
    const renderer = await this.ensureVgpuGlowRenderer(state)
    const rendered = await renderer.render({
      bitmap: decoded,
      width,
      height,
      recipe,
      isCancelled,
      scatter,
    })
    const canvas = new OffscreenCanvas(width, height)
    const context = getWebGpuContext(canvas)
    await this.renderToCanvas(state, rendered, context, {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    })
    return canvas.transferToImageBitmap()
  }

  private async exportVgpuGlow(
    state: RuntimeState,
    bitmap: ImageBitmap,
    options: WebGpuExportOptions,
    recipe: VgpuGlowRecipe
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const width = bitmap.width
    const height = bitmap.height
    const plan = createImageEditExportPlan(width, height, {
      tileSize: options.tileSize,
      halo: options.halo,
      globalScatterMaxDimension: options.globalScatterMaxDimension,
    })
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('OffscreenCanvas 2D context 不可用')
    const textureLimit = state.adapter.limits?.maxTextureDimension2D
    const singlePass = width * height <= 40_000_000
      && (typeof textureLimit !== 'number' || Math.max(width, height) <= textureLimit)
    if (singlePass) {
      const rendered = await this.renderVgpuGlowBitmap(
        state,
        bitmap,
        width,
        height,
        recipe,
        options.isCancelled
      )
      try {
        context.drawImage(rendered, 0, 0)
      } finally {
        rendered.close()
      }
      options.onProgress(plan.totalTiles, plan.totalTiles)
    } else {
      const globalBitmap = await createImageBitmap(bitmap, {
        resizeWidth: plan.globalScatterWidth,
        resizeHeight: plan.globalScatterHeight,
        resizeQuality: 'high',
      })
      const renderer = await this.ensureVgpuGlowRenderer(state)
      let globalScatter: VgpuGlowGlobalScatter | null = null
      try {
        globalScatter = await renderer.buildGlobalScatter({
          bitmap: globalBitmap,
          width: plan.globalScatterWidth,
          height: plan.globalScatterHeight,
          recipe: rebaseVgpuGlowRecipeForScale(
            recipe,
            plan.globalScatterWidth,
            plan.globalScatterHeight
          ),
          isCancelled: options.isCancelled,
        })
        for (const tile of plan.tiles) {
          if (options.isCancelled()) throw new DOMException('图片编辑任务已取消', 'AbortError')
          const tileBitmap = await createImageBitmap(
            bitmap,
            tile.expandedX,
            tile.expandedY,
            tile.expandedWidth,
            tile.expandedHeight
          )
          try {
            const rendered = await this.renderVgpuGlowBitmap(
              state,
              tileBitmap,
              tile.expandedWidth,
              tile.expandedHeight,
              recipe,
              options.isCancelled,
              {
                global: globalScatter,
                region: [
                  tile.expandedX / width,
                  tile.expandedY / height,
                  tile.expandedWidth / width,
                  tile.expandedHeight / height,
                ],
              }
            )
            try {
              context.drawImage(
                rendered,
                tile.cropX,
                tile.cropY,
                tile.width,
                tile.height,
                tile.x,
                tile.y,
                tile.width,
                tile.height
              )
            } finally {
              rendered.close()
            }
          } finally {
            tileBitmap.close()
          }
          options.onProgress(tile.index + 1, plan.totalTiles)
        }
      } finally {
        globalScatter?.release()
        globalBitmap.close()
      }
    }
    const finalOutput = await this.applyAnnotationsAndCrop(canvas, options.composition)
    const blob = await finalOutput.convertToBlob({
      type: options.format,
      quality: options.quality,
    })
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: finalOutput.width,
      height: finalOutput.height,
    }
  }

  private async renderToCanvas(
    state: RuntimeState,
    intermediate: GpuTexture,
    context: GpuCanvasContext,
    viewport: {
      scaleX: number
      scaleY: number
      offsetX: number
      offsetY: number
    }
  ): Promise<void> {
    context.configure({
      device: state.device,
      format: state.canvasFormat,
      alphaMode: 'premultiplied',
    })
    const uniform = createViewportBuffer(
      state.device,
      viewport.scaleX,
      viewport.scaleY,
      viewport.offsetX,
      viewport.offsetY
    )
    try {
      state.device.pushErrorScope('validation')
      renderPass(
        state.device,
        state.encodePipeline,
        intermediate,
        state.sampler,
        uniform,
        context.getCurrentTexture()
      )
      await state.device.queue.onSubmittedWorkDone()
      const renderError = await state.device.popErrorScope()
      if (renderError) {
        throw new Error(
          `Worker WebGPU Canvas Pass 校验失败：${renderError.message ?? '未知错误'}`
        )
      }
    } finally {
      uniform.destroy()
    }
  }

  private describeCapabilities(state: RuntimeState): ImageEditWorkerCapabilities {
    const info = state.adapter.info ?? {}
    return {
      available: true,
      adapterName: info.description || info.device || info.vendor || null,
      backend: info.architecture || null,
      isFallbackAdapter: state.adapter.isFallbackAdapter ?? null,
      features: state.adapter.features ? [...state.adapter.features] : [],
      limits: collectRelevantGpuLimits(state.adapter.limits),
      rgba16Float: { renderable: true, sampleable: true },
      offscreenCanvas: true,
      imageBitmap: true,
      supportedExportFormats: ['image/png', 'image/jpeg', 'image/webp'],
    }
  }

  private assertTextureSize(state: RuntimeState, width: number, height: number): void {
    const limit = state.adapter.limits?.maxTextureDimension2D
    if (typeof limit === 'number' && Math.max(width, height) > limit) {
      throw new Error(`图片尺寸 ${width}x${height} 超过设备纹理上限 ${limit}`)
    }
  }

  private disposeState(): void {
    if (this.state) this.destroyRuntimeState(this.state)
    this.deviceManager.invalidate()
    this.state = null
  }

  private destroyRuntimeState(state: RuntimeState): void {
    state.diffusionRenderer.destroy()
    state.vgpuGlowRenderer?.destroy()
    state.vgpuGlowRenderer = null
    // 正在进行的初始化由 ensureVgpuGlowRenderer 在发现 state 已失效时负责销毁。
    state.vgpuGlowRendererInitialization = null
  }
}

function orientationCacheKey(composition: ImageEditWorkerComposition | undefined): string {
  const orientation = composition?.orientation
  return orientation ? `${orientation.rotate}:${orientation.mirrored ? 'm' : 'n'}` : '0:n'
}

function describeInitializationFailure(error: unknown): ImageEditWorkerInitializationFailure {
  if (error instanceof WorkerWebGpuInitializationError) return error.failure
  return {
    code: 'webgpu-initialization-unknown',
    detail: sanitizeInitializationDetail(getErrorDetail(error)),
  }
}

function createInitializationError(
  code: ImageEditWorkerInitializationFailureCode,
  error: unknown
): WorkerWebGpuInitializationError {
  return new WorkerWebGpuInitializationError({
    code,
    detail: sanitizeInitializationDetail(getErrorDetail(error)),
  })
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeInitializationDetail(value: string): string {
  const withoutPaths = value
    .replace(/[A-Za-z]:[\\/][^\s)\],]+/g, '<path>')
    .replace(/(?:https?|file):\/\/[^\s)\],]+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim()
  // 上限放宽到 400：WGSL 编译诊断带行列号和源码片段，180 字会把真正的原因截掉，
  // 只剩下没有定位价值的前缀。
  return (withoutPaths || 'unknown-initialization-error').slice(0, 400)
}

async function createPreviewBitmap(
  bitmap: ImageBitmap,
  maxPixels: number
): Promise<{ bitmap: ImageBitmap; owned: boolean }> {
  const size = fitWithinPixelBudget(bitmap.width, bitmap.height, maxPixels)
  if (size.width === bitmap.width && size.height === bitmap.height) {
    return { bitmap, owned: false }
  }
  return {
    bitmap: await createImageBitmap(bitmap, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    }),
    owned: true,
  }
}
