import { VIDEO_EDIT_SUBTITLE_PRESETS, styleKitSubtitleStyle, videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import { resolveVideoEditStyleKit, type StyleKit } from '@/core/videoEdit/styleKit'
import { requireVideoEditInstance } from './videoEditService'
import { styleVideoEditSubtitles } from './videoEditAutoSubtitles'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'

export interface VideoEditSubtitlePreset { id: string; name: string; style: VideoEditSubtitleStyle }
export const STYLE_SUBTITLE_PRESET_ID = 'style:current'
/** Subtitle builtins plus a projection of the single shared local typography library; a bound style adds a following preset first. */
export function listVideoEditSubtitlePresets(kit?: StyleKit): VideoEditSubtitlePreset[] {
  return structuredClone([...(kit ? [{ id: STYLE_SUBTITLE_PRESET_ID, name: `跟随风格：${kit.name}`, style: styleKitSubtitleStyle(kit) }] : []), ...VIDEO_EDIT_SUBTITLE_PRESETS, ...videoEditTextPresetLibrary.list().map(preset => ({ ...preset, style: videoEditSubtitleStyleSchema.parse(preset.style) }))])
}
export function applyVideoEditSubtitlePreset(projectId: string, sequenceId: string, presetId: string, ids?: readonly string[]): void {
  const document = requireVideoEditInstance(projectId).document; const sequence = document.sequences.find(value => value.id === sequenceId)
  const preset = listVideoEditSubtitlePresets(sequence ? resolveVideoEditStyleKit(document, sequence) : undefined).find(preset => preset.id === presetId)
  if (!preset) throw new Error('原预设已删除，请重新选择。')
  styleVideoEditSubtitles(projectId, sequenceId, preset.style, ids)
}
