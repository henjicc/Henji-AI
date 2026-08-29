import { describe, expect, it } from 'vitest'

import { MULTI_ANGLE_CONTINUOUS_PRESETS } from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  continuousCameraFromDrag,
  continuousCameraFromKey,
  describeMultiAngleCamera,
  discretePresetFromPoint,
  proximityFromWheel,
} from './multiAngleCameraVisualizerState'

describe('多角度镜头可视化状态', () => {
  it('将相对拖拽映射到模型真实水平和垂直控制量', () => {
    expect(continuousCameraFromDrag({
      clientX: 100,
      clientY: 100,
      yawControlDeg: 0,
      verticalControl: 0,
    }, 150, 50, { width: 200, height: 200 })).toEqual({
      yawControlDeg: -45,
      verticalControl: -0.5,
    })

    expect(continuousCameraFromDrag({
      clientX: 100,
      clientY: 100,
      yawControlDeg: 80,
      verticalControl: 0.9,
    }, 0, 300, { width: 200, height: 200 })).toEqual({
      yawControlDeg: 90,
      verticalControl: 1,
    })
  })

  it('用方向键调整角度，并用滚轮调整景别', () => {
    const view = MULTI_ANGLE_CONTINUOUS_PRESETS[0].view
    expect(continuousCameraFromKey(view, 'ArrowLeft')).toEqual({ yawControlDeg: 60 })
    expect(continuousCameraFromKey(view, 'ArrowUp')).toEqual({ verticalControl: -0.15 })
    expect(continuousCameraFromKey(view, 'Escape')).toBeNull()
    expect(proximityFromWheel(5, -10)).toBe(5.5)
    expect(proximityFromWheel(0, 10)).toBe(0)
  })

  it('完整方位会吸附到离指针最近的模型预设', () => {
    const metrics = { left: 0, top: 0, width: 200, height: 200 }
    expect(discretePresetFromPoint(0, 100, metrics)).toBe('left_side')
    expect(discretePresetFromPoint(100, 0, metrics)).toBe('top_down')
    expect(discretePresetFromPoint(200, 150, metrics)).toBe('three_quarter_right')
  })

  it('用用户可理解的方位和景别描述连续参数', () => {
    expect(describeMultiAngleCamera({
      ...MULTI_ANGLE_CONTINUOUS_PRESETS[0].view,
      yawControlDeg: -45,
      verticalControl: -0.6,
      proximity: 7,
    })).toBe('右环绕 45° · 高位 60% · 近景')
  })
})
