import { videoEditBuiltinDefaults, type VideoEditBuiltinEffectDefinition } from '../../videoEdit/builtinEffects'

/** 效果槽里的一个效果（音频编辑效果组、剪辑轨道与主轨效果的公共形状）。 */
export interface AudioRackEffect { id: string; name: string; enabled: boolean; amount: number; builtin: { id: string; params: Record<string, number | string | boolean> } }

/** 按定义建一个效果（默认参数、强度 100%）。 */
export function createAudioRackEffect(definition: VideoEditBuiltinEffectDefinition): AudioRackEffect {
  return { id: crypto.randomUUID(), name: definition.name, enabled: true, amount: 1, builtin: { id: definition.id, params: videoEditBuiltinDefaults(definition) as AudioRackEffect['builtin']['params'] } }
}
