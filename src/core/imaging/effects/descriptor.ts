import type { z } from 'zod'
import type { ImagingParam } from '../parameterDefinition'

export type EffectQuality = 'interactive' | 'final'
export type EffectHost = 'image' | 'video'
export interface EffectSize { width: number; height: number }
export interface EffectEvaluationContext {
  /** 文档/序列完整画面，不得传视口、裁剪或 tile 尺寸。 */
  referenceSize: EffectSize
  /** 完整输出网格；tile 只影响执行分批。 */
  outputSize: EffectSize
  quality: EffectQuality
}
export interface EffectDescriptor<Parameters, Plan> {
  readonly id: string
  readonly name: string
  readonly aliases: readonly string[]
  readonly description: string
  readonly parameterSchema: z.ZodType<Parameters>
  readonly parameters: readonly ImagingParam[]
  readonly inputs: number
  readonly colorDomain: 'linear-light' | 'perceptual-working' | 'backend-defined'
  readonly workingSpaces: readonly string[]
  readonly alpha: 'premultiplied' | 'backend-defined'
  readonly boundary: readonly string[]
  readonly temporal: 'none' | 'time-and-seed' | 'history'
  readonly hosts: readonly EffectHost[]
  readonly backends: readonly { kind: 'cpu-reference' | 'wgsl' | 'shaders-component'; module: string }[]
  readonly fixtures: readonly string[]
  resolve(parameters: Parameters, context: EffectEvaluationContext): Plan
}
