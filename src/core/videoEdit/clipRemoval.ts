import type { VideoEditSequence } from './document'
import { retimeVideoEditContent } from './timedContent'

/**
 * 序列内删片段的唯一规则，素材项、片段集合与时间线删除共用（同 Premiere）：
 * 挂在片段上的标注一起删；范围标注只剩被删片段时删除，否则去掉这些片段的引用；
 * 被删片段是多机位机位时去掉该机位，剩不到两个机位时拒绝。
 */
export function removeVideoEditSequenceClips(sequence: VideoEditSequence, ids: readonly string[]): VideoEditSequence {
  const removed = new Set(ids)
  if (!sequence.clips.some(clip => removed.has(clip.id))) return sequence
  const annotations = sequence.annotations.flatMap(mark => {
    if (mark.clipId && removed.has(mark.clipId)) return []
    if (mark.target.kind !== 'range' || !mark.target.clipIds?.some(id => removed.has(id))) return [mark]
    const clipIds = mark.target.clipIds.filter(id => !removed.has(id))
    return clipIds.length ? [{ ...mark, target: { ...mark.target, clipIds } }] : []
  })
  const next = retimeVideoEditContent(sequence, { ...sequence, clips: sequence.clips.filter(clip => !removed.has(clip.id)), annotations })
  const lost = sequence.multicam?.cameras.filter(camera => removed.has(camera.clipId)) ?? []
  if (!sequence.multicam || !lost.length) return next
  const cameras = sequence.multicam.cameras.filter(camera => !removed.has(camera.clipId))
  if (cameras.length < 2) throw new Error(`多机位序列“${sequence.name}”至少需要两个机位，删除会去掉机位${lost.map(camera => `“${camera.name}”`).join('、')}。请先删除引用这条多机位序列的素材项，或保留这些机位片段。`)
  const audioCameraId = sequence.multicam.audioCameraId && cameras.some(camera => camera.id === sequence.multicam!.audioCameraId) ? sequence.multicam.audioCameraId : undefined
  return { ...next, multicam: { cameras, ...(audioCameraId ? { audioCameraId } : {}) } }
}
