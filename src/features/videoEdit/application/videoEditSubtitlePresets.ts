import { VIDEO_EDIT_SUBTITLE_PRESETS, videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import { styleVideoEditSubtitles } from './videoEditAutoSubtitles'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'

export interface VideoEditSubtitlePreset { id: string; name: string; style: VideoEditSubtitleStyle }
/** Subtitle builtins plus a projection of the single shared local typography library. */
export function listVideoEditSubtitlePresets(): VideoEditSubtitlePreset[] {
  return structuredClone([...VIDEO_EDIT_SUBTITLE_PRESETS, ...videoEditTextPresetLibrary.list().map(preset => ({ ...preset, style: videoEditSubtitleStyleSchema.parse(preset.style) }))])
}
export function applyVideoEditSubtitlePreset(projectId: string, sequenceId: string, presetId: string, ids?: readonly string[]): void {
  const preset = listVideoEditSubtitlePresets().find(preset => preset.id === presetId)
  if (!preset) throw new Error('原预设已删除，请重新选择。')
  styleVideoEditSubtitles(projectId, sequenceId, preset.style, ids)
}
