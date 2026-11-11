import { describe, expect, it } from 'vitest'

import { clampViewportZoom, viewportTransform, zoomViewportAroundPoint } from './zoomPan'

describe('画面视口缩放平移', () => {
  it('缩放始终受统一上下限约束', () => {
    expect(clampViewportZoom(0)).toBe(0.05)
    expect(clampViewportZoom(16)).toBe(8)
    expect(clampViewportZoom(Number.NaN)).toBe(1)
  })

  it('以指针为锚点缩放时保持该文档位置不动', () => {
    const currentPan = { x: 30, y: -20 }
    const point = { x: 180, y: 90 }
    const next = zoomViewportAroundPoint(1, currentPan, 2, point)

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
    expect(viewportTransform(1.5, { x: 12, y: -8 })).toBe(
      'translate3d(12px, -8px, 0) scale(1.5)',
    )
    expect(viewportTransform(2, { x: Number.NaN, y: Number.POSITIVE_INFINITY })).toBe(
      'translate3d(0px, 0px, 0) scale(2)',
    )
  })
})
