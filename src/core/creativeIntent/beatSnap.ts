import type { CompiledMotion } from './motionCompiler'
import type { PreparedTake } from './sampling'

export function nearestBeatFrame(frame: number, beats: readonly number[]): number | undefined {
  if (!beats.length) return undefined
  let low = 0, high = beats.length
  while (low < high) { const mid = (low + high) >>> 1; if (beats[mid] < frame) low = mid + 1; else high = mid }
  const before = beats[low - 1], after = beats[low]
  return before === undefined ? after : after === undefined || frame - before <= after - frame ? before : after
}

/** Retiming only: keep pose values, hard pins, boundary frames and native curve interpolation. */
export function snapMotionToBeats(motion: CompiledMotion, take: PreparedTake, clipStart: number, beatFrames: readonly number[]): CompiledMotion {
  const beats = [...new Set(beatFrames)].filter(Number.isSafeInteger).sort((a, b) => a - b)
  if (!beats.length) return motion
  const pinned = new Set(take.pins.map(p => p.point.frame - clipStart))
  const times = [...new Set(Object.values(motion.curves).flatMap(points => points?.map(p => p.time) ?? []))].sort((a, b) => a - b)
  const mapped = times.map(time => pinned.has(time) || time === motion.range[0] || time === motion.range[1] ? time : (nearestBeatFrame(time + clipStart, beats) ?? time + clipStart) - clipStart)
  // A shared time map keeps X/Y/scale coherent. Colliding anchors keep their authored times instead of dropping poses.
  for (let i = 0; i < mapped.length; i++) if (mapped[i] < motion.range[0] || mapped[i] > motion.range[1]) mapped[i] = times[i]
  const edges = times.slice(1).map((_, i) => i + 1)
  // Each moved anchor reverts at most once, so long dense curves do not trigger quadratic rescans.
  for (let next = 0; next < edges.length; next++) {
    const i = edges[next]
    if (i <= 0 || i >= mapped.length || mapped[i] > mapped[i - 1]) continue
    if (mapped[i] !== times[i]) { mapped[i] = times[i]; edges.push(i + 1) }
    if (mapped[i - 1] !== times[i - 1]) { mapped[i - 1] = times[i - 1]; edges.push(i - 1) }
  }
  const timeMap = new Map(times.map((time, i) => [time, mapped[i]]))
  return { ...motion, curves: Object.fromEntries(Object.entries(motion.curves).map(([key, points]) => [key, points.map(point => ({ ...point, time: timeMap.get(point.time)! }))])) }
}
