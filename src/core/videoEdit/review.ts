import { videoEditDuration, videoEditVisibleTracks, type VideoEditComposition } from './document'
import { projectVideoEditSequenceMapRange, projectVideoEditSourceMapAuthorTimes, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange, type VideoEditSourceMapStep } from './sourceMap'
import { videoEditTransitionMedium, videoEditTransitionWindow } from './transitions'
import { videoEditTrackFrameTime, type VideoEditTrackHeader } from './tracking'
import { videoEditNestedCaptionSourceId } from './nestedCaptions'
import { activeVideoEditEffects } from './compositing'

export type VideoEditReviewKind = 'caption' | 'clip_boundary' | 'effect' | 'transition' | 'tracking_lost' | 'tracking_low_confidence' | 'tracking_uncovered' | 'tracking_unavailable' | 'motion' | 'motion_hard_stop' | 'motion_hold' | 'event_crowded' | 'code_change' | 'code_unavailable' | 'pixel_cut' | 'pixel_change' | 'pixel_still' | 'pixel_unknown'
export interface VideoEditReviewRecord {
  kind: VideoEditReviewKind
  timeline: VideoEditSourceMapRange
  sequenceId: string
  path: readonly VideoEditSourceMapStep[]
  subjectId: string
  subjectType?: 'video_edit.clip' | 'video_edit.effect'
  confidence?: number
  source?: { fromUs: number; toUs: number }
  motionEvidence?: { basis: 'clip_transform' | 'structural_events' | 'code_structure' | 'video_pixels' | 'code_input_pixels'; elementPath?: string[]; peakSpeed?: number; gapSeconds?: number; suggestion: string;
    input?: { parameter: string; kind: 'video' | 'sequence'; mediaRef: { kind: 'video_edit.media'; id: string } } }
}
export interface VideoEditReviewStructure { records: VideoEditReviewRecord[]; tracking: Array<{ composition: VideoEditComposition; entry: VideoEditSourceMapEntry }> }
/** Heuristic attention-event grouping; neither the count nor the gap is an aesthetic verdict. */
export function videoEditCrowdedReviewEvents(records: readonly VideoEditReviewRecord[], fps: number, minGapSeconds: number): Array<{ from: number; to: number; gapSeconds: number }> {
  const events: VideoEditReviewRecord[] = []
  const lastByElement = new Map<string, VideoEditReviewRecord>()
  const cuts = new Set<string>()
  const instanceKey = (record: VideoEditReviewRecord): string => JSON.stringify([record.sequenceId, record.path.map(step => step.clipId)])
  const cutKey = (record: VideoEditReviewRecord): string => JSON.stringify([record.path.slice(0, -1).map(step => step.clipId), record.sequenceId, record.timeline.from])
  const codeTimes = new Map<string, number[]>()
  for (const record of records) if (record.motionEvidence?.basis === 'code_structure' && ['motion', 'code_change'].includes(record.kind)) {
    const key = instanceKey(record), times = codeTimes.get(key) ?? []; times.push(record.timeline.from); codeTimes.set(key, times)
  }
  for (const times of codeTimes.values()) times.sort((a, b) => a - b)
  const representedCuts = new Set<string>()
  for (const record of records) if (record.kind === 'clip_boundary') {
    const times = codeTimes.get(instanceKey(record)) ?? []
    let low = 0, high = times.length
    while (low < high) { const middle = (low + high) >>> 1; if (times[middle] < record.timeline.from) low = middle + 1; else high = middle }
    if (low < times.length && times[low] - record.timeline.from <= .6 * fps) representedCuts.add(cutKey(record))
  }
  for (const record of [...records].sort((a, b) => a.timeline.from - b.timeline.from)) {
    // Prepared raw inputs are observation candidates, not additional visible events.
    if (record.motionEvidence?.basis === 'code_input_pixels') continue
    if (!['caption', 'clip_boundary', 'effect', 'transition', 'motion', 'motion_hard_stop', 'code_change', 'pixel_cut', 'pixel_change'].includes(record.kind)) continue
    const key = record.kind === 'caption' || record.kind === 'transition' ? JSON.stringify([record.kind, record.sequenceId, record.subjectId, record.path.map(step => step.clipId)])
      : JSON.stringify(['element', record.sequenceId, record.path.map(step => step.clipId), record.motionEvidence?.elementPath ?? []])
    if (record.kind === 'clip_boundary') {
      // The outgoing and incoming boundaries at a cut describe one event.
      const cut = cutKey(record)
      if (cuts.has(cut) || representedCuts.has(cut)) { lastByElement.set(key, record); continue }
      cuts.add(cut)
    }
    const previous = lastByElement.get(key)
    // A single entrance can drive position, scale and opacity together. Keep a
    // separate caption/transition and don't merge different placed instances.
    if (previous && (record.timeline.from - previous.timeline.from) / fps <= .6) continue
    lastByElement.set(key, record); events.push(record)
  }
  const result: Array<{ from: number; to: number; gapSeconds: number }> = []
  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1], current = events[i], gapSeconds = (current.timeline.from - previous.timeline.from) / fps
    if (gapSeconds < minGapSeconds) result.push({ from: previous.timeline.from, to: Math.max(previous.timeline.from + 1, current.timeline.from + 1), gapSeconds })
  }
  return result
}
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
  const priority = (kind: VideoEditReviewKind): number => kind.startsWith('tracking_') ? 3 : ['transition', 'motion_hard_stop', 'event_crowded'].includes(kind) ? 2 : 1
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
