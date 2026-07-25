import baselineShaderSource from './baseline.wgsl?raw'
import {
  createImageEditExportPlan,
  fitWithinPixelBudget,
  IMAGE_EDIT_PREVIEW_MAX_PIXELS,
} from './exportPrototype'
import { collectRelevantGpuLimits } from './webgpuCapabilities'
import type {
  ImageEditExportFormat,
  ImageEditWorkerCapabilities,
  ImageEditWorkerSource,
} from './protocol'
import {
  assertNotCancelled,
  createViewportBuffer,
  decodeSource,
  getGpuProvider,
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
  canvasFormat: string
}

export interface WebGpuExportOptions {
  format: ImageEditExportFormat
  quality?: number
  tileSize?: number
  halo?: number
  isCancelled: () => boolean
  onProgress: (completedTiles: number, totalTiles: number) => void
}

export class WorkerWebGpuRuntime {
  private state: RuntimeState | null = null
  private deviceLostHandler: ((reason: string) => void) | null = null
  private cachedUrlSource: { url: string; bitmap: ImageBitmap } | null = null

  onDeviceLost(handler: (reason: string) => void): void {
    this.deviceLostHandler = handler
  }

  async initialize(): Promise<ImageEditWorkerCapabilities> {
    try {
      const state = await this.createState()
      this.disposeState()
      this.state = state
      return this.describeCapabilities(state)
    } catch (error) {
      return unavailableCapabilities(error instanceof Error ? error.message : String(error))
    }
  }

  async renderPreview(
    source: ImageEditWorkerSource,
    maxPixels = IMAGE_EDIT_PREVIEW_MAX_PIXELS
  ): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
    const state = await this.ensureState()
    const decoded = await this.acquireSource(source)
    try {
      const size = fitWithinPixelBudget(
        decoded.bitmap.width,
        decoded.bitmap.height,
        maxPixels
      )
      const intermediate = await this.createIntermediate(
        state,
        decoded.bitmap,
        size.width,
        size.height
      )
      try {
        const canvas = new OffscreenCanvas(size.width, size.height)
        const context = getWebGpuContext(canvas)
        await this.renderToCanvas(state, intermediate, context, {
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
        })
        return {
          bitmap: canvas.transferToImageBitmap(),
          width: size.width,
          height: size.height,
        }
      } finally {
        intermediate.destroy()
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
      this.assertTextureSize(state, decoded.bitmap.width, decoded.bitmap.height)
      const plan = createImageEditExportPlan(
        decoded.bitmap.width,
        decoded.bitmap.height,
        {
        tileSize: options.tileSize,
        halo: options.halo,
        }
      )
      const intermediate = await this.createIntermediate(
        state,
        decoded.bitmap,
        decoded.bitmap.width,
        decoded.bitmap.height
      )
      const output = new OffscreenCanvas(decoded.bitmap.width, decoded.bitmap.height)
      const outputContext = output.getContext('2d')
      if (!outputContext) throw new Error('OffscreenCanvas 2D context 不可用')

      try {
        for (const tile of plan.tiles) {
          assertNotCancelled(options.isCancelled)
          const tileCanvas = new OffscreenCanvas(tile.expandedWidth, tile.expandedHeight)
          const tileContext = getWebGpuContext(tileCanvas)
          await this.renderToCanvas(state, intermediate, tileContext, {
            scaleX: tile.expandedWidth / decoded.bitmap.width,
            scaleY: tile.expandedHeight / decoded.bitmap.height,
            offsetX: tile.expandedX / decoded.bitmap.width,
            offsetY: tile.expandedY / decoded.bitmap.height,
          })
          assertNotCancelled(options.isCancelled)
          const tileBitmap = tileCanvas.transferToImageBitmap()
          try {
            outputContext.drawImage(
              tileBitmap,
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
            tileBitmap.close()
          }
          options.onProgress(tile.index + 1, plan.totalTiles)
        }

        assertNotCancelled(options.isCancelled)
        const blob = await output.convertToBlob({
          type: options.format,
          quality: options.quality,
        })
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          width: decoded.bitmap.width,
          height: decoded.bitmap.height,
        }
      } finally {
        intermediate.destroy()
      }
    } finally {
      if (decoded.owned) decoded.bitmap.close()
    }
  }

  destroy(): void {
    this.disposeState()
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
    const provider = getGpuProvider()
    if (!provider) throw new Error('当前 Worker 未暴露 navigator.gpu')
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      throw new Error('当前 Worker 不支持 OffscreenCanvas 或 ImageBitmap')
    }
    const adapter = await provider.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('Worker 未找到可用 GPU adapter')
    const device = await adapter.requestDevice()
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code: baselineShaderSource })
    const canvasFormat = provider.getPreferredCanvasFormat()
    const shared = {
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex_main' },
      primitive: { topology: 'triangle-list' },
    }
    const linearizePipeline = device.createRenderPipeline({
      ...shared,
      fragment: {
        module,
        entryPoint: 'fragment_linearize',
        targets: [{ format: 'rgba16float' }],
      },
    })
    const encodePipeline = device.createRenderPipeline({
      ...shared,
      fragment: {
        module,
        entryPoint: 'fragment_encode',
        targets: [{ format: canvasFormat }],
      },
    })
    const pipelineError = await device.popErrorScope()
    if (pipelineError) {
      device.destroy()
      throw new Error(`Worker WebGPU Pipeline 校验失败：${pipelineError.message ?? '未知错误'}`)
    }
    const state: RuntimeState = {
      provider,
      adapter,
      device,
      sampler: device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      linearizePipeline,
      encodePipeline,
      canvasFormat,
    }
    void device.lost.then((info) => {
      if (this.state?.device !== device) return
      this.state = null
      this.deviceLostHandler?.(info.message || info.reason || 'WebGPU device lost')
    })
    return state
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
    this.state?.device.destroy()
    this.state = null
  }
}
