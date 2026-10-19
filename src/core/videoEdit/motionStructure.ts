import { reviewMotionSamples, type MotionReviewPolicy, type MotionReviewSample } from '../media/motionReview'
import { videoEditClipPictureSize, videoEditClipToFrame } from './clipGeometry'
import { evaluateVideoEditClip } from './keyframes'
import { videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapRange, type VideoEditSourceMapEntry } from './sourceMap'
import type { VideoEditComposition } from './document'

export const VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET = 60000
export type VideoEditMotionStructureKind = 'motion' | 'motion_hard_stop' | 'motion_hold' | 'code_change' | 'code_unavailable' | 'pixel_cut' | 'pixel_change' | 'pixel_still' | 'pixel_unknown'
export interface VideoEditMotionStructureFact {
  kind: VideoEditMotionStructureKind
  timeline: VideoEditSourceMapRange
  sequenceId: string
  path: VideoEditSourceMapEntry['path']
  subjectId: string
  peakSpeed?: number
  elementPath?: string[]
  basis?: 'clip_transform' | 'code_structure' | 'video_pixels' | 'code_input_pixels'
  input?: { parameter: string; kind: 'video' | 'sequence'; mediaId: string }
  detail?: string
  source?: { fromUs: number; toUs: number }
}
export interface VideoEditMotionStructureResult { records: VideoEditMotionStructureFact[]; sampledFrames: number; sampledInstances: number }

/** Shared event-to-frame conversion; exact structural jumps survive camera filters. */
export function videoEditMotionSampleFacts(samples: readonly MotionReviewSample[], base: Pick<VideoEditMotionStructureFact, 'sequenceId' | 'path' | 'subjectId' | 'basis' | 'elementPath'>, timeline: VideoEditSourceMapRange, fps: number, policy: MotionReviewPolicy = {}, includeHolds = true): VideoEditMotionStructureFact[] {
  const report = reviewMotionSamples(samples, policy), records: VideoEditMotionStructureFact[] = [], covered = new Set<number>()
  const map = (fromSeconds: number, toSeconds: number): VideoEditSourceMapRange => ({ from: Math.max(timeline.from, Math.round(fromSeconds * fps)), to: Math.min(timeline.to, Math.round(toSeconds * fps)) })
  for (const event of report.events) {
    if (event.kind === 'change') { records.push({ ...base, kind: 'code_change', timeline: map(event.fromSeconds, event.toSeconds) }); continue }
    if (event.kind !== 'move') continue
    const range = map(event.fromSeconds, event.toSeconds)
    for (let frame = range.from; frame < range.to; frame++) covered.add(frame)
    records.push({ ...base, kind: 'motion', timeline: range, peakSpeed: event.peak })
    if (event.hardStop) {
      const end = Math.round(event.toSeconds * fps)
      records.push({ ...base, kind: 'motion_hard_stop', timeline: { from: Math.max(timeline.from, end - 1), to: Math.min(timeline.to, end + 1) }, peakSpeed: event.peak })
    }
  }
  let short: VideoEditMotionStructureFact | undefined
  for (const sample of samples) {
    const speed = sample.speed, frame = Math.round(sample.fromSeconds * fps)
    if (speed === null || speed < 2.5 || covered.has(frame)) { short = undefined; continue }
    if (short && short.timeline.to === frame) { short.timeline.to = frame + 1; short.peakSpeed = Math.max(short.peakSpeed!, speed) }
    else {
      short = { ...base, kind: 'motion', timeline: { from: Math.max(timeline.from, frame - 1), to: Math.min(timeline.to, frame + 1) }, peakSpeed: speed }
      records.push(short)
    }
  }
  if (includeHolds) for (const hold of report.stillness) records.push({ ...base, kind: 'motion_hold', timeline: map(hold.fromSeconds, hold.toSeconds) })
  return records
}

/** Native placement evidence only. A held transform says nothing about pixels,
 * tracking, code animation, fades or source-video movement; do not call it a still image. */
export function collectVideoEditMotionStructure(root: VideoEditComposition, range: VideoEditSourceMapRange, policy: MotionReviewPolicy = {}): VideoEditMotionStructureResult {
  const jobs: Array<{ local: VideoEditComposition; entry: VideoEditSourceMapEntry }> = []
  let sampledFrames = 0
  visitVideoEditPictureInstances(root, range, { sequence() {}, clip(local, entry) {
    const clip = entry.path.at(-1)!.clip
    if (clip.kind === 'adjustment' || clip.disabledIntrinsicSections?.includes('motion')) return
    // A constant placement does not need per-frame evaluation. Dynamic curve values
    // include anchors, rotation and local units, all through the production evaluator.
    const keys = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY'] as const
    if (!keys.some(key => clip.curves?.[key]?.length)) return
    sampledFrames += entry.timeline.to - entry.timeline.from
    if (sampledFrames > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('运动结构分析超过单次60000帧实例预算，请缩小 from/to；未截断证据。')
    jobs.push({ local, entry })
  } })
  const records: VideoEditMotionStructureFact[] = []
  for (const { local, entry } of jobs) {
    const step = entry.path.at(-1)!, picture = videoEditClipPictureSize(local, step.clip)
    const samples: MotionReviewSample[] = []
    const corners = (frame: number) => {
      const clip = evaluateVideoEditClip(step.clip, videoEditSourceMapLocalFrame(entry, frame))
      return { scale: clip.scale, points: [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => videoEditClipToFrame(clip, picture, local, u, v)) }
    }
    let previous: ReturnType<typeof corners> | undefined, previousScale = 1
    for (let frame = entry.timeline.from; frame < entry.timeline.to; frame++) {
      const current = corners(frame)
      const speed = previous ? Math.max(...current.points.map((point, i) => Math.hypot(point.x - previous!.points[i].x, (point.y - previous!.points[i].y) * local.height / local.width))) * root.fps * 100 : null
      samples.push({ fromSeconds: frame / root.fps, toSeconds: (frame + 1) / root.fps,
        speed, zoom: previous ? Math.log(current.scale / previousScale) * root.fps * 100 : null,
        change: 0, cut: false, still: speed === null ? null : speed < 1e-8 })
      previous = current; previousScale = current.scale
    }
    const base = { sequenceId: local.id, path: entry.path, subjectId: step.clipId }
    records.push(...videoEditMotionSampleFacts(samples, base, entry.timeline, root.fps, policy))
  }
  return { records, sampledFrames, sampledInstances: jobs.length }
}
