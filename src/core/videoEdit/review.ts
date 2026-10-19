import { videoEditDuration, videoEditVisibleTracks, type VideoEditComposition } from './document'
import { projectVideoEditSequenceMapRange, projectVideoEditSourceMapAuthorTimes, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange, type VideoEditSourceMapStep } from './sourceMap'
import { videoEditTransitionMedium, videoEditTransitionWindow } from './transitions'
import { videoEditTrackFrameTime, type VideoEditTrackHeader } from './tracking'
import { videoEditNestedCaptionSourceId } from './nestedCaptions'
import { activeVideoEditEffects } from './compositing'

export type VideoEditReviewKind = 'caption' | 'clip_boundary' | 'effect' | 'transition' | 'tracking_lost' | 'tracking_low_confidence' | 'tracking_uncovered' | 'tracking_unavailable'
export interface VideoEditReviewRecord {
  kind: VideoEditReviewKind
  timeline: VideoEditSourceMapRange
  sequenceId: string
  path: readonly VideoEditSourceMapStep[]
  subjectId: string
  subjectType?: 'video_edit.clip' | 'video_edit.effect'
  confidence?: number
  source?: { fromUs: number; toUs: number }
}
export interface VideoEditReviewStructure { records: VideoEditReviewRecord[]; tracking: Array<{ composition: VideoEditComposition; entry: VideoEditSourceMapEntry }> }
export const VIDEO_EDIT_REVIEW_RECORD_BUDGET = 20000
export const VIDEO_EDIT_REVIEW_TRACK_SAMPLE_BUDGET = 200000
export function assertVideoEditReviewBudget(count: number): void {
  if (count > VIDEO_EDIT_REVIEW_RECORD_BUDGET) throw new Error('检查候选超过单次20000项预算，请缩小 from/to；未截断结果。')
}

/** Structural reasons to look, never a verdict about the image or the author's intention. */
export function collectVideoEditReviewStructure(composition: VideoEditComposition, range: VideoEditSourceMapRange): VideoEditReviewStructure {
  const records: VideoEditReviewRecord[] = []; const tracking: VideoEditReviewStructure['tracking'] = []
  let work = 0
  const append = (record: VideoEditReviewRecord): void => { assertVideoEditReviewBudget(++work); records.push(record) }
  visitVideoEditPictureInstances(composition, range, {
    sequence(instance) {
      const local = instance.composition
      for (const caption of local.captions ?? []) {
        assertVideoEditReviewBudget(++work)
        const timeline = projectVideoEditSequenceMapRange(instance, { from: caption.start, to: caption.start + caption.duration })
        if (timeline) append({ kind: 'caption', timeline, sequenceId: local.id, path: instance.path, subjectId: videoEditNestedCaptionSourceId(caption) })
      }
      const visible = videoEditVisibleTracks(local)
      for (const transition of local.transitions ?? []) {
        assertVideoEditReviewBudget(++work)
        if (videoEditTransitionMedium(transition.kind) !== 'video') continue
        const window = videoEditTransitionWindow(local, transition)
        if (!visible.has(window.left.track) && !visible.has(window.right.track)) continue
        const timeline = projectVideoEditSequenceMapRange(instance, { from: window.start, to: window.end })
        if (timeline) append({ kind: 'transition', timeline, sequenceId: local.id, path: instance.path, subjectId: transition.id })
      }
    },
    clip(local, entry, window) {
      const step = entry.path.at(-1)!
      const instance = { composition: local, path: entry.path.slice(0, -1), timeline: window }
      const event = (frame: number, kind: VideoEditReviewKind, subjectId: string, subjectType: VideoEditReviewRecord['subjectType'] = 'video_edit.clip'): void => {
        assertVideoEditReviewBudget(++work)
        const timeline = projectVideoEditSequenceMapRange(instance, { from: frame, to: frame })
        if (timeline) append({ kind, timeline, sequenceId: local.id, path: entry.path, subjectId, subjectType })
      }
      for (const frame of [step.clip.start, step.clip.start + step.clip.duration]) event(frame, 'clip_boundary', step.clipId)
      if (!step.clip.disabledIntrinsicSections?.includes('opacity')) for (const point of step.clip.curves?.opacity ?? []) event(step.clip.start + point.time, 'effect', step.clipId)
      // Animated adjustment opacity can reveal a currently transparent layer later in this query.
      for (const effect of activeVideoEditEffects(step.clip.curves?.opacity?.length ? { ...step.clip, opacity: 1 } : step.clip)) {
        assertVideoEditReviewBudget(++work)
        for (const frame of [step.clip.start, step.clip.start + step.clip.duration]) event(frame, 'effect', effect.id, 'video_edit.effect')
        for (const points of Object.values(effect.builtin?.curves ?? {})) for (const point of points) event(step.clip.start + point.time, 'effect', effect.id, 'video_edit.effect')
        for (const points of Object.values(effect.code?.curves ?? {})) for (const point of points) {
          assertVideoEditReviewBudget(++work)
          const time = point.sourceInUs + point.sourceRemainder.numerator / point.sourceRemainder.denominator
          // Code author time is source microseconds, unlike builtin/opacity local-frame curves.
          for (const timeline of projectVideoEditSourceMapAuthorTimes(entry, [time])) append({ kind: 'effect', timeline, sequenceId: local.id, path: entry.path, subjectId: effect.id, subjectType: 'video_edit.effect' })
        }
      }
      if (step.clip.trackers?.length) tracking.push({ composition: local, entry })
    },
  })
  return { records, tracking }
}

