import { reviewMotionSamples, type MotionReviewPolicy, type MotionReviewSample } from '../media/motionReview'
import { validateVideoMotionScan, type VideoMotionScan } from '../media/motionEvidence'
import { videoEditSourceMapSampleSeconds, type VideoEditSourceMapEntry } from './sourceMap'
import { VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET, type VideoEditMotionStructureFact } from './motionStructure'

export interface VideoEditPixelMotionPlacement {
  entry: VideoEditSourceMapEntry
  /** Exact sampled source seconds for a code input; array index is rootFrame-from. */
  sourceTimes?: number[]
  input?: { parameter: string; kind: 'video' | 'sequence'; mediaId: string }
}
export interface VideoEditPixelMotionInput extends VideoEditPixelMotionPlacement { scan: VideoMotionScan }
function sampleSeconds(entry: VideoEditSourceMapEntry, frame: number, times?: readonly number[]): number { return times ? times[frame - entry.timeline.from] : videoEditSourceMapSampleSeconds(entry, frame) }

/** Integrate sampled source velocity over the exact placed playback clock. Reversal
 * changes zoom direction; nested repeated/held frames do not inherit source speed. */
export function videoEditPixelMotionSamples(entry: VideoEditSourceMapEntry, scan: VideoMotionScan, fps: number, budget = { remaining: 200000 }, sourceTimes?: readonly number[]): MotionReviewSample[] {
  const samples: MotionReviewSample[] = []
  if (entry.timeline.to - entry.timeline.from > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('视频运动映射超过60000帧实例预算，请缩小 from/to。')
  if (sourceTimes && (sourceTimes.length !== entry.timeline.to - entry.timeline.from || sourceTimes.some(time => !Number.isFinite(time) || time < 0 || entry.mediaDuration !== undefined && time >= entry.mediaDuration))) throw new Error('代码画面输入采样时钟无效，请重新查询。')
  let previous: number | undefined, previousFrame = entry.timeline.from
  for (let frame = entry.timeline.from; frame < entry.timeline.to; frame++) {
    const source = sampleSeconds(entry, frame, sourceTimes)
    if (previous !== undefined && Math.abs(source - previous) < 1e-9) continue
    const elapsed = frame - previousFrame
    const sample: MotionReviewSample = { fromSeconds: (previous === undefined ? frame : previousFrame + 1) / fps, toSeconds: (frame + 1) / fps, speed: null, zoom: null, change: null, cut: false, still: null }
    if (previous !== undefined) {
      const from = Math.min(previous, source), to = Math.max(previous, source)
      if (from >= scan.startSeconds - 1e-7 && to < scan.endSeconds + 1e-7) {
        if (Math.abs(to - from) < 1e-9) Object.assign(sample, { speed: 0, zoom: 0, change: 0, still: true })
        else {
          let velocity = 0, zoom = 0, change = 0, covered = 0, speedKnown = true, zoomKnown = true, changeKnown = true, still = true
          const first = Math.max(0, Math.floor((from - scan.startSeconds) * scan.samplingFps + 1e-8))
          const last = Math.min(scan.samples.length - 1, Math.floor((to - scan.startSeconds) * scan.samplingFps + 1e-8))
          for (let i = first; i <= last; i++) {
            if (--budget.remaining < 0) throw new Error('视频运动映射超过200000采样访问预算，请缩小 from/to；未截断证据。')
            const value = scan.samples[i], duration = Math.max(0, Math.min(to, value.toSeconds) - Math.max(from, value.fromSeconds))
            if (value.cut && value.fromSeconds > from + 1e-8 && value.fromSeconds <= to + 1e-8) sample.cut = true
            if (duration <= 1e-9) continue
            covered += duration
            speedKnown &&= value.speed !== null; zoomKnown &&= value.zoom !== null; changeKnown &&= value.change !== null
            velocity += (value.speed ?? 0) * duration; zoom += (value.zoom ?? 0) * duration
            change = Math.max(change, value.change ?? 0); still &&= value.still === true
          }
          if (covered < to - from - 1e-7) speedKnown = zoomKnown = changeKnown = still = false
          if (sample.cut) {
            if (elapsed > 1) samples.push({ fromSeconds: sample.fromSeconds, toSeconds: frame / fps, speed: null, zoom: null, change: 0, cut: false, still: true })
            sample.fromSeconds = frame / fps
            Object.assign(sample, { speed: 0, zoom: 0, change, still: false })
          } else Object.assign(sample, { speed: speedKnown ? velocity * fps / elapsed : null, zoom: zoomKnown ? zoom * fps / elapsed * (source >= previous ? 1 : -1) : null, change: changeKnown ? change : null, still: still ? true : speedKnown ? false : null })
        }
      }
    }
    samples.push(sample); previous = source; previousFrame = frame
  }
  // A trailing repeated frame has no future update with which to estimate its
  // display cadence. Its input is held, but a missing velocity is not a hard stop.
  if (previousFrame + 1 < entry.timeline.to) samples.push({ fromSeconds: (previousFrame + 1) / fps, toSeconds: entry.timeline.to / fps, speed: null, zoom: null, change: 0, cut: false, still: true })
  return samples
}

export function collectVideoEditPixelMotion(jobs: readonly VideoEditPixelMotionInput[], fps: number, policy: MotionReviewPolicy): VideoEditMotionStructureFact[] {
  if (jobs.reduce((sum, job) => sum + job.entry.timeline.to - job.entry.timeline.from, 0) > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('视频运动映射超过60000帧实例预算，请缩小 from/to；未截断证据。')
  const records: VideoEditMotionStructureFact[] = [], checked = new Set<VideoMotionScan>(), budget = { remaining: 200000 }
  for (const { entry, scan, sourceTimes, input } of jobs) {
    if (!checked.has(scan)) { validateVideoMotionScan(scan, scan.startSeconds, scan.endSeconds); checked.add(scan) }
    const report = reviewMotionSamples(videoEditPixelMotionSamples(entry, scan, fps, budget, sourceTimes), policy), step = entry.path.at(-1)!
    const append = (kind: VideoEditMotionStructureFact['kind'], fromSeconds: number, toSeconds: number, peakSpeed?: number): void => {
      const timeline = { from: Math.max(entry.timeline.from, Math.round(fromSeconds * fps)), to: Math.min(entry.timeline.to, Math.round(toSeconds * fps)) }
      if (timeline.to <= timeline.from) return
      const first = sampleSeconds(entry, timeline.from, sourceTimes), last = sampleSeconds(entry, timeline.to - 1, sourceTimes)
      records.push({ kind, timeline, sequenceId: step.sequenceId, path: entry.path, subjectId: step.clipId, basis: input ? 'code_input_pixels' : 'video_pixels', ...(peakSpeed === undefined ? {} : { peakSpeed }),
        ...(input ? { input: { ...input }, detail: `这是代码参数“${input.parameter}”${input.kind === 'sequence' ? '下方画面中' : '所读取'}的原视频候选，不证明代码实际绘制或最终可见；变换、遮罩、效果与其他输入须看成片复核。` } : {}),
        source: { fromUs: Math.max(0, Math.round(Math.min(first, last) * 1e6)), toUs: Math.round(Math.min(scan.endSeconds, Math.max(first, last) + 1 / scan.samplingFps) * 1e6) } })
      if (records.length > 20000) throw new Error('视频运动候选超过20000项预算，请缩小 from/to；未截断结果。')
    }
    for (const event of report.events) {
      append(event.kind === 'cut' ? 'pixel_cut' : event.kind === 'change' ? 'pixel_change' : 'motion', event.fromSeconds, event.toSeconds, event.peak)
      if (event.hardStop) append('motion_hard_stop', event.toSeconds - 1 / fps, event.toSeconds + 1 / fps, event.peak)
    }
    for (const hold of report.stillness) append('pixel_still', hold.fromSeconds, hold.toSeconds)
    for (const unknown of report.unknown) append('pixel_unknown', unknown.fromSeconds, unknown.toSeconds)
  }
  return records
}
