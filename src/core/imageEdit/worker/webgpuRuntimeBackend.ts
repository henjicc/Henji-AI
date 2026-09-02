import baselineShaderSource from './baseline.wgsl?raw'
import type { DiffusionRecipe } from '../diffusionRecipe'
import type { FastBlurRecipe } from '../fastBlurRecipe'
import type { VgpuGlowRecipe } from '../vgpuGlowRecipe'
import {
  createRenderPipelineChecked,
  createShaderModuleChecked,
  ImageEditWebGpuDeviceManager,
  type ImageEditWebGpuDeviceLoss,
  type ManagedWebGpuDevice,
} from '../webgpu/deviceManager'
import { WebGpuDiffusionRenderer, type DiffusionRenderInput, type DiffusionScatterPyramid } from '../webgpu/diffusionRenderer'
import { VgpuFastBlurRenderer } from '../webgpu/vgpuFastBlurRenderer'
import { VgpuGlowRenderer, type VgpuGlowGlobalScatter } from '../webgpu/vgpuGlowRenderer'
import type { ImageEditWorkerCapabilities } from './protocol'
import {
  DeviceGenerationSerialQueue,
  SingleflightRuntimeState,
} from './gpuRuntimeLifecycle'
import {
  classifyDeviceAcquisitionFailure,
  createInitializationError,
  describeInitializationFailure,
  getErrorDetail,
} from './webgpuRuntimeErrors'
import {
  assertWorkerTextureSize,
  describeWorkerWebGpuCapabilities,
} from './webgpuRuntimeCapabilities'
import {
  createWorkerWebGpuIntermediate,
  renderWorkerWebGpuTextureToBitmap,
} from './webgpuRuntimeBitmap'
import {
  unavailableCapabilities,
  type GpuAdapter, type GpuDevice, type GpuProvider, type GpuRenderPipeline,
} from './webgpuRuntimeSupport'

export interface WorkerWebGpuState {
  generation: number
  provider: GpuProvider
  adapter: GpuAdapter
  device: GpuDevice
  sampler: unknown
  linearizePipeline: GpuRenderPipeline
  encodePipeline: GpuRenderPipeline
  diffusionRenderer: WebGpuDiffusionRenderer
  vgpuFastBlurRenderer: VgpuFastBlurRenderer | null
  vgpuFastBlurRendererInitialization: Promise<VgpuFastBlurRenderer> | null
  vgpuGlowRenderer: VgpuGlowRenderer | null
  vgpuGlowRendererInitialization: Promise<VgpuGlowRenderer> | null
  canvasFormat: string
}

interface ImageEditWebGpuDeviceManagerLike {
  onDeviceLost(
    handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void
  ): void
  acquire(): Promise<ManagedWebGpuDevice>
  invalidate(): void
  destroy(): void
  isCurrent(generation: number): boolean
}

export interface WorkerWebGpuRuntimeBackendDependencies {
  deviceManager?: ImageEditWebGpuDeviceManagerLike
  stateFactory?: () => Promise<WorkerWebGpuState>
  stateDestroyer?: (state: WorkerWebGpuState) => void
}
export class WorkerWebGpuRuntimeBackend {
  private readonly deviceManager: ImageEditWebGpuDeviceManagerLike
  private readonly states: SingleflightRuntimeState<WorkerWebGpuState>
  private readonly serial = new DeviceGenerationSerialQueue()
  private readonly stateFactory?: () => Promise<WorkerWebGpuState>
  private readonly stateDestroyer?: (state: WorkerWebGpuState) => void
  private deviceLostHandler: ((reason: string) => void) | null = null
  private destroyed = false
  constructor(dependencies: WorkerWebGpuRuntimeBackendDependencies = {}) {
    this.deviceManager = dependencies.deviceManager ?? new ImageEditWebGpuDeviceManager()
    this.stateFactory = dependencies.stateFactory
    this.stateDestroyer = dependencies.stateDestroyer
    this.states = new SingleflightRuntimeState((state) => this.destroyRuntimeState(state))
    this.deviceManager.onDeviceLost((reason) => {
      // 即使 device 在 createState 中丢失、尚未挂成 current，也必须推进 state epoch。
      this.states.invalidate()
      this.deviceLostHandler?.(reason)
    })
  }
  onDeviceLost(handler: (reason: string) => void): void { this.deviceLostHandler = handler }
  async initialize(recoverDevice = false): Promise<ImageEditWorkerCapabilities> {
    try {
      if (recoverDevice) {
        this.deviceManager.invalidate()
        this.states.invalidate()
      }
      const state = await this.ensureState()
      return describeWorkerWebGpuCapabilities(state)
    } catch (error) {
      return unavailableCapabilities(describeInitializationFailure(error))
    }
  }
  async ensureState(): Promise<WorkerWebGpuState> {
    return await this.states.acquire(
      this.stateFactory ?? (() => this.createState())
    )
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.states.destroy()
    this.serial.destroy()
    this.deviceManager.destroy()
  }

