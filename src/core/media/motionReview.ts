import { z } from 'zod'

const seconds = z.number().finite().nonnegative().max(86400)
const interval = z.object({ fromSeconds: seconds, toSeconds: seconds }).strict().refine(value => value.toSeconds > value.fromSeconds, '运动证据区间必须向前且非空。')
export const motionReviewSampleSchema = interval.safeExtend({
  speed: z.number().finite().nonnegative().nullable(), zoom: z.number().finite().nullable(),
  change: z.number().finite().min(0).max(1).nullable(), cut: z.boolean(), still: z.boolean().nullable(),
}).strict()
export type MotionReviewSample = z.infer<typeof motionReviewSampleSchema>
export const motionReviewEventSchema = interval.safeExtend({
  kind: z.enum(['cut', 'move', 'change']), peak: z.number().finite().nonnegative().optional(),
  motion: z.enum(['push', 'pull', 'pan']).optional(), hardStop: z.boolean().optional(),
  changedRatio: z.number().min(0).max(1).optional(),
}).strict()
export type MotionReviewEvent = z.infer<typeof motionReviewEventSchema>
export const motionReviewReportSchema = z.object({
  events: z.array(motionReviewEventSchema).max(20000), stillness: z.array(interval).max(20000), unknown: z.array(interval).max(20000),
  crowded: z.array(interval.safeExtend({ gapSeconds: z.number().finite().nonnegative(), kinds: z.tuple([z.enum(['cut', 'move', 'change']), z.enum(['cut', 'move', 'change'])]) }).strict()).max(20000),
  curve: z.array(z.object({ timeSeconds: seconds, speed: z.number().finite().nonnegative().nullable(), change: z.number().min(0).max(1).nullable() }).strict()).max(400),
  summary: z.object({ durationSeconds: seconds, eventCount: z.number().int().nonnegative(), eventsPerMinute: z.number().finite().nonnegative(),
    medianGapSeconds: seconds.nullable(), stillSeconds: seconds, unknownSeconds: seconds, hardStops: z.number().int().nonnegative() }).strict(),
}).strict()
export type MotionReviewReport = z.infer<typeof motionReviewReportSchema>

/** Analysis starting points, never style rules or a verdict that a picture is wrong. */
export interface MotionReviewPolicy { minGapSeconds?: number; minimumStillSeconds?: number }
const adjacent = (left: MotionReviewSample, right: MotionReviewSample): boolean => Math.abs(left.toSeconds - right.fromSeconds) < 1e-7
const sumSeconds = (ranges: Array<{ fromSeconds: number; toSeconds: number }>): number => ranges.reduce((sum, range) => sum + range.toSeconds - range.fromSeconds, 0)

