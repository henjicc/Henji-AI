import { buildShotTimeline } from '../domain/shotCompiler'
import type { StageShot } from '../domain/shotTypes'

export interface ShotTimeRange {
  shotId: string
  holdStart: number
  transitionStart: number
  transitionEnd: number
}

export function getShotTimeRanges(shots: StageShot[]): ShotTimeRange[] {
  return buildShotTimeline(shots).map((segment, index) => ({
    shotId: shots[index].id,
    ...segment,
  }))
}

export function getShotAtTime(shots: StageShot[], time: number): ShotTimeRange | null {
  const ranges = getShotTimeRanges(shots)
  if (ranges.length === 0) return null
  const safeTime = Math.max(0, time)
  return ranges.find((range) => safeTime < range.transitionEnd) ?? ranges[ranges.length - 1]
}
