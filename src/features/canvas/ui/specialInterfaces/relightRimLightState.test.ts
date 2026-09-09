import { describe, expect, it } from 'vitest'
import {
  RIM_DIRECTION_ORDER, rimAngleForDirection, rimDirectionFromAngle,
} from './relightRimLightState'

describe('轮廓光方向映射', () => {
  it('八档方向映射可逆，跨越角度零点仍保持正确方向', () => {
    for (const direction of RIM_DIRECTION_ORDER) {
      const angle = rimAngleForDirection(direction)
      expect(rimDirectionFromAngle(angle)).toBe(direction)
      expect(rimDirectionFromAngle(angle - Math.PI * 2)).toBe(direction)
    }
  })
})
