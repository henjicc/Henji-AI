import { draw, frame, surface, target, type Gpu, type Surface, type Target } from 'vgpu'

import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import {
  imageEditorGpuPresentColorUniformV3,
  packImageEditorGpuColorMatrixRowsV3,
} from './imageEditorGpuColorPipelineV3'
import presentShaderSource from './shaders/imageEditorGpuRasterPresentV3.wgsl?raw'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const

export type ImageEditorGpuPresentationResultV3 =
  | {
      kind: 'webgpu-surface'
      surfaceGeneration: number
      width: number
      height: number
    }
  | {
      kind: 'gpu-image-bitmap'
      surfaceGeneration: number
      width: number
      height: number
      bitmap: ImageBitmap
      surfaceFailureReason?: string
    }

interface DirectSurfaceStateV3 {
  generation: number
  surface: Surface
}
type PresentationFormatV3 = Target['format']

class ImageEditorGpuSurfaceFrameSupersededV3 extends Error {}

/**
 * 现有 rgba16float output 的唯一呈现出口。
 *
 * 首选传入的可见 OffscreenCanvas Surface；该 Surface 代际失效后只在同一 GPU
 * 会话内降到隐藏 ImageBitmap Surface，不会在热路径重建或反复重试失败 Surface。
 */
export class ImageEditorGpuRasterPresentationV3 {
  private readonly presentDraw
  private readonly colorBuffer
  private readonly unsubscribeError: () => void
  private readonly compiledFormats = new Set<PresentationFormatV3>()
  private bindGroup: ReturnType<Gpu['gpu']['createBindGroup']> | null = null
  private source: Target | null = null
  private direct: DirectSurfaceStateV3 | null = null
  private attachedSurfaceGeneration = 0
  private failedSurfaceGeneration = 0
  private surfaceFailureReason: string | null = null
  private bitmapCanvas: OffscreenCanvas | null = null
  private bitmapSurface: Surface | null = null
  private reportedError: Error | null = null
  private disposed = false

  constructor(private readonly gpu: Gpu, private readonly onCompiled: () => void) {
    this.presentDraw = draw(gpu, {
      shader: presentShaderSource,
      vertices: 3,
      label: 'image-editor-gpu-raster-present',
    })
    this.colorBuffer = gpu.gpu.createBuffer({
      size: 64,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      label: 'image-editor-gpu-raster-present-color',
    })
    this.unsubscribeError = gpu.onError((error) => {
      this.reportedError = error instanceof Error ? error : new Error(String(error))
    })
  }

  attachSurface(canvas: OffscreenCanvas, generation: number): void {
    this.assertUsable()
    if (!Number.isSafeInteger(generation) || generation <= this.attachedSurfaceGeneration) return
    this.direct?.surface.dispose()
    this.direct = null
    this.attachedSurfaceGeneration = generation
    this.failedSurfaceGeneration = 0
    this.surfaceFailureReason = null
    try {
      const size = [Math.max(1, canvas.width), Math.max(1, canvas.height)] as const
      this.direct = {
        generation,
        surface: surface(this.gpu, canvas, {
          autoResize: false,
          size,
          alphaMode: 'premultiplied',
          colorSpace: 'srgb',
          label: `image-editor-gpu-direct-surface:${generation}`,
        }),
      }
    } catch (error) {
      this.failedSurfaceGeneration = generation
      this.surfaceFailureReason = errorMessage(error)
    }
  }

  async render(
    output: Target,
    color: ImageEditColorModeV3,
    surfaceGeneration: number,
    acceptsSurfaceSubmit: () => boolean,
  ): Promise<ImageEditorGpuPresentationResultV3> {
    this.assertUsable()
    this.writeColor(color)
    this.bind(output)
    let surfaceFailureReason = surfaceGeneration === this.attachedSurfaceGeneration
      ? this.surfaceFailureReason ?? undefined
      : undefined
    const direct = this.direct
    if (direct
      && direct.generation === surfaceGeneration
      && this.failedSurfaceGeneration !== surfaceGeneration) {
      if (!acceptsSurfaceSubmit()) throw new ImageEditorGpuSurfaceFrameSupersededV3()
      try {
        await this.renderToSurface(direct.surface, output.size, acceptsSurfaceSubmit)
        return {
          kind: 'webgpu-surface',
          surfaceGeneration,
          width: output.size[0],
          height: output.size[1],
        }
      } catch (error) {
        if (error instanceof ImageEditorGpuSurfaceFrameSupersededV3) throw error
        surfaceFailureReason = errorMessage(error)
        this.surfaceFailureReason = surfaceFailureReason
        this.failedSurfaceGeneration = surfaceGeneration
        direct.surface.dispose()
        if (this.direct === direct) this.direct = null
      }
    }
    const bitmapSurface = await this.ensureBitmapSurface(output.size)
    await this.submit(bitmapSurface)
    if (surfaceFailureReason) this.surfaceFailureReason = null
    return {
      kind: 'gpu-image-bitmap',
      surfaceGeneration,
      width: output.size[0],
      height: output.size[1],
      bitmap: this.bitmapCanvas!.transferToImageBitmap(),
      ...(surfaceFailureReason ? { surfaceFailureReason } : {}),
    }
  }

