import { describe, expect, it } from 'vitest'
import { createShot } from '../domain/shotTypes'
import { getShotAtTime, getShotTimeRanges } from './shotTimelineUtils'

describe('镜头卡时间范围', () => {
  it('计算停留与过渡绝对区间', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 2
    shots[1].hold = 3
    expect(getShotTimeRanges(shots)).toEqual([
      { shotId: shots[0].id, holdStart: 0, transitionStart: 1, transitionEnd: 3 },
      { shotId: shots[1].id, holdStart: 3, transitionStart: 6, transitionEnd: 6 },
    ])
  })

  it('按播放头返回当前卡并钳制边界', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    expect(getShotAtTime(shots, -1)?.shotId).toBe(shots[0].id)
    expect(getShotAtTime(shots, 2.5)?.shotId).toBe(shots[1].id)
  })
})
