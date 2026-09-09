// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiAngleOrbitScene } from './MultiAngleOrbitScene'
import { multiAngleMarkerPosition, projectMultiAnglePoint } from './multiAngleOrbitGeometry'
import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS } from '@/features/canvas/capabilities/multiAnglePolicy'

afterEach(cleanup)
describe('多角度轻量轨道', () => {
  it('相机朝向投影中心，保留方位与远近缩放', () => {
    const center = projectMultiAnglePoint([0, 0, 0])
    const towardCamera = projectMultiAnglePoint([0.38, 0.25, 0.45])
    expect(center.x).toBe(50)
    expect(center.y).toBe(50)
    expect(towardCamera.x).toBeCloseTo(50)
    expect(towardCamera.y).toBeCloseTo(50)
    expect(towardCamera.scale).toBeGreaterThan(center.scale)
    for (const { view } of MULTI_ANGLE_DISCRETE_VIEW_PRESETS) {
      const point = projectMultiAnglePoint(multiAngleMarkerPosition(view))
      expect(point.x).toBeGreaterThan(0)
      expect(point.x).toBeLessThan(100)
      expect(point.y).toBeGreaterThan(0)
      expect(point.y).toBeLessThan(100)
    }
  })
  it('多节点静态展示不创建 Canvas/GPU 上下文，也不启动绘制循环', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const views = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map(preset => preset.view)
    const { container } = render(<>{Array.from({ length: 24 }, (_, index) => <MultiAngleOrbitScene key={index} views={views} selectedViewId={views[0].viewId} />)}</>)
    expect(container.querySelectorAll('svg')).toHaveLength(24)
    expect(container.querySelectorAll('circle')).toHaveLength(24 * views.length)
    expect(getContext).not.toHaveBeenCalled()
    expect(raf).not.toHaveBeenCalled()
    getContext.mockRestore()
    raf.mockRestore()
  })
})
