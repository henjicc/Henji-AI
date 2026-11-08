import { normalizeVideoEditBuiltinParams, parseVideoEditBuiltinRefId } from './builtinEffects'
import type { SmartRegionMaskSetting } from './smartRegions'
import { WHITE_HEX } from '../theme/colorTokens'

/*
 * 智能区域的一键预设（效果面板“智能”文件夹）：一个内置效果，加一个作用区域或按人物轮廓工作的参数，拖到片段上一步到位，
 * 之后在效果控件里微调。预设只是创建时的模板，加到片段上就是普通的内置效果（带 mask 或轮廓来源“主体”），
 * 助手用通用实体读写得到同样结果（definition_id + parameters + mask），不需要预设专用接口。
 */

export interface VideoEditSmartPreset {
  id: string
  name: string
  /** 一份说明，效果面板悬停与助手读同一句：先说看得见的结果，再写加上的是哪个效果、什么参数。 */
  description: string
  builtinId: string
  params: Readonly<Record<string, number | string | boolean>>
  /** 作用区域；按人物轮廓工作的效果（主体抠像、轮廓来源为主体）自己取人物蒙版，不带区域。 */
  mask?: SmartRegionMaskSetting
}

export const VIDEO_EDIT_SMART_PRESETS: readonly VideoEditSmartPreset[] = [
  { id: 'face_mosaic', name: '人脸打码', description: '自动找出每张人脸，逐帧跟随打上马赛克。加上的是马赛克（块大小 40）+ 人脸区域。', builtinId: 'mosaic', params: { block_size: 40 }, mask: { regionId: 'face' } },
  { id: 'face_blur', name: '人脸模糊', description: '自动找出每张人脸，逐帧跟随模糊。加上的是模糊（均匀，模糊度 61，约为画面高度的 1.8%）+ 人脸区域。', builtinId: 'blur', params: { amount: 61 }, mask: { regionId: 'face' } },
  { id: 'background_blur', name: '背景虚化', description: '人物保持清晰，背景模糊。加上的是模糊（均匀，模糊度 44，约为画面高度的 1%）+ 背景区域（人物以外）。', builtinId: 'blur', params: { amount: 44 }, mask: { regionId: 'background' } },
  { id: 'background_darken', name: '背景压暗', description: '压暗人物以外的部分，突出人物。加上的是全能调色（曝光 -1 档）+ 背景区域。', builtinId: 'color_grade', params: { exposure: -1 }, mask: { regionId: 'background' } },
  { id: 'text_mosaic', name: '文字打码', description: '找出画面里的文字（字幕、标牌、水印）打上马赛克，是遮挡而不是修补背景。加上的是马赛克（块大小 25）+ 文字区域。', builtinId: 'mosaic', params: { block_size: 25 }, mask: { regionId: 'text' } },
  { id: 'text_blur', name: '文字模糊', description: '找出画面里的文字，模糊掉。加上的是模糊（均匀，模糊度 55，约为画面高度的 1.5%）+ 文字区域。', builtinId: 'blur', params: { amount: 55 }, mask: { regionId: 'text' } },
  { id: 'subject_key', name: '主体抠像', description: '把人物抠出来，背景变透明，透出下面轨道的画面。加上的是主体抠像（默认参数）。', builtinId: 'subject_key', params: {} },
  { id: 'subject_stroke', name: '主体描边', description: '沿人物轮廓描一圈白边，像贴纸。加上的是描边（外侧，白色，粗细 60，轮廓来源主体）。', builtinId: 'stroke', params: { position: 'outside', color: WHITE_HEX, width: 60, contour: 'subject' } },
  { id: 'subject_glow', name: '主体发光', description: '人物身后沿轮廓透出一圈光。加上的是发光（轮廓方式，强度 50，半径 40，轮廓来源主体）。', builtinId: 'glow', params: { mode: 'shape', strength: 50, radius: 40, contour: 'subject' } },
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

/** 预设引用的内置效果与参数都在登记表里、取值在范围内（单测守护）。 */
export function validateVideoEditSmartPresets(): void {
  for (const preset of VIDEO_EDIT_SMART_PRESETS) normalizeVideoEditBuiltinParams(preset.builtinId, preset.params)
}
