import { effect, target, type Effect, type Gpu, type Target } from 'vgpu'

import cropShader from './shaders/imageEditorGpuEffectCropV3.wgsl?raw'

const CLEAR = [0, 0, 0, 0] as const

/** 效果 overscan 的同帧末端裁切；输出仍为线性预乘 rgba16 Target。 */
export class ImageEditorGpuEffectCropperV3 {
  private readonly drawable: Effect
  private readonly output: Target
  private compiled = false

  constructor(private readonly gpu: Gpu, private readonly onCompiled: () => void) {
    this.drawable = effect(gpu, cropShader, { label: 'image-editor-effect-overscan-crop' })
    this.output = target(gpu, { size: [1, 1], format: 'rgba16float', clearColor: CLEAR,
      label: 'image-editor-effect-viewport-output' })
  }

  prepare(source: Target, size: readonly [number, number], offset: readonly [number, number]): Target {
    this.output.resize(size)
    this.drawable.set({ source, crop: { offset, sourceSize: source.size } })
    return this.output
  }

  async compile(): Promise<void> {
    if (this.compiled) return
    await this.drawable.compile(this.output)
    this.compiled = true
    this.onCompiled()
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): void {
    currentFrame.pass({ target: this.output, clear: CLEAR }, this.drawable)
  }

  dispose(): void { this.output.color.destroy() }
}
