import { VIDEO_EDIT_TRANSITION_PRESETS, type VideoEditTransitionKind } from './transitions'
import { videoEditTransitionParamDefinitions } from './transitionParams'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, VIDEO_EDIT_BUILTIN_GROUP_NAMES, videoEditBuiltinRefId, type VideoEditBuiltinParam } from './builtinEffects'

/**
 * 效果登记表（实施方案第六节“一份登记，三方共用”）：效果面板、效果控件与助手都读这里。
 * - 过渡（kind: 'transition'）由 `VIDEO_EDIT_TRANSITION_PRESETS` 生成，拖到时间线编辑点上；
 * - 内置效果（kind: 'effect'）登记在 `VIDEO_EDIT_BUILTIN_EFFECTS`，拖到片段上（4.7 GPU 原生视频效果；4.7c 音频效果，只加到声音片段）。
 * 面板按 `VIDEO_EDIT_EFFECT_CATEGORIES` 的顺序列文件夹。
 */
export const VIDEO_EDIT_EFFECT_CATEGORIES = [
  { id: 'video_effect', name: '视频效果' },
  { id: 'video_transition', name: '视频过渡' },
  { id: 'audio_effect', name: '音频效果' },
  { id: 'audio_transition', name: '音频过渡' },
  { id: 'smart', name: '智能' },
] as const
export type VideoEditEffectCategory = typeof VIDEO_EDIT_EFFECT_CATEGORIES[number]['id']
export interface VideoEditEffectsRegistryEntry {
  /** 稳定 ID：过渡为 `transition:<种类>`，内置效果为 `effect:<效果 ID>`。 */
  id: string
  name: string
  category: VideoEditEffectCategory
  kind: 'effect' | 'transition'
  /** 作用于画面还是声音。 */
  media: 'video' | 'audio'
  /** 给助手的语义说明（作用、适用场景、强度含义）；不直接显示在界面上。 */
  description: string
  /** 给用户的悬停说明（效果面板）。 */
  tooltip: string
  /** 过渡条目对应的过渡种类。 */
  transitionKind?: VideoEditTransitionKind
  /** 内置效果条目对应的内置效果 ID（参数 schema 见 `builtinEffects.ts`）。 */
  builtinId?: string
  /** 内置效果与带参数过渡的参数（意图量纲、单位、范围与语义）。 */
  params?: readonly VideoEditBuiltinParam[]
  /** 内置效果在文件夹里的小分组（模糊与锐化、颜色……）。 */
  group?: string
}
/**
 * 内置效果：来自 `VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS`（参数、范围、语义说明与 GPU 实现都在那里登记），
 * 拖到片段上或选中片段后双击即加到片段效果链。
 */
export const VIDEO_EDIT_BUILTIN_EFFECTS: readonly VideoEditEffectsRegistryEntry[] = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => ({
  id: videoEditBuiltinRefId(definition.id), name: definition.name, category: definition.media === 'audio' ? 'audio_effect' : 'video_effect', kind: 'effect', media: definition.media ?? 'video',
  description: definition.description, tooltip: definition.tooltip, builtinId: definition.id, params: definition.params, group: VIDEO_EDIT_BUILTIN_GROUP_NAMES[definition.group],
}))
/** 登记表全部条目：过渡在前（按预设顺序），内置效果在后。 */
export function videoEditEffectsRegistry(): VideoEditEffectsRegistryEntry[] {
  return [
    ...VIDEO_EDIT_TRANSITION_PRESETS.map((preset): VideoEditEffectsRegistryEntry => ({ id: `transition:${preset.kind}`, name: preset.name, category: preset.medium === 'audio' ? 'audio_transition' : 'video_transition', kind: 'transition', media: preset.medium, description: preset.description, tooltip: preset.tooltip, transitionKind: preset.kind, ...(videoEditTransitionParamDefinitions(preset.kind).length ? { params: videoEditTransitionParamDefinitions(preset.kind) } : {}) })),
    ...VIDEO_EDIT_BUILTIN_EFFECTS,
  ]
}
