import { describe, expect, it } from 'vitest'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { getStateKeyframeAtTime, getStateKeyframeTimeRanges } from './stateKeyframeTimelineUtils'

describe('状态关键帧时间范围', () => {
  it('计算停留与过渡绝对区间', () => {
    const stateKeyframes = [createStateKeyframe([], 'A'), createStateKeyframe([], 'B')]
    stateKeyframes[0].hold = 1
    stateKeyframes[0].transitionDuration = 2
    stateKeyframes[1].hold = 3
    expect(getStateKeyframeTimeRanges(stateKeyframes)).toEqual([
      { stateKeyframeId: stateKeyframes[0].id, holdStart: 0, transitionStart: 1, transitionEnd: 3 },
      { stateKeyframeId: stateKeyframes[1].id, holdStart: 3, transitionStart: 6, transitionEnd: 6 },
    ])
  })

  it('按播放头返回当前卡并钳制边界', () => {
    const stateKeyframes = [createStateKeyframe([], 'A'), createStateKeyframe([], 'B')]
    expect(getStateKeyframeAtTime(stateKeyframes, -1)?.stateKeyframeId).toBe(stateKeyframes[0].id)
    expect(getStateKeyframeAtTime(stateKeyframes, 2.5)?.stateKeyframeId).toBe(stateKeyframes[1].id)
  })
})