export interface VideoEditTrackingReviewRange { kind: 'tracking_lost' | 'tracking_low_confidence' | 'tracking_uncovered'; fromUs: number; toUs: number; confidence?: number }

/** Raw tracking evidence; rendering may interpolate or hold a nearby good box over these spans. */
export function videoEditTrackingReviewRanges(header: VideoEditTrackHeader, range: { fromUs: number; toUs: number }, threshold: number, budget: { remaining: number }): VideoEditTrackingReviewRange[] {
  if (!(header.fps > 0) || !Number.isFinite(header.fps) || !Number.isSafeInteger(header.firstFrame) || header.firstFrame < 0 || !header.frameCount || header.boxes.length !== header.frameCount) throw new Error('跟踪结果帧网格无效，请重新跟踪。')
  const startUs = videoEditTrackFrameTime(header.firstFrame, header.fps); const endUs = videoEditTrackFrameTime(header.firstFrame + header.frameCount, header.fps)
  const result: VideoEditTrackingReviewRange[] = []
  const append = (kind: VideoEditTrackingReviewRange['kind'], fromUs: number, toUs: number, confidence?: number): void => {
    const from = Math.max(range.fromUs, fromUs); const to = Math.min(range.toUs, toUs)
    if (to <= from) return
    const last = result.at(-1)
    if (last?.kind === kind && Math.abs(last.toUs - from) < .01) { last.toUs = to; if (confidence !== undefined) last.confidence = Math.min(last.confidence ?? 1, confidence) }
    else { assertVideoEditReviewBudget(result.length + 1); result.push({ kind, fromUs: from, toUs: to, ...(confidence === undefined ? {} : { confidence }) }) }
  }
  append('tracking_uncovered', 0, startUs)
  const first = Math.max(0, Math.floor(range.fromUs * header.fps / 1e6 - header.firstFrame))
  const end = Math.min(header.frameCount, Math.ceil(range.toUs * header.fps / 1e6 - header.firstFrame))
  if (Math.max(0, end - first) > budget.remaining) throw new Error('跟踪检查超过单次200000采样预算，请缩小 from/to；未截断结果。')
  budget.remaining -= Math.max(0, end - first)
  for (let index = first; index < end; index++) {
    const box = header.boxes[index]; const confidence = box?.[4]
    if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new Error('跟踪结果置信度无效，请重新跟踪。')
    const fromUs = videoEditTrackFrameTime(header.firstFrame + index, header.fps); const toUs = videoEditTrackFrameTime(header.firstFrame + index + 1, header.fps)
    if (!box || confidence === 0) append('tracking_lost', fromUs, toUs)
    else if (confidence! < threshold) append('tracking_low_confidence', fromUs, toUs, confidence)
  }
  append('tracking_uncovered', endUs, range.toUs)
  return result
}

/** Prioritize tracking evidence, distributing a small frame budget across the requested time range. */
export function selectVideoEditReviewFrames(records: readonly VideoEditReviewRecord[], range: VideoEditSourceMapRange, maxFrames: number, duration: number): number[] {
  const priority = (kind: VideoEditReviewKind): number => kind.startsWith('tracking_') ? 3 : kind === 'transition' ? 2 : 1
  const candidates = new Map<number, number>()
  for (const record of records) for (const frame of [record.timeline.from - 1, record.timeline.from, record.timeline.to - 1, record.timeline.to]) {
    if (frame >= range.from && frame < Math.min(range.to, duration)) candidates.set(frame, Math.max(candidates.get(frame) ?? 0, priority(record.kind)))
  }
  const pending = [...candidates].sort((a, b) => a[0] - b[0]); const chosen: number[] = []
  while (pending.length && chosen.length < maxFrames) {
    let best = 0; let bestScore = -Infinity
    for (let index = 0; index < pending.length; index++) {
      const [frame, severity] = pending[index]
      const distance = chosen.length ? Math.min(...chosen.map(value => Math.abs(value - frame))) / Math.max(1, range.to - range.from) : .5
      const score = severity + distance
      if (score > bestScore) { best = index; bestScore = score }
    }
    chosen.push(pending.splice(best, 1)[0][0])
  }
  return chosen.sort((a, b) => a - b)
}

export function videoEditReviewRange(composition: VideoEditComposition, from: number, to: number): VideoEditSourceMapRange {
  const end = Math.min(to, videoEditDuration(composition))
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || end <= from) throw new Error('检查范围须为序列时长内的半开整数帧 from/to。')
  return { from, to: end }
}
