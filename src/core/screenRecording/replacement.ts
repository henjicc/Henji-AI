import { splitVideoEditClip, type VideoEditDocument, type VideoEditMedia } from '../videoEdit/document'
import { videoEditClipSourceRange, videoEditClipSpeedValue, videoEditSpeedRatio } from '../videoEdit/clipSpeed'
import type { RecordingDocument } from './document'
import type { RecordingScript } from './script'

export interface RecordingReplacement { step: RecordingScript['steps'][number]; media: VideoEditMedia }
const pathKey = (value: string): string => /^[a-z]:/i.test(value) ? value.replaceAll('\\', '/').toLowerCase() : value.replaceAll('\\', '/')
/** Edits a detached import draft. Keep narration and all other lanes exactly where they were. */
export function replaceRecordingSteps(draft: VideoEditDocument, recording: RecordingDocument, replacements: RecordingReplacement[]): number {
  let replaced = 0
  for (const { step, media } of replacements) {
    const sourceMedia = recording.media.filter(v => v.kind === 'screen')
    let stepReplaced = 0
    for (let si = 0; si < draft.sequences.length; si++) {
      let sequence = draft.sequences[si]
      const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
      for (const original of [...sequence.clips]) {
        if (original.kind !== 'video' || original.sourceComponent === 'audio') continue
        const oldItem = draft.items.find(v => v.id === original.itemId)
        const oldMedia = draft.media.find(v => v.id === oldItem?.mediaId)
        const source = oldMedia && sourceMedia.find(v => pathKey(v.path) === pathKey(oldMedia.path))
        if (!source) continue
        const range = videoEditClipSourceRange(original, fps)
        const from = Math.max(step.startUs, source.monoUs + range.from * 1e6), to = Math.min(step.endUs, source.monoUs + range.to * 1e6)
        if (to <= from) continue
        if (original.reverse || sequence.tracks.some(v => v.index === original.track && v.locked) || sequence.transitions?.some(v => v.leftClipId === original.id || v.rightClipId === original.id)) throw new Error('目标步骤包含锁定、倒放或转场片段，请先解除这些编辑再重录。')
        const speed = videoEditClipSpeedValue(original)
        const start = Math.max(original.start, original.start + Math.round((from - source.monoUs - range.from * 1e6) * fps / (1e6 * speed)))
        const end = Math.min(original.start + original.duration, original.start + Math.round((to - source.monoUs - range.from * 1e6) * fps / (1e6 * speed)))
        if (end <= start) continue
        if (end < original.start + original.duration) sequence = splitVideoEditClip(sequence, original.id, end)
        if (start > original.start) sequence = splitVideoEditClip(sequence, original.id, start)
        const clip = sequence.clips.find(v => v.start === start && v.track === original.track && v.itemId === original.itemId)!
        // The new source is conformed to the original spoken interval; nested outer clips need no ripple.
        const sourceInUs = Math.round((from - step.startUs) / (step.endUs - step.startUs) * media.durationSeconds * 1e6)
        const sourceOutUs = Math.round((to - step.startUs) / (step.endUs - step.startUs) * media.durationSeconds * 1e6)
        const item = draft.items.find(v => v.mediaId === media.id)
        if (!item) throw new Error('重录素材未完整导入。')
        const replacement = { ...clip, itemId: item.id, sourceInUs, speed: videoEditSpeedRatio((sourceOutUs - sourceInUs) * fps / (1e6 * clip.duration)), sourceRemainder: { numerator: 0, denominator: 1 },
          // Old cursor events and zoom regions use a different source timebase; never apply them to the new capture.
          effects: clip.effects?.filter(effect => effect.builtin?.id !== 'recording_cursor' && effect.builtin?.id !== 'recording_zoom') }
        sequence.clips = sequence.clips.map(v => v === clip ? replacement : v)
        stepReplaced++
      }
      draft.sequences[si] = sequence
    }
    if (!stepReplaced) throw new Error(`时间线中没有“${step.title}”对应的原片段，请先将该会话生成成片或导入剪辑。`)
    replaced += stepReplaced
  }
  return replaced
}
