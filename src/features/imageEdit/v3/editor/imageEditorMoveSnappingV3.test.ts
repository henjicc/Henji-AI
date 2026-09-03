import { describe, expect, it } from 'vitest'

import {
  createImageEditorDocumentSnapCandidatesV3,
  resolveImageEditorMoveSnapV3,
} from './imageEditorMoveSnappingV3'

describe('imageEditorMoveSnappingV3', () => {
  const candidates = createImageEditorDocumentSnapCandidatesV3(100, 80)

  it('在阈值内吸附到图片边缘', () => {
    expect(resolveImageEditorMoveSnapV3(
      { left: 5, top: 18, right: 45, bottom: 38 },
      candidates,
      { x: 6, y: 3 },
    )).toEqual({
      deltaX: -5,
      deltaY: 2,
      guides: [
        { axis: 'x', position: 0 },
        { axis: 'y', position: 40 },
      ],
    })
  })

  it('支持水平与垂直中心独立吸附', () => {
    expect(resolveImageEditorMoveSnapV3(
      { left: 31, top: 31, right: 67, bottom: 51 },
      candidates,
      { x: 2, y: 2 },
    )).toEqual({
      deltaX: 1,
      deltaY: -1,
      guides: [
        { axis: 'x', position: 50 },
        { axis: 'y', position: 40 },
      ],
    })
  })

  it('超过阈值时保持原始位置', () => {
    expect(resolveImageEditorMoveSnapV3(
      { left: 9, top: 9, right: 39, bottom: 29 },
      candidates,
      { x: 4, y: 4 },
    )).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
  })

  it('整幅图片复位时优先显示中心参考线，避免三条重叠提示', () => {
    expect(resolveImageEditorMoveSnapV3(
      { left: 0, top: 0, right: 100, bottom: 80 },
      candidates,
      { x: 8, y: 8 },
    ).guides).toEqual([
      { axis: 'x', position: 50 },
      { axis: 'y', position: 40 },
    ])
  })
})
