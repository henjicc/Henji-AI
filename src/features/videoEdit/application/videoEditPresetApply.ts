import type { VideoEditPresetCategory } from '@/core/videoEdit/presetPackage'
import { applyStyleKitToSequence } from './videoEditStyleKits'
import { applyTitleTemplate } from './videoEditTitleTemplates'
import { applyVideoEditSubtitlePreset } from './videoEditSubtitlePresets'
import { applyVideoEditBuiltinEffect } from './videoEditCompositing'
import { applyVideoEditTransitionToSelection } from './videoEditTransitions'
import { requireVideoEditInstance } from './videoEditService'
import { videoEditPresetSource } from './videoEditPresetCatalog'

/**
 * One “apply” for the preset panel, delegating to each kind's existing service so undo, placement and
 * validation stay identical to the dedicated panels. Style binds the active sequence (the assistant follows its guide; nothing on the timeline changes); title lands at the
 * playhead; text styles all captions; effects and transitions act on the timeline selection.
 */
export async function applyVideoEditPreset(projectId: string, sequenceId: string, category: VideoEditPresetCategory, id: string): Promise<string> {
  const source = videoEditPresetSource(category, id)
  const owner = requireVideoEditInstance(projectId)
  switch (source.category) {
    case 'style': applyStyleKitToSequence(projectId, sequenceId, source.kit); return `本序列之后由 AI 按风格“${source.kit.name}”创作。`
    case 'title': applyTitleTemplate(projectId, sequenceId, source.template); return `已在播放头添加“${source.template.name}”。`
    case 'text': {
      const sequence = owner.document.sequences.find(value => value.id === sequenceId)
      if (!sequence?.captions?.length) throw new Error('这个序列还没有字幕；先生成或添加字幕，再套用文字样式。')
      applyVideoEditSubtitlePreset(projectId, sequenceId, id); return `已为全部字幕套用“${source.preset.name}”。`
    }
    case 'effect':
      if (!owner.selectedClipIds.length) throw new Error('先在时间线上选中片段，再套用效果预设。')
      if (!applyVideoEditBuiltinEffect(projectId, sequenceId, owner.selectedClipIds, `preset:${id}`).length) throw new Error('所选片段不能使用这个效果预设（画面与声音效果分开）。')
      return `已为所选片段添加“${source.preset.name}”。`
    case 'transition': await applyVideoEditTransitionToSelection(projectId, source.kind); return '已在所选片段处添加转场。'
  }
}