export function reviewMotionSamples(raw: readonly MotionReviewSample[], policy: MotionReviewPolicy = {}): MotionReviewReport {
  if (raw.length > 60000) throw new Error('运动采样超过单次60000项预算，请缩小范围；未截断证据。')
  const minGap = policy.minGapSeconds ?? 1.5, minimumStill = policy.minimumStillSeconds ?? 1
  if (!Number.isFinite(minGap) || minGap < 0 || minGap > 30 || !Number.isFinite(minimumStill) || minimumStill < 0 || minimumStill > 60) throw new Error('运动复核间隔须为0–30秒，静止时长须为0–60秒。')
  const samples = raw.map(value => motionReviewSampleSchema.parse(value))
  for (let i = 1; i < samples.length; i++) if (samples[i].fromSeconds < samples[i - 1].toSeconds - 1e-7) throw new Error('运动采样不能重叠或逆序。')
  const speed = samples.map((sample, i): number | null => {
    if (sample.cut) return 0
    if (sample.speed === null) return null
    const left = samples[i - 1], right = samples[i + 1]
    // Unknown estimates, cuts and unobserved gaps never inherit a nearby velocity.
    if (!left || !right || left.cut || right.cut || left.speed === null || right.speed === null || !adjacent(left, sample) || !adjacent(sample, right)) return sample.speed
    return [left.speed, sample.speed, right.speed].sort((a, b) => a - b)[1]
  })
  const events: MotionReviewEvent[] = [], moving = new Set<number>()
  for (let i = 0; i < samples.length; i++) if (samples[i].cut && (!samples[i - 1]?.cut || !adjacent(samples[i - 1], samples[i]))) {
    events.push({ kind: 'cut', fromSeconds: samples[i].fromSeconds, toSeconds: samples[i].toSeconds })
  }
  for (let i = 0; i < samples.length;) {
    if (speed[i] === null || speed[i]! < 2.5 || samples[i].cut) { i++; continue }
    let begin = i, end = i
    while (begin > 0 && adjacent(samples[begin - 1], samples[begin]) && !samples[begin - 1].cut && speed[begin - 1] !== null && speed[begin - 1]! >= 1.5) begin--
    while (end + 1 < samples.length && adjacent(samples[end], samples[end + 1]) && !samples[end + 1].cut && speed[end + 1] !== null && speed[end + 1]! >= 1.5) end++
    if (samples[end].toSeconds - samples[begin].fromSeconds >= .15 - 1e-9) {
      let peak = 0, zoom = 0, pan = 0
      for (let k = begin; k <= end; k++) {
        const duration = samples[k].toSeconds - samples[k].fromSeconds
        peak = Math.max(peak, speed[k]!); zoom += (samples[k].zoom ?? 0) * duration
        pan += Math.max(0, speed[k]! - Math.abs(samples[k].zoom ?? 0) / 2) * duration
        moving.add(k)
      }
      let half = end
      while (half > begin && speed[half]! < peak / 2) half--
      const next = samples[end + 1]
      const hardStop = Boolean(next && !next.cut && adjacent(samples[end], next) && speed[end + 1] !== null && peak >= 6 && next.toSeconds - samples[half].toSeconds <= .1 + 1e-9)
      events.push({ kind: 'move', fromSeconds: samples[begin].fromSeconds, toSeconds: samples[end].toSeconds, peak,
        motion: Math.abs(zoom) / 2 >= pan ? zoom >= 0 ? 'push' : 'pull' : 'pan', ...(hardStop ? { hardStop: true } : {}) })
    }
    i = end + 1
  }
  let change: MotionReviewEvent | undefined, previousChange = -1
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    if (moving.has(i) || sample.cut || sample.change === null) { change = undefined; previousChange = -1; continue }
    if (sample.change < .003) continue
    const continuous = previousChange >= 0 && samples.slice(previousChange, i).every((value, offset) => adjacent(value, samples[previousChange + offset + 1]))
    if (change && continuous && sample.fromSeconds - samples[previousChange].toSeconds <= .6 + 1e-9) {
      change.toSeconds = sample.toSeconds; change.changedRatio = Math.max(change.changedRatio!, sample.change)
    } else {
      change = { kind: 'change', fromSeconds: sample.fromSeconds, toSeconds: sample.toSeconds, changedRatio: sample.change }; events.push(change)
    }
    previousChange = i
  }
  events.sort((a, b) => a.fromSeconds - b.fromSeconds || a.kind.localeCompare(b.kind))
  const intervals = (select: (sample: MotionReviewSample) => boolean): Array<{ fromSeconds: number; toSeconds: number }> => {
    const result: Array<{ fromSeconds: number; toSeconds: number }> = []
    for (const sample of samples) {
      if (!select(sample)) continue
      const last = result.at(-1)
      if (last && Math.abs(last.toSeconds - sample.fromSeconds) < 1e-7) last.toSeconds = sample.toSeconds
      else result.push({ fromSeconds: sample.fromSeconds, toSeconds: sample.toSeconds })
    }
    return result
  }
  const stillness = intervals(sample => sample.still === true && !sample.cut).filter(range => range.toSeconds - range.fromSeconds >= minimumStill - 1e-7)
  const missing = samples.slice(1).flatMap((sample, i) => sample.fromSeconds > samples[i].toSeconds + 1e-7 ? [{ fromSeconds: samples[i].toSeconds, toSeconds: sample.fromSeconds }] : [])
  const unknown: Array<{ fromSeconds: number; toSeconds: number }> = []
  for (const value of [...intervals(sample => sample.speed === null && sample.still !== true && !sample.cut), ...missing].sort((a, b) => a.fromSeconds - b.fromSeconds)) {
    const last = unknown.at(-1)
    if (last && value.fromSeconds <= last.toSeconds + 1e-7) last.toSeconds = Math.max(last.toSeconds, value.toSeconds)
    else unknown.push({ ...value })
  }
  const crowded: MotionReviewReport['crowded'] = []
  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1], current = events[i], gapSeconds = current.fromSeconds - previous.fromSeconds
    if (gapSeconds < minGap) crowded.push({ fromSeconds: previous.fromSeconds, toSeconds: Math.max(previous.toSeconds, current.toSeconds), gapSeconds, kinds: [previous.kind, current.kind] })
  }
  const curve: MotionReviewReport['curve'] = []
  const perBin = Math.max(1, Math.ceil(samples.length / 400))
  for (let i = 0; i < samples.length; i += perBin) {
    const group = samples.slice(i, i + perBin), speeds = speed.slice(i, i + perBin)
    const gap = group.slice(1).some((sample, index) => !adjacent(group[index], sample))
    curve.push({ timeSeconds: group[0].fromSeconds, speed: gap || speeds.some(value => value === null) ? null : Math.max(...speeds as number[]),
      change: gap || group.some(value => value.change === null) ? null : Math.max(...group.map(value => value.change!)) })
  }
  const durationSeconds = samples.length ? samples.at(-1)!.toSeconds - samples[0].fromSeconds : 0, gaps = events.slice(1).map((event, i) => event.fromSeconds - events[i].fromSeconds).sort((a, b) => a - b)
  return motionReviewReportSchema.parse({ events, stillness, unknown, crowded, curve, summary: { durationSeconds, eventCount: events.length,
    eventsPerMinute: durationSeconds ? events.length / durationSeconds * 60 : 0, medianGapSeconds: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    stillSeconds: sumSeconds(stillness), unknownSeconds: sumSeconds(unknown), hardStops: events.filter(event => event.hardStop).length } })
}
