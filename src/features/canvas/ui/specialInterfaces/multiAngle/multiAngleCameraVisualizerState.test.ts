import { multiAngleOrientation } from './multiAngleOrbitGeometry'
import { describe, expect, it } from 'vitest'

import {
  MULTI_ANGLE_CONTINUOUS_PRESETS,
  MULTI_ANGLE_DISCRETE_VIEW_PRESETS,
  MULTI_ANGLE_FLUX_PRESETS,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  continuousCameraFromDrag,
  continuousCameraFromKey,
  describeMultiAngleCamera,
  discretePresetForOrientation,
  discreteOrientationFromDrag,
  fluxCameraFromDrag,
  fluxCameraFromKey,
  fluxZoomFromWheel,
  proximityFromWheel,
  snapContinuousCamera,
  snapFluxCamera,
} from './multiAngleCameraVisualizerState'

describe('多角度镜头可视化状态', () => {
  it('拖动保留连续小数，只有松手才吸附常用角度或按 API 精度提交', () => {
    const origin = { clientX: 0, clientY: 0, yawControlDeg: 0, verticalControl: 0 }
    const preview = continuousCameraFromDrag(origin, 43.125, 1.23, { width: 180, height: 200 })
    expect(preview.yawControlDeg).toBeCloseTo(43.125)
    expect(preview.verticalControl).toBeCloseTo(-0.0123)
    expect(snapContinuousCamera(preview)).toEqual({ yawControlDeg: 45, verticalControl: 0 })
    expect(continuousCameraFromDrag(origin, 38, 0, { width: 180, height: 200 }).yawControlDeg).toBe(38)
    const flux = { clientX: 0, clientY: 0, horizontalAngleDeg: 0, verticalAngleDeg: 0 }
    const fluxPreview = fluxCameraFromDrag(flux, -43.125, 14.25, { width: 360, height: 60 })
    expect(fluxPreview.horizontalAngleDeg).toBeCloseTo(43.125)
    expect(fluxPreview.verticalAngleDeg).toBeCloseTo(14.25)
    expect(snapFluxCamera(fluxPreview)).toEqual({ horizontalAngleDeg: 45, verticalAngleDeg: 15 })
    expect(fluxCameraFromDrag(flux, -38, 10, { width: 360, height: 60 })).toEqual({ horizontalAngleDeg: 38, verticalAngleDeg: 10 })
  })
  it('将相对拖拽映射到模型真实水平和垂直控制量', () => {
    expect(continuousCameraFromDrag({
      clientX: 100,
      clientY: 100,
      yawControlDeg: 0,
      verticalControl: 0,
    }, 150, 50, { width: 200, height: 200 })).toEqual({
      yawControlDeg: 45,
      verticalControl: 0.5,
    })

    expect(continuousCameraFromDrag({
      clientX: 100,
      clientY: 100,
      yawControlDeg: 80,
      verticalControl: 0.9,
    }, 300, 300, { width: 200, height: 200 })).toEqual({
      yawControlDeg: 90,
      verticalControl: -1,
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

  it('完整方位在三维方向上找最近预设，跨越前后时连续旋转', () => {
    for (const { view } of MULTI_ANGLE_DISCRETE_VIEW_PRESETS) {
      const pose = multiAngleOrientation(view)
      expect(discretePresetForOrientation(pose)).toBe(view.preset)
      expect(discretePresetForOrientation({ ...pose, azimuth: pose.azimuth + 360 })).toBe(view.preset)
    }
    const origin = { azimuth: 0, elevation: 0, clientX: 0, clientY: 0 }
    const pose = discreteOrientationFromDrag(origin, 99.125, 0, { width: 200, height: 200 })
    expect(pose.azimuth).toBeCloseTo(-178.425)
    expect(discretePresetForOrientation(pose)).toBe('back')
  })

  it('用用户可理解的方位和景别描述连续参数', () => {
    expect(describeMultiAngleCamera({
      ...MULTI_ANGLE_CONTINUOUS_PRESETS[0].view,
      yawControlDeg: -45,
      verticalControl: -0.6,
      proximity: 7,
    })).toBe('右环绕 45° · 高位 60% · 近景')
  })

  it('FLUX 拖拽、键盘与滚轮只编辑原生 0–360/0–60/0–10 控制量', () => {
    expect(fluxCameraFromDrag({
      clientX: 100,
      clientY: 100,
      horizontalAngleDeg: 0,
      verticalAngleDeg: 0,
    }, 50, 150, { width: 200, height: 200 })).toEqual({
      horizontalAngleDeg: 90,
      verticalAngleDeg: 15,
    })
    expect(fluxCameraFromDrag({
      clientX: 100,
      clientY: 100,
      horizontalAngleDeg: 350,
      verticalAngleDeg: 55,
    }, 300, 300, { width: 200, height: 200 })).toEqual({
      horizontalAngleDeg: 350,
      verticalAngleDeg: 60,
    })

    const view = MULTI_ANGLE_FLUX_PRESETS[1].view
    expect(fluxCameraFromKey(view, 'ArrowLeft')).toEqual({ horizontalAngleDeg: 75 })
    expect(fluxCameraFromKey(view, 'ArrowUp')).toEqual({ verticalAngleDeg: 5 })
    expect(fluxCameraFromKey(view, 'Escape')).toBeNull()
    expect(fluxZoomFromWheel(5, -10)).toBe(5.5)
    expect(fluxZoomFromWheel(0, 10)).toBe(0)
    expect(describeMultiAngleCamera(view)).toBe('水平 90° · 垂直 0° · Zoom 5')
  })
})
