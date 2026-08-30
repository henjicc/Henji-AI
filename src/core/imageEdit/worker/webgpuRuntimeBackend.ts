import baselineShaderSource from './baseline.wgsl?raw'
import type { DiffusionRecipe } from '../diffusionRecipe'
import type { VgpuGlowRecipe } from '../vgpuGlowRecipe'
import { createRenderPipelineChecked, createShaderModuleChecked, ImageEditWebGpuDeviceManager } from '../webgpu/deviceManager'
import { WebGpuDiffusionRenderer, type DiffusionRenderInput, type DiffusionScatterPyramid } from '../webgpu/diffusionRenderer'
import { VgpuGlowRenderer, type VgpuGlowGlobalScatter } from '../webgpu/vgpuGlowRenderer'
import { collectRelevantGpuLimits } from './webgpuCapabilities'
import type { ImageEditWorkerCapabilities, ImageEditWorkerInitializationFailure, ImageEditWorkerInitializationFailureCode } from './protocol'
import {
  createViewportBuffer, getWebGpuContext, renderPass, unavailableCapabilities,
  type GpuAdapter, type GpuCanvasContext, type GpuDevice, type GpuProvider,
  type GpuRenderPipeline, type GpuTexture,
} from './webgpuRuntimeSupport'

const TEXTURE_COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const TEXTURE_RENDER_ATTACHMENT = 0x10

export interface WorkerWebGpuState {
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

export class WorkerWebGpuRuntimeBackend {
  private state: WorkerWebGpuState | null = null
  private readonly deviceManager = new ImageEditWebGpuDeviceManager()
  private deviceLostHandler: ((reason: string) => void) | null = null

  constructor() {
    this.deviceManager.onDeviceLost((reason) => {
      if (this.state) this.destroyRuntimeState(this.state)
      this.state = null
      this.deviceLostHandler?.(reason)
    })
  }

  onDeviceLost(handler: (reason: string) => void): void { this.deviceLostHandler = handler }

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

  async ensureState(): Promise<WorkerWebGpuState> {
    if (this.state) return this.state
    this.state = await this.createState()
    return this.state
  }

  destroy(): void {
    this.disposeState()
    this.deviceManager.destroy()
  }

  getMaxTextureDimension(state: WorkerWebGpuState): number | undefined { return state.adapter.limits?.maxTextureDimension2D }
  trimVgpuGlowWorkingSet(state: WorkerWebGpuState): void { state.vgpuGlowRenderer?.trimWorkingSet() }

  async renderBaselineBitmap(
    state: WorkerWebGpuState, decoded: ImageBitmap, width: number, height: number
  ): Promise<ImageBitmap> {
    const intermediate = await this.createIntermediate(state, decoded, width, height)
    try {
      return await this.renderTextureToBitmap(state, intermediate, width, height)
    } finally {
      intermediate.destroy()
    }
  }

  async renderDiffusionBitmap(
    state: WorkerWebGpuState,
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
      return await this.renderTextureToBitmap(state, rendered.texture, width, height)
    } finally {
      rendered.release()
    }
  }

  async buildDiffusionScatterPyramid(
    state: WorkerWebGpuState,
    decoded: ImageBitmap,
    width: number,
    height: number,
    recipe: DiffusionRecipe,
    isCancelled: () => boolean
  ): Promise<DiffusionScatterPyramid> {
    return await state.diffusionRenderer.buildScatterPyramid({
      width,
      height,
      recipe,
      isCancelled,
      createLinearBase: async () => await this.createIntermediate(
        state,
        decoded,
        width,
        height
      ),
    })
  }

  async renderVgpuGlowBitmap(
    state: WorkerWebGpuState,
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
    return await this.renderTextureToBitmap(state, rendered, width, height)
  }

  async buildVgpuGlowGlobalScatter(
    state: WorkerWebGpuState,
    bitmap: ImageBitmap,
    width: number,
    height: number,
    recipe: VgpuGlowRecipe,
    isCancelled: () => boolean
  ): Promise<VgpuGlowGlobalScatter> {
    const renderer = await this.ensureVgpuGlowRenderer(state)
    return await renderer.buildGlobalScatter({
      bitmap,
      width,
      height,
      recipe,
      isCancelled,
    })
  }

  private async createState(): Promise<WorkerWebGpuState> {
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
    return {
      provider,
      adapter,
      device,
      sampler,
      linearizePipeline,
      encodePipeline,
      diffusionRenderer: await this.createDiffusionRenderer(device, sampler),
      // VGPU 只在用户真正启用辉光 Pro 时初始化。普通图片编辑不会创建它的 target、
      // effect 和 uniform 资源，也不会承担新图形库初始化失败的风险。
      vgpuGlowRenderer: null,
      vgpuGlowRendererInitialization: null,
      canvasFormat,
    }
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

  private async ensureVgpuGlowRenderer(
    state: WorkerWebGpuState
  ): Promise<VgpuGlowRenderer> {
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
    state: WorkerWebGpuState,
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
        { texture: sourceTexture, premultipliedAlpha: false },
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

  private async renderTextureToBitmap(
    state: WorkerWebGpuState,
    texture: GpuTexture,
    width: number,
    height: number
  ): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height)
    const context = getWebGpuContext(canvas)
    await this.renderToCanvas(state, texture, context)
    return canvas.transferToImageBitmap()
  }

  private async renderToCanvas(
    state: WorkerWebGpuState,
    intermediate: GpuTexture,
    context: GpuCanvasContext
  ): Promise<void> {
    context.configure({
      device: state.device,
      format: state.canvasFormat,
      alphaMode: 'premultiplied',
    })
    const uniform = createViewportBuffer(state.device, 1, 1, 0, 0)
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

  private describeCapabilities(state: WorkerWebGpuState): ImageEditWorkerCapabilities {
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

  private assertTextureSize(state: WorkerWebGpuState, width: number, height: number): void {
    const limit = this.getMaxTextureDimension(state)
    if (typeof limit === 'number' && Math.max(width, height) > limit) {
      throw new Error(`图片尺寸 ${width}x${height} 超过设备纹理上限 ${limit}`)
    }
  }

  private disposeState(): void {
    if (this.state) this.destroyRuntimeState(this.state)
    this.deviceManager.invalidate()
    this.state = null
  }

  private destroyRuntimeState(state: WorkerWebGpuState): void {
    state.diffusionRenderer.destroy()
    state.vgpuGlowRenderer?.destroy()
    state.vgpuGlowRenderer = null
    // 正在进行的初始化由 ensureVgpuGlowRenderer 在发现 state 已失效时负责销毁。
    state.vgpuGlowRendererInitialization = null
  }
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