  getMaxTextureDimension(state: WorkerWebGpuState): number | undefined { return state.adapter.limits?.maxTextureDimension2D }
  trimVgpuGlowWorkingSet(state: WorkerWebGpuState): void {
    if (this.states.isCurrent(state)) state.vgpuGlowRenderer?.trimWorkingSet()
  }
  trimVgpuFastBlurWorkingSet(state: WorkerWebGpuState): void {
    if (this.states.isCurrent(state)) state.vgpuFastBlurRenderer?.trimWorkingSet()
  }

  async renderBaselineBitmap(
    state: WorkerWebGpuState, decoded: ImageBitmap, width: number, height: number
  ): Promise<ImageBitmap> {
    return await this.runForState(state, async () => {
      const intermediate = await createWorkerWebGpuIntermediate(state, decoded, width, height)
      try {
        return await renderWorkerWebGpuTextureToBitmap(state, intermediate, width, height)
      } finally {
        intermediate.destroy()
      }
    }, (bitmap) => bitmap.close())
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
    return await this.runForState(state, async () => {
      const rendered = await state.diffusionRenderer.render({
        sourceKey,
        width,
        height,
        recipe,
        isCancelled,
        scatter,
        createLinearBase: async () => await createWorkerWebGpuIntermediate(
          state,
          decoded,
          width,
          height
        ),
      })
      try {
        return await renderWorkerWebGpuTextureToBitmap(state, rendered.texture, width, height)
      } finally {
        rendered.release()
      }
    }, (bitmap) => bitmap.close())
  }

  async buildDiffusionScatterPyramid(
    state: WorkerWebGpuState,
    decoded: ImageBitmap,
    width: number,
    height: number,
    recipe: DiffusionRecipe,
    isCancelled: () => boolean
  ): Promise<DiffusionScatterPyramid> {
    return await this.runForState(state, async () => (
      await state.diffusionRenderer.buildScatterPyramid({
        width,
        height,
        recipe,
        isCancelled,
        createLinearBase: async () => await createWorkerWebGpuIntermediate(
          state,
          decoded,
          width,
          height
        ),
      })
    ), (pyramid) => pyramid.release())
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
    return await this.runForState(state, async () => {
      assertWorkerTextureSize(state, width, height)
      const renderer = await this.ensureVgpuGlowRenderer(state)
      const rendered = await renderer.render({
        bitmap: decoded,
        width,
        height,
        recipe,
        isCancelled,
        scatter,
      })
      return await renderWorkerWebGpuTextureToBitmap(state, rendered, width, height)
    }, (bitmap) => bitmap.close())
  }

  async renderVgpuFastBlurBitmap(
    state: WorkerWebGpuState,
    decoded: ImageBitmap,
    width: number,
    height: number,
    recipe: FastBlurRecipe,
    isCancelled?: () => boolean,
  ): Promise<ImageBitmap> {
    return await this.runForState(state, async () => {
      assertWorkerTextureSize(state, width, height)
      const renderer = await this.ensureVgpuFastBlurRenderer(state)
      const rendered = await renderer.render({
        bitmap: decoded,
        width,
        height,
        recipe,
        isCancelled,
      })
      return await renderWorkerWebGpuTextureToBitmap(state, rendered, width, height)
    }, (bitmap) => bitmap.close())
  }

