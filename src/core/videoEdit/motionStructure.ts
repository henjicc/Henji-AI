import { reviewMotionSamples, type MotionReviewPolicy, type MotionReviewSample } from '../media/motionReview'
import { videoEditClipPictureSize, videoEditClipToFrame } from './clipGeometry'
import { evaluateVideoEditClip } from './keyframes'
import { videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapRange, type VideoEditSourceMapEntry } from './sourceMap'
import type { VideoEditComposition } from './document'

export const VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET = 60000
export type VideoEditMotionStructureKind = 'motion' | 'motion_hard_stop' | 'motion_hold'
export interface VideoEditMotionStructureFact {
  kind: VideoEditMotionStructureKind
  timeline: VideoEditSourceMapRange
  sequenceId: string
  path: VideoEditSourceMapEntry['path']
  subjectId: string
  peakSpeed?: number
}
export interface VideoEditMotionStructureResult { records: VideoEditMotionStructureFact[]; sampledFrames: number; sampledInstances: number }

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
    const report = reviewMotionSamples(samples, policy)
    const map = (fromSeconds: number, toSeconds: number): VideoEditSourceMapRange => ({
      from: Math.max(entry.timeline.from, Math.round(fromSeconds * root.fps)), to: Math.min(entry.timeline.to, Math.round(toSeconds * root.fps)),
    })
    const base = { sequenceId: local.id, path: entry.path, subjectId: step.clipId }
    const covered = new Set<number>()
    for (const event of report.events) if (event.kind === 'move') {
      const timeline = map(event.fromSeconds, event.toSeconds)
      for (let frame = timeline.from; frame < timeline.to; frame++) covered.add(frame)
      records.push({ ...base, kind: 'motion', timeline, peakSpeed: event.peak })
      if (event.hardStop) {
        const end = Math.round(event.toSeconds * root.fps)
        records.push({ ...base, kind: 'motion_hard_stop', timeline: { from: Math.max(entry.timeline.from, end - 1), to: Math.min(entry.timeline.to, end + 1) }, peakSpeed: event.peak })
      }
    }
    // The camera-move duration/median filters intentionally reject isolated pixel
    // estimates. Native geometry is exact: keep short jumps as candidates instead
    // of dropping a one-frame hold-keyframe discontinuity. Do not call it a hard stop.
    let short: VideoEditMotionStructureFact | undefined
    for (let i = 1; i < samples.length; i++) {
      const speed = samples[i].speed!, frame = entry.timeline.from + i
      if (speed < 2.5 || covered.has(frame)) { short = undefined; continue }
      if (short && short.timeline.to === frame) { short.timeline.to = frame + 1; short.peakSpeed = Math.max(short.peakSpeed!, speed) }
      else {
        short = { ...base, kind: 'motion', timeline: { from: frame - 1, to: frame + 1 }, peakSpeed: speed }
        records.push(short)
      }
    }
    for (const hold of report.stillness) records.push({ ...base, kind: 'motion_hold', timeline: map(hold.fromSeconds, hold.toSeconds) })
  }
  return { records, sampledFrames, sampledInstances: jobs.length }
}