  async readPixels(output: Target, color: ImageEditColorModeV3): Promise<Uint8Array> {
    this.assertUsable()
    const presentation = target(this.gpu, {
      size: output.size,
      format: 'rgba8unorm',
      clearColor: CLEAR,
      label: 'image-editor-gpu-presentation-test',
    })
    try {
      await this.ensureCompiled(presentation.format)
      this.writeColor(color)
      this.bind(output)
      await this.submit(presentation)
      return await presentation.read()
    } finally {
      presentation.color.destroy()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeError()
    this.colorBuffer.destroy()
    this.direct?.surface.dispose()
    this.bitmapSurface?.dispose()
    this.direct = null
    this.bitmapSurface = null
    this.bitmapCanvas = null
  }

  private async renderToSurface(
    targetSurface: Surface,
    size: readonly [number, number],
    acceptsSurfaceSubmit: () => boolean,
  ): Promise<void> {
    if (targetSurface.size[0] !== size[0] || targetSurface.size[1] !== size[1]) {
      targetSurface.resize(size)
    }
    await this.ensureCompiled(targetSurface.format)
    if (!acceptsSurfaceSubmit()) throw new ImageEditorGpuSurfaceFrameSupersededV3()
    await this.submit(targetSurface)
  }

  private async ensureBitmapSurface(size: readonly [number, number]): Promise<Surface> {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('GPU Scene Worker 缺少 OffscreenCanvas')
    if (!this.bitmapCanvas) {
      this.bitmapCanvas = new OffscreenCanvas(size[0], size[1])
      this.bitmapSurface = surface(this.gpu, this.bitmapCanvas, {
        autoResize: false,
        size,
        alphaMode: 'premultiplied',
        colorSpace: 'srgb',
        label: 'image-editor-gpu-bitmap-presentation',
      })
    } else if (this.bitmapSurface!.size[0] !== size[0]
      || this.bitmapSurface!.size[1] !== size[1]) {
      this.bitmapSurface!.resize(size)
    }
    await this.ensureCompiled(this.bitmapSurface!.format)
    return this.bitmapSurface!
  }

  private async ensureCompiled(format: PresentationFormatV3): Promise<void> {
    if (this.compiledFormats.has(format)) return
    await this.presentDraw.compile({ colors: [format], sampleCount: 1 })
    this.compiledFormats.add(format)
    this.onCompiled()
  }

  private async submit(presentation: Target): Promise<void> {
    this.reportedError = null
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: presentation, clear: CLEAR }, this.presentDraw)
    })
    await submitted.done
    await this.gpu.settled()
    if (this.reportedError) {
      const error = this.reportedError
      this.reportedError = null
      throw error
    }
  }

  private writeColor(color: ImageEditColorModeV3): void {
    const present = imageEditorGpuPresentColorUniformV3(color)
    this.gpu.gpu.queue.writeBuffer(this.colorBuffer, 0, new Float32Array([
      ...packImageEditorGpuColorMatrixRowsV3(present.workingToSrgb),
      present.toneMapToSdr ? 1 : 0,
      0,
      0,
      0,
    ]))
  }

  private bind(output: Target): void {
    if (this.source === output && this.bindGroup) return
    this.bindGroup = this.gpu.gpu.createBindGroup({
      layout: this.presentDraw.layout(0),
      entries: [
        { binding: 0, resource: output.color.view },
        { binding: 1, resource: { buffer: this.colorBuffer } },
      ],
    })
    this.presentDraw.group(0, this.bindGroup)
    this.source = output
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU 呈现器已销毁')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
