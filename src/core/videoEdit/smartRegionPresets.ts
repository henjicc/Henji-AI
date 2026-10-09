import { parseVideoEditBuiltinRefId, requireVideoEditBuiltinEffect } from './builtinEffects'
import type { SmartRegionMaskSetting } from './smartRegions'

/*
 * 智能区域的一键预设（任务 4.7d，效果面板“智能”文件夹）：一个内置效果 + 一个作用区域，拖到片段上一步到位，
 * 之后在效果控件里微调强度、区域与羽化。预设只是创建时的模板，加到片段上就是普通的内置效果（带 mask），
 * 助手用通用实体读写得到同样结果（definition_id + mask），不需要预设专用接口。
 */

export interface VideoEditSmartPreset {
  id: string
  name: string
  /** 给用户的悬停说明。 */
  tooltip: string
  /** 给助手的语义说明。 */
  description: string
  builtinId: string
  params: Readonly<Record<string, number | string | boolean>>
  mask: SmartRegionMaskSetting
}

export const VIDEO_EDIT_SMART_PRESETS: readonly VideoEditSmartPreset[] = [
  { id: 'face_mosaic', name: '人脸打码', tooltip: '自动找出每张人脸，逐帧跟随打上马赛克', description: '马赛克（块大小 40）+ 人脸区域。', builtinId: 'mosaic', params: { block_size: 40 }, mask: { regionId: 'face' } },
  { id: 'face_blur', name: '人脸模糊', tooltip: '自动找出每张人脸，逐帧跟随模糊', description: '高斯模糊（标准差为画面高度的 1.8%）+ 人脸区域。', builtinId: 'gaussian_blur', params: { sigma_fraction_height: 0.018 }, mask: { regionId: 'face' } },
  { id: 'background_blur', name: '背景虚化', tooltip: '人物保持清晰，背景模糊', description: '高斯模糊（标准差为画面高度的 1.05%）+ 背景区域（人物抠像取反）。', builtinId: 'gaussian_blur', params: { sigma_fraction_height: 0.0105 }, mask: { regionId: 'background' } },
  { id: 'background_darken', name: '背景压暗', tooltip: '压暗人物以外的部分，突出人物', description: '亮度与对比度（亮度 -35）+ 背景区域。', builtinId: 'brightness_contrast', params: { brightness: -35 }, mask: { regionId: 'background' } },
  { id: 'text_mosaic', name: '文字打码', tooltip: '找出画面里的文字（字幕、标牌、水印）打上马赛克', description: '马赛克（块大小 25）+ 文字区域。擦除文字的第一版：遮挡而不是修补背景。', builtinId: 'mosaic', params: { block_size: 25 }, mask: { regionId: 'text' } },
  { id: 'text_blur', name: '文字模糊', tooltip: '找出画面里的文字，模糊掉', description: '高斯模糊（标准差为画面高度的 1.5%）+ 文字区域。', builtinId: 'gaussian_blur', params: { sigma_fraction_height: 0.015 }, mask: { regionId: 'text' } },
]

export const VIDEO_EDIT_SMART_PRESET_PREFIX = 'smart:'
export function videoEditSmartPresetRef(id: string): string { return `${VIDEO_EDIT_SMART_PRESET_PREFIX}${id}` }

/** 效果面板条目的引用（`effect:<ID>`、裸内置效果 ID 或 `smart:<预设>`）→ 创建效果用的模板。 */
export interface VideoEditEffectTemplate { builtinId: string; params?: Readonly<Record<string, unknown>>; mask?: SmartRegionMaskSetting; name?: string }
export function resolveVideoEditEffectTemplate(ref: string): VideoEditEffectTemplate | undefined {
  if (ref.startsWith(VIDEO_EDIT_SMART_PRESET_PREFIX)) {
    const preset = VIDEO_EDIT_SMART_PRESETS.find(entry => entry.id === ref.slice(VIDEO_EDIT_SMART_PRESET_PREFIX.length))
    return preset && { builtinId: preset.builtinId, params: preset.params, mask: preset.mask, name: preset.name }
  }
  const builtinId = parseVideoEditBuiltinRefId(ref)
  return builtinId ? { builtinId } : undefined
}

/** 预设引用的内置效果与参数都在登记表里（单测守护）。 */
export function validateVideoEditSmartPresets(): void {
  for (const preset of VIDEO_EDIT_SMART_PRESETS) {
    const definition = requireVideoEditBuiltinEffect(preset.builtinId)
    for (const key of Object.keys(preset.params)) if (!definition.params.some(param => param.key === key)) throw new Error(`预设 ${preset.id} 的参数 ${key} 不在 ${preset.builtinId} 里。`)
  }
}
