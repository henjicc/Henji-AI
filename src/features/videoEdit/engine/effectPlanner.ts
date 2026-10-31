import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import type { EffectQuality, EffectSize } from '@/core/imaging/effects/descriptor'
import type { VideoEditShaderClock } from '@/core/videoEdit/shaderGraph/effects'
import type { RecordingCursorRenderInput } from './videoEditRecordingCursorPlan'
import type { RecordingEffectsRenderInput } from './videoEditRecordingZoomPlan'
import type { VideoEditBuiltinPlan } from './effectPlan'

export type EffectPlannerInput = VideoEditBuiltinEffectInstance & VideoEditShaderClock & RecordingCursorRenderInput & RecordingEffectsRenderInput
export interface EffectPlannerFrame { width: number; height: number; frame: number; renderScale?: number; quality?: EffectQuality; referenceSize?: EffectSize; layer?: LayerEffectReference; split?: boolean }
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
