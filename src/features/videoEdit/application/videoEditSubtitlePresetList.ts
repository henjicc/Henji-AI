import { VIDEO_EDIT_SUBTITLE_PRESETS, styleKitSubtitleStyle, videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import type { StyleKit } from '@/core/videoEdit/styleKit'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'

export interface VideoEditSubtitlePreset { id: string; name: string; style: VideoEditSubtitleStyle }
export const STYLE_SUBTITLE_PRESET_ID = 'style:current'
/** Subtitle builtins plus a projection of the single shared local typography library; a bound style adds a following preset first. */
export function listVideoEditSubtitlePresets(kit?: StyleKit): VideoEditSubtitlePreset[] {
  return structuredClone([...(kit ? [{ id: STYLE_SUBTITLE_PRESET_ID, name: `跟随风格：${kit.name}`, style: styleKitSubtitleStyle(kit) }] : []), ...VIDEO_EDIT_SUBTITLE_PRESETS, ...videoEditTextPresetLibrary.list().map(preset => ({ ...preset, style: videoEditSubtitleStyleSchema.parse(preset.style) }))])
}
