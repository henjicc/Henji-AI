import { VIDEO_EDIT_SUBTITLE_PRESETS, videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'

export interface VideoEditSubtitlePreset { id: string; name: string; style: VideoEditSubtitleStyle }
/** Subtitle builtins plus a projection of the single shared local typography library. */
export function listVideoEditSubtitlePresets(): VideoEditSubtitlePreset[] {
  return structuredClone([...VIDEO_EDIT_SUBTITLE_PRESETS, ...videoEditTextPresetLibrary.list().map(preset => ({ ...preset, style: videoEditSubtitleStyleSchema.parse(preset.style) }))])
}
