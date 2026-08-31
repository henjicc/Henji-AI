import { describe, expect, it } from 'vitest'

import {
  clampImageEditorViewportZoomV3,
  imageEditorViewportTransformV3,
  zoomImageEditorViewportAroundPointV3,
} from './viewportNavigationV3'

describe('图片编辑 V3 视口导航', () => {
  it('缩放始终受统一上下限约束', () => {
    expect(clampImageEditorViewportZoomV3(0)).toBe(0.05)
    expect(clampImageEditorViewportZoomV3(16)).toBe(8)
    expect(clampImageEditorViewportZoomV3(Number.NaN)).toBe(1)
  })

  it('以指针为锚点缩放时保持该文档位置不动', () => {
    const currentPan = { x: 30, y: -20 }
    const point = { x: 180, y: 90 }
    const next = zoomImageEditorViewportAroundPointV3(1, currentPan, 2, point)

    expect(next).toEqual({ zoom: 2, pan: { x: -120, y: -130 } })
    const beforeDocumentPoint = {
      x: (point.x - currentPan.x) / 1,
      y: (point.y - currentPan.y) / 1,
    }
    expect({
      x: (point.x - next.pan.x) / next.zoom,
      y: (point.y - next.pan.y) / next.zoom,
    }).toEqual(beforeDocumentPoint)
  })

  it('输出只包含有限、受控的合成变换', () => {
    expect(imageEditorViewportTransformV3(1.5, { x: 12, y: -8 })).toBe(
      'translate3d(12px, -8px, 0) scale(1.5)',
    )
    expect(imageEditorViewportTransformV3(2, { x: Number.NaN, y: Number.POSITIVE_INFINITY })).toBe(
      'translate3d(0px, 0px, 0) scale(2)',
    )
  })
})
