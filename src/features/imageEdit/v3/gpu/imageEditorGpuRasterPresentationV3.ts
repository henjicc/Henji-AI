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

/** 把线性 working-space target 统一 tone-map/转换到 sRGB 呈现表面。 */
export class ImageEditorGpuRasterPresentationV3 {
  private readonly presentDraw
  private readonly colorBuffer
  private bindGroup: ReturnType<Gpu['gpu']['createBindGroup']> | null = null
  private source: Target | null = null
  private canvas: OffscreenCanvas | null = null
  private canvasSurface: Surface | null = null
  private compilePromise: Promise<void> | null = null
  private compiled = false

  constructor(private readonly gpu: Gpu, private readonly onCompiled: () => void) {
    this.presentDraw = draw(gpu, {
      shader: presentShaderSource, vertices: 3, label: 'image-editor-gpu-raster-present',
    })
    this.colorBuffer = gpu.gpu.createBuffer({
      size: 64, usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      label: 'image-editor-gpu-raster-present-color',
    })
  }

  async render(output: Target, color: ImageEditColorModeV3): Promise<ImageBitmap> {
    const presentation = await this.ensureSurface(output)
    this.writeColor(color)
    this.bind(output)
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass({ target: presentation, clear: CLEAR }, this.presentDraw)
    })
    await submitted.done
    return this.canvas!.transferToImageBitmap()
  }

  async readPixels(output: Target, color: ImageEditColorModeV3): Promise<Uint8Array> {
    const presentation = target(this.gpu, {
      size: output.size, format: 'rgba8unorm', clearColor: CLEAR,
      label: 'image-editor-gpu-presentation-test',
    })
    await this.presentDraw.compile(presentation)
    this.writeColor(color)
    this.bind(output)
    const submitted = frame(this.gpu, (currentFrame) => {
      currentFrame.pass(presentation, this.presentDraw)
    })
    await submitted.done
    const pixels = await presentation.read()
    presentation.color.destroy()
    return pixels
  }

  dispose(): void {
    this.colorBuffer.destroy()
    this.canvasSurface?.dispose()
    this.canvasSurface = null
    this.canvas = null
  }

  private async ensureSurface(output: Target): Promise<Surface> {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('GPU Scene Worker 缺少 OffscreenCanvas')
    const size = output.size
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(size[0], size[1])
      this.canvasSurface = surface(this.gpu, this.canvas, {
        autoResize: false, size, alphaMode: 'premultiplied', colorSpace: 'srgb',
        label: 'image-editor-gpu-raster-presentation',
      })
    } else if (this.canvas.width !== size[0] || this.canvas.height !== size[1]) {
      this.canvasSurface!.resize(size)
    }
    if (!this.compiled) {
      this.compilePromise ??= (async () => {
        await this.presentDraw.compile({ colors: [this.canvasSurface!.format], sampleCount: 1 })
        this.compiled = true
        this.onCompiled()
      })()
      try { await this.compilePromise } catch (error) {
        this.compilePromise = null
        throw error
      }
    }
    return this.canvasSurface!
  }

  private writeColor(color: ImageEditColorModeV3): void {
    const present = imageEditorGpuPresentColorUniformV3(color)
    this.gpu.gpu.queue.writeBuffer(this.colorBuffer, 0, new Float32Array([
      ...packImageEditorGpuColorMatrixRowsV3(present.workingToSrgb),
      present.toneMapToSdr ? 1 : 0, 0, 0, 0,
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
}
