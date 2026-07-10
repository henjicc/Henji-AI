import { describe, expect, it } from 'vitest'
import { createShot } from '../../domain/shotTypes'
import {
  buildClipLayout,
  clampHold,
  clampTransition,
  findClipAtTime,
  isTimeInShotStaticSegment,
  isTimeInTransition,
  quantizeToFrame,
} from './shotClipGeometry'

const FPS = 30

describe('quantizeToFrame', () => {
  it('四舍五入到最近帧网格', () => {
    expect(quantizeToFrame(0.4999, FPS)).toBeCloseTo(15 / FPS, 10)
    expect(quantizeToFrame(1, FPS)).toBeCloseTo(1, 10)
    expect(quantizeToFrame(1 / FPS / 2, FPS)).toBeCloseTo(1 / FPS, 10)
  })

  it('负数量化后仍可能为负（钳制由 clampHold/clampTransition 负责）', () => {
    expect(quantizeToFrame(-0.02, FPS)).toBeCloseTo(-1 / FPS, 10)
  })
})

describe('clampHold', () => {
  it('钳到至少 1 帧', () => {
    expect(clampHold(0, FPS)).toBeCloseTo(1 / FPS, 10)
    expect(clampHold(-1, FPS)).toBeCloseTo(1 / FPS, 10)
    expect(clampHold(0.001, FPS)).toBeCloseTo(1 / FPS, 10)
  })

  it('高于 1 帧的值原样通过', () => {
    expect(clampHold(2, FPS)).toBe(2)
  })

  it('与 quantizeToFrame 组合后停留不可能小于 1 帧', () => {
    const value = quantizeToFrame(clampHold(0, FPS), FPS)
    expect(value).toBeGreaterThanOrEqual(1 / FPS)
  })
})

describe('clampTransition', () => {
  it('允许 0（硬切）', () => {
    expect(clampTransition(0, FPS)).toBe(0)
  })

  it('钳负数到 0', () => {
    expect(clampTransition(-1, FPS)).toBe(0)
  })

  it('正常正数原样通过', () => {
    expect(clampTransition(1.5, FPS)).toBe(1.5)
  })
})

describe('buildClipLayout', () => {
  it('块时间边界与 buildShotTimeline 一致，末卡无过渡块', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 2
    shots[1].hold = 3

    const layout = buildClipLayout(shots, 100)
    expect(layout).toHaveLength(3)

    expect(layout[0]).toMatchObject({ kind: 'static', shotId: shots[0].id, index: 0, startTime: 0, endTime: 1, x: 0, width: 100 })
    expect(layout[1]).toMatchObject({ kind: 'transition', shotId: shots[0].id, index: 0, startTime: 1, endTime: 3, x: 100, width: 200 })
    expect(layout[2]).toMatchObject({ kind: 'static', shotId: shots[1].id, index: 1, startTime: 3, endTime: 6, x: 300, width: 300 })
  })

  it('0 帧过渡输出零宽过渡块', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 0
    shots[1].hold = 1

    const layout = buildClipLayout(shots, 100)
    const transitionBlock = layout.find((block) => block.kind === 'transition')
    expect(transitionBlock).toMatchObject({ startTime: 1, endTime: 1, width: 0 })
  })

  it('空镜头卡数组返回空布局', () => {
    expect(buildClipLayout([], 100)).toEqual([])
  })
})

describe('findClipAtTime', () => {
  it('命中段首', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 2
    shots[1].hold = 3
    const layout = buildClipLayout(shots, 100)
    expect(findClipAtTime(layout, 0)?.kind).toBe('static')
    expect(findClipAtTime(layout, 0)?.shotId).toBe(shots[0].id)
  })

  it('边界时间归属后一块', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 2
    shots[1].hold = 3
    const layout = buildClipLayout(shots, 100)
    // t=1 是 static(A) 与 transition(A) 的分界，应归属 transition 块
    expect(findClipAtTime(layout, 1)?.kind).toBe('transition')
    // t=3 是 transition(A) 与 static(B) 的分界，应归属 static(B)
    const atThree = findClipAtTime(layout, 3)
    expect(atThree?.kind).toBe('static')
    expect(atThree?.shotId).toBe(shots[1].id)
  })

  it('超出总时长钳制到尾块，负数钳制到首块', () => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 2
    shots[1].hold = 3
    const layout = buildClipLayout(shots, 100)
    expect(findClipAtTime(layout, 999)?.shotId).toBe(shots[1].id)
    expect(findClipAtTime(layout, -5)?.shotId).toBe(shots[0].id)
  })

  it('空布局返回 null', () => {
    expect(findClipAtTime([], 5)).toBeNull()
  })
})

describe('isTimeInShotStaticSegment / isTimeInTransition', () => {
  const buildShots = (): ReturnType<typeof createShot>[] => {
    const shots = [createShot([], 'A'), createShot([], 'B')]
    shots[0].hold = 1
    shots[0].transitionDuration = 2
    shots[1].hold = 3
    return shots
  }

  it('静止段内命中对应卡，过渡段/别的卡不命中', () => {
    const shots = buildShots()
    expect(isTimeInShotStaticSegment(shots, shots[0].id, 0.5, FPS)).toBe(true)
    expect(isTimeInShotStaticSegment(shots, shots[0].id, 2, FPS)).toBe(false) // A 的过渡段
    expect(isTimeInShotStaticSegment(shots, shots[1].id, 2, FPS)).toBe(false) // A 的过渡段，不属于 B
    expect(isTimeInShotStaticSegment(shots, shots[1].id, 4, FPS)).toBe(true)
  })

  it('不存在的 shotId 返回 false', () => {
    const shots = buildShots()
    expect(isTimeInShotStaticSegment(shots, 'not-exist', 0.5, FPS)).toBe(false)
  })

  it('半帧容差内的边界时间仍视为静止段', () => {
    const shots = buildShots()
    const eps = 1 / (2 * FPS)
    expect(isTimeInShotStaticSegment(shots, shots[0].id, 1 + eps / 2, FPS)).toBe(true)
    expect(isTimeInShotStaticSegment(shots, shots[0].id, 1 + eps * 2, FPS)).toBe(false)
  })

  it('isTimeInTransition 与静止段判断互补', () => {
    const shots = buildShots()
    expect(isTimeInTransition(shots, 0.5, FPS)).toBe(false)
    expect(isTimeInTransition(shots, 2, FPS)).toBe(true)
    expect(isTimeInTransition(shots, 4, FPS)).toBe(false)
  })

  it('空镜头卡数组恒为 false', () => {
    expect(isTimeInTransition([], 5, FPS)).toBe(false)
  })
})
