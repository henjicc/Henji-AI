import { splitVideoEditClip, type VideoEditDocument, type VideoEditClip, type VideoEditMedia } from '../videoEdit/document'
import { stretchVideoEditClip } from '../videoEdit/clipSpeed'

export interface RecordingRedubTarget { sequenceId: string; clipId: string; start: number; end: number; pictureId: string; holdId?: string; fps: number }
/** Restrict automatic alignment to a readable, unlocked narration and its ordinary picture. */
export function recordingRedubTarget(document: VideoEditDocument, clipId: string): RecordingRedubTarget {
  const sequence = document.sequences.find(v => v.clips.some(c => c.id === clipId)), clip = sequence?.clips.find(v => v.id === clipId)
  if (!sequence || !clip || clip.kind !== 'audio' || !clip.creativeSource || clip.creativeSource.type !== 'document' || !clip.creativeSource.part?.startsWith('recording-narration:')) throw new Error('请选择录制成片中有文字稿的旁白句子。')
  if (sequence.tracks.some(v => v.locked) || sequence.transitions?.length || clip.reverse || clip.effects?.length || clip.curves) throw new Error('请先解除该序列锁轨、转场及旁白的倒放或效果，再自动补录。')
  const picture = sequence.clips.find(v => v.kind === 'sequence' && v.start <= clip.start && v.start + v.duration > clip.start)
  if (!picture || picture.reverse || picture.curves || picture.effects?.some(effect => effect.code || effect.builtin?.curves || effect.mask && (effect.mask.regionId !== 'shapes' || effect.mask.shapes?.some(shape => shape.pathAnimation)))) throw new Error('对应画面已重新编排，请恢复普通画面片段后再自动对齐。')
  const hold = sequence.clips.find(v => v.kind === 'image' && v.creativeSource?.type === 'document' && v.creativeSource.part === `recording-hold:${clip.id}` && v.start === picture.start + picture.duration)
  const pictureEnd = hold ? hold.start + hold.duration : picture.start + picture.duration
  if (pictureEnd < clip.start + clip.duration) throw new Error('旁白跨越了已重排的画面边界，请先整理对应画面。')
  const next = sequence.clips.filter(v => v.kind === 'audio' && v.track === clip.track && v.start > clip.start).sort((a, b) => a.start - b.start)[0]
  const end = Math.min(next?.start ?? Infinity, pictureEnd)
  return { sequenceId: sequence.id, clipId, start: clip.start, end, pictureId: picture.id, holdId: hold?.id, fps: sequence.frameRate.numerator / sequence.frameRate.denominator }
}
export function redubExtension(target: RecordingRedubTarget, durationUs: number): { duration: number; extra: number; hold: boolean } {
  const duration = Math.max(1, Math.floor(durationUs * target.fps / 1e6)), extra = Math.max(0, target.start + duration - target.end)
  return { duration, extra, hold: extra > 0 && (Boolean(target.holdId) || extra > (target.end - target.start) * .1) }
}
/** 新旁白、字幕与后续画面一起返回，保留调用方及撤销历史持有的原文档。 */
export function replaceRecordingNarration(draft: VideoEditDocument, target: RecordingRedubTarget, media: VideoEditMedia, text: string, still?: VideoEditMedia): { document: VideoEditDocument; clip: VideoEditClip } {
  const extension = redubExtension(target, Math.round(media.durationSeconds * 1e6))
  let sequence = { ...draft.sequences.find(v => v.id === target.sequenceId)! }
  const old = sequence.clips.find(v => v.id === target.clipId)!, item = draft.items.find(v => v.mediaId === media.id)
  if (!item || media.kind !== 'audio') throw new Error('新旁白素材尚未导入。')
  const picture = sequence.clips.find(v => v.id === target.pictureId)!
  if (extension.extra) {
    for (const clip of sequence.clips) {
      if (clip.id === old.id || clip.id === picture.id || clip.start >= target.end || clip.start + clip.duration <= target.end) continue
      if (!['graphic', 'image', 'text'].includes(clip.kind) || clip.curves) throw new Error('步骤边界有其他声音或动画交叠，请先拆开这些片段。')
    }
    if (target.end < picture.start + picture.duration) sequence = splitVideoEditClip(sequence, picture.id, target.end)
    if (target.start > picture.start && !extension.hold) sequence = splitVideoEditClip(sequence, picture.id, target.start)
    sequence.clips = sequence.clips.map(clip => {
      if (clip.id === old.id) return clip
      if (clip.start >= target.end) return { ...clip, start: clip.start + extension.extra }
      if (clip.itemId === picture.itemId && clip.start + clip.duration === target.end) {
        if (extension.hold) return clip
        return stretchVideoEditClip(clip, clip.duration + extension.extra)
      }
      if (clip.start < target.end && clip.start + clip.duration >= target.end) return { ...clip, duration: clip.duration + extension.extra }
      return clip
    })
    if (extension.hold && !target.holdId) {
      const stillItem = still && draft.items.find(v => v.mediaId === still.id)
      if (!stillItem || still?.kind !== 'image') throw new Error('配音变长，需要先生成步骤末尾的停留画面。')
      sequence.clips.push({ ...picture, effects: picture.effects?.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() })), id: crypto.randomUUID(), itemId: stillItem.id, name: '旁白停留画面', kind: 'image', start: target.end, duration: extension.extra, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, speed: undefined, sourceComponent: undefined, creativeSource: old.creativeSource?.type === 'document' ? { ...old.creativeSource, part: `recording-hold:${old.id}` } : undefined, linkId: undefined })
    }
    sequence.captions = sequence.captions?.map(caption => caption.clipId === old.id ? caption : caption.start >= target.end ? { ...caption, start: caption.start + extension.extra } : caption)
    sequence.markers = sequence.markers?.map(marker => marker.frame >= target.end ? { ...marker, frame: marker.frame + extension.extra } : marker)
    if (sequence.annotations.length) throw new Error('此序列有时间标注，请先处理标注后再延长步骤。')
  }
  const clip = { ...old, itemId: item.id, text, duration: extension.duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, speed: undefined,
    fadeInFrames: Math.max(1, Math.min(Math.round(target.fps * .03), Math.floor(extension.duration / 2))), fadeOutFrames: Math.max(1, Math.min(Math.round(target.fps * .03), Math.floor(extension.duration / 2))) }
  sequence.clips = sequence.clips.map(v => v.id === old.id ? clip : v)
  sequence.captions = sequence.captions?.map(caption => caption.clipId === old.id ? { ...caption, text, sourceText: text, duration: extension.duration, translation: undefined } : caption)
  return { document: { ...draft, sequences: draft.sequences.map(v => v.id === sequence.id ? sequence : v) }, clip }
}
