import { styleVideoEditSubtitles } from './videoEditAutoSubtitles'
import { listVideoEditSubtitlePresets } from './videoEditSubtitlePresetList'

export { listVideoEditSubtitlePresets, type VideoEditSubtitlePreset } from './videoEditSubtitlePresetList'
export function applyVideoEditSubtitlePreset(projectId: string, sequenceId: string, presetId: string, ids?: readonly string[]): void {
  const preset = listVideoEditSubtitlePresets().find(preset => preset.id === presetId)
  if (!preset) throw new Error('原预设已删除，请重新选择。')
  styleVideoEditSubtitles(projectId, sequenceId, preset.style, ids)
}
