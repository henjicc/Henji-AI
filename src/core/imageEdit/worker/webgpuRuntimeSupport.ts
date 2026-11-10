import type {
  ImageEditWorkerCapabilities,
  ImageEditWorkerInitializationFailure,
} from './protocol'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40

export interface GpuTexture {
  readonly format?: string
  createView(): unknown
  destroy(): void
}

export interface GpuBuffer {
  destroy(): void
}

export interface GpuRenderPipeline {
  getBindGroupLayout(index: number): unknown
}

interface GpuRenderPass {
  setPipeline(pipeline: GpuRenderPipeline): void
  setBindGroup(index: number, bindGroup: unknown): void
  draw(vertexCount: number): void
  end(): void
}

interface GpuCommandEncoder {
  beginRenderPass(descriptor: unknown): GpuRenderPass
  finish(): unknown
}

export interface GpuDevice {
  queue: {
    copyExternalImageToTexture(
      source: unknown,
      destination: unknown,
      size: unknown
    ): void
    writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView): void
    submit(commands: unknown[]): void
    onSubmittedWorkDone(): Promise<void>
  }
  lost: Promise<{ reason?: string; message?: string }>
  createShaderModule(descriptor: unknown): unknown
  createRenderPipeline(descriptor: unknown): GpuRenderPipeline
  createRenderPipelineAsync?: (descriptor: unknown) => Promise<GpuRenderPipeline>
  createSampler(descriptor: unknown): unknown
  createTexture(descriptor: unknown): GpuTexture
  createBuffer(descriptor: unknown): GpuBuffer
  createBindGroup(descriptor: unknown): unknown
  createCommandEncoder(): GpuCommandEncoder
  pushErrorScope(filter: string): void
  popErrorScope(): Promise<{ message?: string } | null>
  destroy(): void
}

export interface GpuAdapter {
  info?: {
    device?: string
    description?: string
    vendor?: string
    architecture?: string
  }
  isFallbackAdapter?: boolean
  features?: Iterable<string>
  limits?: Record<string, number>
  requestDevice(descriptor?: unknown): Promise<GpuDevice>
}

export interface GpuProvider {
  requestAdapter(options?: unknown): Promise<GpuAdapter | null>
  getPreferredCanvasFormat(): string
}

export interface GpuCanvasContext {
  configure(descriptor: unknown): void
  getCurrentTexture(): GpuTexture
}

export function getGpuProvider(): GpuProvider | null {
  const candidate = (navigator as Navigator & { gpu?: GpuProvider }).gpu
  return candidate ?? null
}

export function getWebGpuContext(canvas: OffscreenCanvas): GpuCanvasContext {
  const context = (
    canvas as OffscreenCanvas & {
      getContext(contextId: 'webgpu'): GpuCanvasContext | null
    }
  ).getContext('webgpu')
  if (!context) throw new Error('OffscreenCanvas WebGPU context 不可用')
  return context
}

export function createViewportBuffer(
  device: GpuDevice,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number
): GpuBuffer {
  const buffer = device.createBuffer({
    size: 16,
    usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
  })
  device.queue.writeBuffer(
    buffer,
    0,
    new Float32Array([scaleX, scaleY, offsetX, offsetY])
  )
  return buffer
}

export function renderPass(
  device: GpuDevice,
  pipeline: GpuRenderPipeline,
  source: GpuTexture,
  sampler: unknown,
  uniform: GpuBuffer,
  target: GpuTexture
): void {
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: uniform } },
    ],
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(6)
  pass.end()
  device.queue.submit([encoder.finish()])
}

export function renderPipelinePass(
  device: GpuDevice,
  pipeline: GpuRenderPipeline,
  entries: readonly unknown[],
  target: GpuTexture
): void {
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries,
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(6)
  pass.end()
  device.queue.submit([encoder.finish()])
}

export function createUniformBuffer(
  device: GpuDevice,
  values: Float32Array
): GpuBuffer {
  const alignedSize = Math.ceil(values.byteLength / 16) * 16
  const buffer = device.createBuffer({
    size: alignedSize,
    usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, values)
  return buffer
}

export function unavailableCapabilities(
  failure: ImageEditWorkerInitializationFailure
): ImageEditWorkerCapabilities {
  return {
    available: false,
    adapterName: null,
    backend: null,
    isFallbackAdapter: null,
    features: [],
    limits: {},
    rgba16Float: { renderable: false, sampleable: false },
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    imageBitmap: typeof createImageBitmap !== 'undefined',
    supportedExportFormats: [],
    initializationFailure: failure,
    reason: failure.detail,
  }
}

