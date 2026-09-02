import type { WorkerWebGpuState } from './webgpuRuntimeBackend'
import { assertWorkerTextureSize } from './webgpuRuntimeCapabilities'
import {
  createViewportBuffer,
  getWebGpuContext,
  renderPass,
  type GpuCanvasContext,
  type GpuTexture,
} from './webgpuRuntimeSupport'

const TEXTURE_COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const TEXTURE_RENDER_ATTACHMENT = 0x10

export async function createWorkerWebGpuIntermediate(
  state: WorkerWebGpuState,
  decoded: ImageBitmap,
  width: number,
  height: number,
): Promise<GpuTexture> {
  assertWorkerTextureSize(state, width, height)
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
      [decoded.width, decoded.height],
    )
    renderPass(
      state.device,
      state.linearizePipeline,
      sourceTexture,
      state.sampler,
      uniform,
      intermediate,
    )
    const renderError = await state.device.popErrorScope()
    if (renderError) {
      throw new Error(
        `Worker WebGPU FP16 Pass 校验失败：${renderError.message ?? '未知错误'}`,
      )
    }
    return intermediate
  } finally {
    uniform.destroy()
    sourceTexture.destroy()
  }
}

export async function renderWorkerWebGpuTextureToBitmap(
  state: WorkerWebGpuState,
  texture: GpuTexture,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height)
  const context = getWebGpuContext(canvas)
  await renderWorkerWebGpuTextureToCanvas(state, texture, context)
  return canvas.transferToImageBitmap()
}

async function renderWorkerWebGpuTextureToCanvas(
  state: WorkerWebGpuState,
  intermediate: GpuTexture,
  context: GpuCanvasContext,
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
      context.getCurrentTexture(),
    )
    const renderError = await state.device.popErrorScope()
    if (renderError) {
      throw new Error(
        `Worker WebGPU Canvas Pass 校验失败：${renderError.message ?? '未知错误'}`,
      )
    }
  } finally {
    uniform.destroy()
  }
}
