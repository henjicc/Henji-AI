import { z } from 'zod'
import type { VideoEditClip, VideoEditSequence } from './document'
import type { VideoEditContentOrigin } from './timedContent'
import { stretchVideoEditClip, videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange, videoEditClipSourceSecondsAtTime, videoEditClipSpeedSupported } from './clipSpeed'
import { rescaleVideoEditClipKeyframes } from './keyframes'
import { videoEditFps, VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from './time'

const offset = z.number().finite().min(-VIDEO_EDIT_MAX_SEQUENCE_SECONDS).max(VIDEO_EDIT_MAX_SEQUENCE_SECONDS)
const range = z.object({ clipId: z.string().min(1).max(100), itemId: z.string().min(1).max(100), fromUs: z.number().int().nonnegative(), toUs: z.number().int().positive() }).strict().refine(value => value.toUs > value.fromUs)
export const videoEditContentAnchorSchema = z.object({ ranges: z.array(range).min(1), startOffsetSeconds: offset.default(0), endOffsetSeconds: offset.default(0) }).strict()
export type VideoEditContentAnchor = z.infer<typeof videoEditContentAnchorSchema>
export const videoEditContentAnchorInputSchema = z.union([
  z.object({ matchId: z.string().min(1).max(100), startOffsetSeconds: offset.default(0), endOffsetSeconds: offset.default(0) }).strict(),
  videoEditContentAnchorSchema,
]).nullable()
export type VideoEditContentAnchorInput = z.infer<typeof videoEditContentAnchorInputSchema>

export function videoEditContentAnchorAtRanges(sequence: VideoEditSequence, ranges: readonly { clipId: string; from: number; to: number }[], offsets: { startOffsetSeconds?: number; endOffsetSeconds?: number } = {}): VideoEditContentAnchor {
  const fps = videoEditFps(sequence.frameRate); const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  return videoEditContentAnchorSchema.parse({ ranges: ranges.map(range => {
    const target = clips.get(range.clipId)
    if (!target) throw new Error('关联来源不属于此序列。')
    const a = videoEditClipSourceSecondsAtTime(target, range.from / fps, fps) * 1e6; const b = videoEditClipSourceSecondsAtTime(target, range.to / fps, fps) * 1e6
    return { clipId: target.id, itemId: target.itemId, fromUs: Math.max(0, Math.round(Math.min(a, b))), toUs: Math.round(Math.max(a, b)) }
  }), startOffsetSeconds: offsets.startOffsetSeconds ?? 0, endOffsetSeconds: offsets.endOffsetSeconds ?? 0 })
}

export function expandVideoEditContentSelection(sequence: VideoEditSequence, selected: readonly string[], includeLinks = false): string[] {
  const ids = new Set(selected)
  let changed = true
  while (changed) {
    changed = false
    const links = new Set(includeLinks ? sequence.clips.filter(clip => ids.has(clip.id) && clip.linkId).map(clip => clip.linkId) : [])
    for (const clip of sequence.clips) if (!ids.has(clip.id) && (clip.contentAnchor?.ranges.some(range => ids.has(range.clipId)) || clip.linkId && links.has(clip.linkId))) { ids.add(clip.id); changed = true }
  }
  return [...ids]
}

export function assertVideoEditContentAnchors(sequence: VideoEditSequence): void {
  const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  const pending = new Map(sequence.clips.map(clip => [clip.id, new Set(clip.contentAnchor?.ranges.map(range => range.clipId) ?? [])]))
  const users = new Map<string, string[]>()
  for (const clip of sequence.clips) for (const range of clip.contentAnchor?.ranges ?? []) {
    if (!clips.has(range.clipId) || clips.get(range.clipId)!.itemId !== range.itemId) throw new Error('内容关联须引用同序列的现有来源片段及素材。')
    const values = users.get(range.clipId) ?? []; values.push(clip.id); users.set(range.clipId, values)
  }
  const queue = [...pending].filter(([, dependencies]) => !dependencies.size).map(([id]) => id)
  for (let index = 0; index < queue.length; index++) for (const id of users.get(queue[index]) ?? []) {
    const dependencies = pending.get(id)!
    if (dependencies.delete(queue[index]) && !dependencies.size) queue.push(id)
  }
  if (queue.length !== sequence.clips.length) throw new Error('内容关联存在循环，请选择其他来源片段。')
}

export function remapVideoEditContentAnchor(anchor: VideoEditContentAnchor | undefined, ids: ReadonlyMap<string, string>): VideoEditContentAnchor | undefined {
  return anchor && { ...anchor, ranges: anchor.ranges.map(value => ({ ...value, clipId: ids.get(value.clipId) ?? value.clipId })) }
}

/** The source interval and the visible position share the same continuous source clock. */
function position(clip: VideoEditClip, fromUs: number, toUs: number, fps: number): { from: number; to: number } {
  const a = videoEditClipFrameBoundaryAtSource(clip, fromUs / 1e6, fps); const b = videoEditClipFrameBoundaryAtSource(clip, toUs / 1e6, fps)
  return { from: Math.max(clip.start, Math.round(Math.min(a, b))), to: Math.min(clip.start + clip.duration, Math.round(Math.max(a, b))) }
}

/** Manual splitting assigns each piece its own content range, including lead/trailing padding. */
export function sliceVideoEditContentAnchor(anchor: VideoEditContentAnchor, sequence: VideoEditSequence, from: number, to: number): VideoEditContentAnchor {
  const fps = videoEditFps(sequence.frameRate); const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  const ranges = anchor.ranges.flatMap(value => {
    const clip = clips.get(value.clipId)
    if (!clip) return []
    const span = position(clip, value.fromUs, value.toUs, fps)
    const start = Math.max(from, span.from); const end = Math.min(to, span.to)
    if (end <= start) return []
    const a = videoEditClipSourceSecondsAtTime(clip, start / fps, fps) * 1e6; const b = videoEditClipSourceSecondsAtTime(clip, end / fps, fps) * 1e6
    return [{ ...value, fromUs: Math.max(value.fromUs, Math.round(Math.min(a, b))), toUs: Math.min(value.toUs, Math.round(Math.max(a, b))) }]
  }).filter(value => value.toUs > value.fromUs)
  // A padding-only fragment follows the nearest surviving edge instead of losing its relation.
  if (!ranges.length) {
    const first = anchor.ranges[0]; const last = anchor.ranges.at(-1)!
    const edge = clips.get(first.clipId); const before = edge && to <= position(edge, first.fromUs, first.toUs, fps).from
    const value = before ? first : last
    ranges.push({ ...value, ...(before ? { toUs: value.fromUs + 1 } : { fromUs: value.toUs - 1 }) })
  }
  const spans = ranges.map(value => position(clips.get(value.clipId)!, value.fromUs, value.toUs, fps))
  return { ranges, startOffsetSeconds: (from - Math.min(...spans.map(value => value.from))) / fps, endOffsetSeconds: (to - Math.max(...spans.map(value => value.to))) / fps }
}

function resize(clip: VideoEditClip, start: number, duration: number): VideoEditClip {
  if (duration === clip.duration) return { ...clip, start }
  const timed = videoEditClipSpeedSupported(clip.kind) ? stretchVideoEditClip(clip, duration) : { ...clip, duration }
  const result = rescaleVideoEditClipKeyframes(timed, time => Math.round(time * duration / clip.duration), duration)
  return { ...result, start,
    ...(clip.fadeInFrames ? { fadeInFrames: Math.max(1, Math.min(duration, Math.round(clip.fadeInFrames * duration / clip.duration))) } : {}),
    ...(clip.fadeOutFrames ? { fadeOutFrames: Math.max(1, Math.min(duration, Math.round(clip.fadeOutFrames * duration / clip.duration))) } : {}),
  }
}

/** One reconciliation serves timeline edits, property transactions and generated placements. */
export function retimeVideoEditContentClips(before: VideoEditSequence, after: VideoEditSequence, origins: ReadonlyMap<string, VideoEditContentOrigin>): VideoEditClip[] {
  if (!after.clips.some(clip => clip.contentAnchor)) return after.clips
  const fps = videoEditFps(after.frameRate)
  const old = new Map(before.clips.map(clip => [clip.id, clip])); const current = new Map(after.clips.map(clip => [clip.id, clip]))
  const descendants = new Map<string, VideoEditClip[]>()
  for (const clip of after.clips) { const id = origins.get(clip.id)?.originalId ?? clip.id; const values = descendants.get(id) ?? []; values.push(clip); descendants.set(id, values) }
  const visited = new Set<string>(); const memo = new Map<string, VideoEditClip[]>()
  const relations = new Map<string, string>()
  const resolve = (clip: VideoEditClip): VideoEditClip[] => {
    const known = memo.get(clip.id)
    if (known) return known
    if (visited.has(clip.id)) throw new Error('内容关联存在循环，请选择其他来源片段。')
    visited.add(clip.id)
    let result = [clip]
    if (clip.contentAnchor) {
      const anchor = clip.contentAnchor
      let replaced = false
      const spans: { range: VideoEditContentAnchor['ranges'][number]; from: number; to: number }[] = []
      for (const range of anchor.ranges) {
        const targets = descendants.get(range.clipId) ?? (current.has(range.clipId) ? [current.get(range.clipId)!] : [])
        for (const candidate of targets) for (const target of resolve(candidate)) {
          if (target.itemId !== range.itemId) { replaced = true; continue }
          const visible = videoEditClipSourceRange(target, fps)
          const fromUs = Math.max(range.fromUs, Math.round(visible.from * 1e6)); const toUs = Math.min(range.toUs, Math.round(visible.to * 1e6))
          if (toUs <= fromUs) continue
          const span = position(target, fromUs, toUs, fps)
          if (span.to >= span.from) spans.push({ ...span, range: { ...range, clipId: target.id, fromUs, toUs } })
        }
      }
      if (replaced) result = [{ ...clip, contentAnchor: undefined }]
      else {
        const groups: typeof spans[] = []
        for (const span of spans.sort((left, right) => left.from - right.from)) {
          const previous = groups.at(-1)
          if (previous && span.from <= Math.max(...previous.map(value => value.to)) + 1) previous.push(span)
          else groups.push([span])
        }
        const previous = old.get(origins.get(clip.id)?.originalId ?? clip.id)
        const manuallyAdjusted = previous && JSON.stringify(previous.contentAnchor) === JSON.stringify(anchor)
          && (previous.start !== clip.start || previous.duration !== clip.duration)
          && anchor.ranges.every(value => { const a = old.get(value.clipId); const b = current.get(value.clipId); return a && b && a.start === b.start && a.duration === b.duration && a.sourceInUs === b.sourceInUs && JSON.stringify(a.speed) === JSON.stringify(b.speed) && a.reverse === b.reverse })
        result = groups.flatMap((group, index) => {
          const from = Math.min(...group.map(value => value.from)); const to = Math.max(...group.map(value => value.to))
          const startOffsetSeconds = manuallyAdjusted ? (clip.start - from) / fps : anchor.startOffsetSeconds
          const endOffsetSeconds = manuallyAdjusted ? (clip.start + clip.duration - to) / fps : anchor.endOffsetSeconds
          const start = Math.max(0, Math.round(from + startOffsetSeconds * fps)); const end = Math.min(Math.floor(fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS), Math.round(to + endOffsetSeconds * fps))
          if (end <= start) return []
          const value = resize(clip, start, end - start)
          if (index) {
            value.id = crypto.randomUUID()
            if (value.effects) value.effects = value.effects.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() }))
            for (const key of ['linkId', 'groupId'] as const) if (value[key]) { const id = `${key}:${value[key]}:${from}:${to}`; if (!relations.has(id)) relations.set(id, crypto.randomUUID()); value[key] = relations.get(id) }
          }
          return [{ ...value, contentAnchor: { ranges: group.map(value => value.range), startOffsetSeconds, endOffsetSeconds } }]
        })
      }
    }
    visited.delete(clip.id); memo.set(clip.id, result)
    return result
  }
  const result = after.clips.flatMap(resolve)
  for (const clip of before.clips) if (clip.contentAnchor && before.tracks.find(track => track.index === clip.track)?.locked) {
    if (JSON.stringify(clip) !== JSON.stringify(result.find(value => value.id === clip.id))) throw new Error(`关联画面“${clip.name}”所在轨道已锁定，请先解锁。`)
  }
  return result
}
