import type { GpuTexture } from '../../../../core/imageEdit/worker/webgpuRuntimeSupport'
import { isShaderTransition, shaderEffectDefinition } from '../../../../core/videoEdit/shaderLibrary/catalog'
import { normalizeVideoEditBuiltinParams, type VideoEditBuiltinParams } from '../../../../core/videoEdit/builtinEffects'
import { normalizeVideoEditTransitionParams } from '../../../../core/videoEdit/transitionParams'
import type { VideoEditBuiltinEffectsGpu } from '../videoEditBuiltinEffectsGpu'
import type { ShaderLibraryClock } from './planner'

export interface ShaderLibraryRenderRequest {
  name: string
  params?: Readonly<Record<string, unknown>>
  timeSeconds: number
  width: number
  height: number
  format: string
  input: GpuTexture
  output: GpuTexture
  second?: GpuTexture
  progress?: number
  emptyOutgoing?: boolean
  emptyIncoming?: boolean
}
/** t62 and thumbnails inject the host's existing runtime, GPUDevice and budget. No device creation. */
export class TrustedShaderLibraryRenderer {
  constructor(private readonly host: Pick<VideoEditBuiltinEffectsGpu, 'render' | 'renderTransition'>) {}
  async render(request: ShaderLibraryRenderRequest): Promise<void> {
    const { name, timeSeconds, width, height, format, input, output } = request
    if (!Number.isFinite(timeSeconds)) throw new Error('着色器需要有限的剪辑秒时间。')
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('着色器需要有效的目标尺寸。')
    if ([input, request.second].includes(output)) throw new Error('着色器输入与目标不能是同一纹理。')
    if (isShaderTransition(name)) {
      if (!request.second) throw new Error('转场需要前后两幅输入画面。')
      const progress = request.progress
      if (progress === undefined || !Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('转场进度需要在 0 到 1 之间。')
      await this.host.renderTransition({ kind: name, progress, params: normalizeVideoEditTransitionParams(name, name, request.params), emptyOutgoing: request.emptyOutgoing ?? false, emptyIncoming: request.emptyIncoming ?? false }, input, request.second, output, { width, height, format })
      return
    }
    if (!shaderEffectDefinition(name)) throw new Error(`没有登记的着色器“${name}”。请从着色器目录选择名称。`)
    const params: VideoEditBuiltinParams = normalizeVideoEditBuiltinParams(name, request.params)
    const instance: { id: string; params: VideoEditBuiltinParams } & ShaderLibraryClock = { id: name, params, shaderTimeSeconds: timeSeconds }
    await this.host.render(instance, { texture: input, width, height, format }, output, 0)
  }
}
