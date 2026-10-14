import { resolveVideoEditStyleKit } from '@/core/videoEdit/styleKit'
import { requireVideoEditInstance } from './videoEditService'
import { styleVideoEditSubtitles } from './videoEditAutoSubtitles'
import { listVideoEditSubtitlePresets } from './videoEditSubtitlePresetList'

export { listVideoEditSubtitlePresets, STYLE_SUBTITLE_PRESET_ID, type VideoEditSubtitlePreset } from './videoEditSubtitlePresetList'
export function applyVideoEditSubtitlePreset(projectId: string, sequenceId: string, presetId: string, ids?: readonly string[]): void {
  const document = requireVideoEditInstance(projectId).document; const sequence = document.sequences.find(value => value.id === sequenceId)
  const preset = listVideoEditSubtitlePresets(sequence ? resolveVideoEditStyleKit(document, sequence) : undefined).find(preset => preset.id === presetId)
  if (!preset) throw new Error('原预设已删除，请重新选择。')
  styleVideoEditSubtitles(projectId, sequenceId, preset.style, ids)
}
