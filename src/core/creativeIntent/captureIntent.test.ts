import { expect, it } from 'vitest'
import { classifyMotionCapture } from './captureIntent'

it('只拖时间轴是找位置，暂停摆元素是姿态，时间轴运动中摆元素是轨迹', () => {
  expect(classifyMotionCapture(false, false, true, true)).toBe('navigate')
  expect(classifyMotionCapture(false, true, false, true)).toBe('navigate')
  expect(classifyMotionCapture(true, false, false, false)).toBe('pose')
  expect(classifyMotionCapture(true, true, false, false)).toBe('trajectory')
  expect(classifyMotionCapture(true, false, true, true)).toBe('trajectory')
})
