import { describe, expect, it } from 'vitest'

import {
  clampRelightDirectionPoint,
  relightDirectionFromPoint,
  relightPointForDirection,
} from './relightDirectionVisualizerState'

describe('打光方向可视化映射', () => {
  it('把中心与四个方向区域映射到模型支持的五档方向', () => {
    expect(relightDirectionFromPoint({ x: 0.1, y: -0.1 })).toBe('none')
    expect(relightDirectionFromPoint({ x: -0.7, y: 0.2 })).toBe('left')
    expect(relightDirectionFromPoint({ x: 0.7, y: -0.2 })).toBe('right')
    expect(relightDirectionFromPoint({ x: 0.2, y: -0.7 })).toBe('top')
    expect(relightDirectionFromPoint({ x: -0.2, y: 0.7 })).toBe('bottom')
  })

  it('把越界拖动约束在球面范围内并保持方向', () => {
    const point = clampRelightDirectionPoint({ x: 4, y: 3 })
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(0.92)
    expect(relightDirectionFromPoint(point)).toBe('right')
  })

  it('预设灯位在正面视图保持正交，在透视视图产生景深投影', () => {
    expect(relightPointForDirection('left', 'front')).toEqual({ x: -0.84, y: 0 })
    expect(relightPointForDirection('top', 'front')).toEqual({ x: 0, y: -0.84 })

    const perspectiveLeft = relightPointForDirection('left', 'perspective')
    expect(perspectiveLeft.x).toBeLessThan(0)
    expect(perspectiveLeft.y).toBeGreaterThan(0)
    expect(relightDirectionFromPoint(perspectiveLeft)).toBe('left')
  })
})
