import { VIDEO_EDIT_TRANSITION_PRESETS, type VideoEditTransitionKind } from './transitions'

/**
 * 效果登记表（实施方案第六节“一份登记，三方共用”）：效果面板、效果控件与助手都读这里。
 * - 过渡（kind: 'transition'）由 `VIDEO_EDIT_TRANSITION_PRESETS` 生成，拖到时间线编辑点上；
 * - 内置效果（kind: 'effect'）登记在 `VIDEO_EDIT_BUILTIN_EFFECTS`，拖到片段上（4.7 接入 GPU 原生视频效果与音频效果）。
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
  // 4.7a：参数 schema（意图量纲、单位、范围与语义）在这里预留，接入内置效果时补上。
}
/**
 * 内置效果登记处。新增一个内置效果：在这里加一条
 * `{ id: 'effect:<ID>', name, category: 'video_effect' | 'audio_effect' | 'smart', kind: 'effect', media, description, tooltip }`，
 * 效果面板会自动出现在对应文件夹（拖到片段上的应用逻辑随 4.7 接入）。
 */
export const VIDEO_EDIT_BUILTIN_EFFECTS: readonly VideoEditEffectsRegistryEntry[] = []
/** 登记表全部条目：过渡在前（按预设顺序），内置效果在后。 */
export function videoEditEffectsRegistry(): VideoEditEffectsRegistryEntry[] {
  return [
    ...VIDEO_EDIT_TRANSITION_PRESETS.map((preset): VideoEditEffectsRegistryEntry => ({ id: `transition:${preset.kind}`, name: preset.name, category: preset.medium === 'audio' ? 'audio_transition' : 'video_transition', kind: 'transition', media: preset.medium, description: preset.description, tooltip: preset.tooltip, transitionKind: preset.kind })),
    ...VIDEO_EDIT_BUILTIN_EFFECTS,
  ]
}
