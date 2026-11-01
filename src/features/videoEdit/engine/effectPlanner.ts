import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import type { EffectQuality, EffectSize } from '@/core/imaging/effects/descriptor'
import type { RecordingCursorRenderInput } from './videoEditRecordingCursorPlan'
import type { RecordingEffectsRenderInput } from './videoEditRecordingZoomPlan'
import type { VideoEditBuiltinPlan } from './effectPlan'

export type EffectPlannerInput = VideoEditBuiltinEffectInstance & RecordingCursorRenderInput & RecordingEffectsRenderInput
/**
 * 效果时钟。两条路径的时间基准不同，是有意的：
 * - 片段效果链：`frame` 是片段内的时间线帧号（整数）。不跟片段的变速、倒放、时间重映射走，剃刀剪开后从 0 重新算。
 * - 作者图层与调整层：`frame` 是代码素材源时间对应的帧位置，可以带小数（慢放时每个输出帧都前进）。跟变速、倒放、重映射走，static 模块恒为 0。
 * `frameDuration` 是同一时钟每帧的秒数。随时间连续变化的效果用 `effectClockSeconds` 求秒数，不另传秒数；
 * 预热与精度判定只在第 0 帧规划，不给帧时长。
 */
export interface EffectPlannerFrame { width: number; height: number; frame: number; frameDuration?: number; renderScale?: number; quality?: EffectQuality; referenceSize?: EffectSize; layer?: LayerEffectReference; split?: boolean }
/**
 * 随时间连续变化的效果在规划里求秒数。`position` 是效果 frameSeed 的返回值：帧位置，或画面不变时的常量 0。
 * 位置不为 0 却没有帧时长时报错，漏接时钟的调用方不会悄悄停在第 0 秒。
 */
export function effectClockSeconds(frameDuration: number | undefined, position: number): number {
  if (position === 0) return 0
  if (frameDuration === undefined || !(frameDuration > 0)) throw new Error('效果时钟缺少帧时长：随时间变化的效果要由调用方传入每帧秒数。')
  return position * frameDuration
}
/** 效果单同时声明规划与 WGSL 入口；索引只导出此对象或此对象的数组。 */
export interface EffectPlanner {
  readonly id: string
  readonly plan: (params: VideoEditBuiltinParams, frame: EffectPlannerFrame, instance: EffectPlannerInput) => VideoEditBuiltinPlan
  readonly entries: readonly string[]
  readonly wgsl: string
  /** 只声明具名共享块；数学和 ABI 不得内嵌到效果自己的 WGSL 中。 */
  readonly shared?: readonly EffectShaderBlock[]
  readonly unfilteredSourceEntries?: readonly string[]
  /** 需要鼠标、缩放路径等宿主输入的效果不进入独立素材预览。 */
  readonly preview?: boolean
}

export interface EffectShaderBlock { readonly name: string; readonly wgsl: string }
/** const 泛型保留内联入口的字面量；没有自有入口的规划只消费共享前导块。 */
export function definePlanner<const Entries extends readonly string[] = readonly []>(definition: Omit<EffectPlanner, 'entries' | 'wgsl'> & { readonly entries?: Entries; readonly wgsl?: string }): EffectPlanner & { readonly entries: Entries } {
  return { ...definition, entries: (definition.entries ?? []) as unknown as Entries, wgsl: definition.wgsl ?? '' }
}
