import { buildStateKeyframeTimeline } from '../domain/stateKeyframeCompiler'
import type { StageStateKeyframe } from '../domain/stateKeyframeTypes'

export interface StateKeyframeTimeRange {
  stateKeyframeId: string
  holdStart: number
  transitionStart: number
  transitionEnd: number
}

export function getStateKeyframeTimeRanges(stateKeyframes: StageStateKeyframe[]): StateKeyframeTimeRange[] {
  return buildStateKeyframeTimeline(stateKeyframes).map((segment, index) => ({
    stateKeyframeId: stateKeyframes[index].id,
    ...segment,
  }))
}

export function getStateKeyframeAtTime(stateKeyframes: StageStateKeyframe[], time: number): StateKeyframeTimeRange | null {
  const ranges = getStateKeyframeTimeRanges(stateKeyframes)
  if (ranges.length === 0) return null
  const safeTime = Math.max(0, time)
  return ranges.find((range) => safeTime < range.transitionEnd) ?? ranges[ranges.length - 1]
}