  async buildVgpuGlowGlobalScatter(
    state: WorkerWebGpuState,
    bitmap: ImageBitmap,
    width: number,
    height: number,
    recipe: VgpuGlowRecipe,
    isCancelled: () => boolean
  ): Promise<VgpuGlowGlobalScatter> {
    return await this.runForState(state, async () => {
      const renderer = await this.ensureVgpuGlowRenderer(state)
      return await renderer.buildGlobalScatter({
        bitmap,
        width,
        height,
        recipe,
        isCancelled,
      })
    }, (scatter) => scatter.release())
  }

  private async createState(): Promise<WorkerWebGpuState> {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      throw createInitializationError(
        'worker-canvas-api-unavailable',
        'Worker 未提供 OffscreenCanvas 或 ImageBitmap'
      )
    }
    const { provider, adapter, device, generation } = await this.acquireDevice()
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
      generation,
      provider,
      adapter,
      device,
      sampler,
      linearizePipeline,
      encodePipeline,
      diffusionRenderer: await this.createDiffusionRenderer(device, sampler),
      // 模糊与辉光一样按需初始化，普通编辑不会常驻额外 FP16 金字塔。
      vgpuFastBlurRenderer: null,
      vgpuFastBlurRendererInitialization: null,
      // VGPU 只在用户真正启用辉光 Pro 时初始化。普通图片编辑不会创建它的 target、
      // effect 和 uniform 资源，也不会承担新图形库初始化失败的风险。
      vgpuGlowRenderer: null,
      vgpuGlowRendererInitialization: null,
      canvasFormat,
    }
  }

  private async acquireDevice(): Promise<ManagedWebGpuDevice> {
    try {
      return await this.deviceManager.acquire()
    } catch (error) {
      const detail = getErrorDetail(error)
      const code = classifyDeviceAcquisitionFailure(error)
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

  private async createVgpuFastBlurRenderer(device: GpuDevice): Promise<VgpuFastBlurRenderer> {
    try {
      return await VgpuFastBlurRenderer.create(device)
    } catch (error) {
      throw createInitializationError('webgpu-vgpu-blur-pipeline-failed', error)
    }
  }

  private async ensureVgpuFastBlurRenderer(
    state: WorkerWebGpuState,
  ): Promise<VgpuFastBlurRenderer> {
    if (state.vgpuFastBlurRenderer) return state.vgpuFastBlurRenderer
    const initialization = state.vgpuFastBlurRendererInitialization
      ?? this.createVgpuFastBlurRenderer(state.device)
    state.vgpuFastBlurRendererInitialization = initialization
    try {
      const renderer = await initialization
      if (!this.isStateCurrent(state)) {
        renderer.destroy()
        throw new Error('VGPU 模糊初始化期间 GPU 运行时已失效')
      }
      state.vgpuFastBlurRenderer = renderer
      return renderer
    } finally {
      if (state.vgpuFastBlurRendererInitialization === initialization) {
        state.vgpuFastBlurRendererInitialization = null
      }
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
      if (!this.isStateCurrent(state)) {
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

  private async runForState<T>(
    state: WorkerWebGpuState,
    execute: () => Promise<T>,
    disposeStale?: (value: T) => void,
  ): Promise<T> {
    return await this.serial.run({
      generation: state.generation,
      isCurrent: () => this.isStateCurrent(state),
      execute,
      disposeStale,
    })
  }

  private isStateCurrent(state: WorkerWebGpuState): boolean {
    return this.states.isCurrent(state)
      && this.deviceManager.isCurrent(state.generation)
  }

  private destroyRuntimeState(state: WorkerWebGpuState): void {
    if (this.stateDestroyer) {
      this.stateDestroyer(state)
      return
    }
    state.diffusionRenderer.destroy()
    state.vgpuFastBlurRenderer?.destroy()
    state.vgpuFastBlurRenderer = null
    state.vgpuFastBlurRendererInitialization = null
    state.vgpuGlowRenderer?.destroy()
    state.vgpuGlowRenderer = null
    // 正在进行的初始化由 ensureVgpuGlowRenderer 在发现 state 已失效时负责销毁。
    state.vgpuGlowRendererInitialization = null
  }
}
