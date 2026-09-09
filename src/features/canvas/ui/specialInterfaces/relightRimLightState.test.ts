import { describe, expect, it } from 'vitest'
import {
  RIM_DIRECTION_ORDER, rimAngleForDirection, rimAngleFromPoint,
  rimDirectionFromAngle, rimPointForAngle,
} from './relightRimLightState'

describe('轮廓光方向映射', () => {
  it.each(['front', 'perspective'] as const)('%s 视图的八个方位投影可逆，方向不会因切换视图偏转', (view) => {
    for (const direction of RIM_DIRECTION_ORDER) {
      const point = rimPointForAngle(rimAngleForDirection(direction), view)
      const angle = rimAngleFromPoint(point, view)
      expect(angle).not.toBeNull()
      expect(rimDirectionFromAngle(angle!)).toBe(direction)
    }
  })
  it('只保留方向，越界不会离开轨道，中心不会被解释为关闭', () => {
    const angle = rimAngleFromPoint({ x: -20, y: -20 }, 'front')!
    expect(rimDirectionFromAngle(angle)).toBe('top-left')
    const point = rimPointForAngle(angle, 'front')
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(0.65)
    expect(rimAngleFromPoint({ x: 0, y: 0 }, 'perspective')).toBeNull()
  })
})
