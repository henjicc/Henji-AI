import { describe, expect, it } from 'vitest'

import {
  clampImageEditorFloatingPanelPositionV3,
  resolveImageEditorPanelDockEdgeV3,
  resolveImageEditorPanelDockIndexV3,
} from './imageEditorPanelLayoutV3'

describe('图片编辑器面板停靠布局', () => {
  it('按面板边沿吸附左右侧，并且远离边缘时保持浮动', () => {
    const viewport = { width: 1200, height: 800 }
    const size = { width: 400, height: 500 }
    expect(resolveImageEditorPanelDockEdgeV3({ left: 12, top: 80 }, size, viewport)).toBe('left')
    expect(resolveImageEditorPanelDockEdgeV3({ left: 792, top: 80 }, size, viewport)).toBe('right')
    expect(resolveImageEditorPanelDockEdgeV3({ left: 300, top: 80 }, size, viewport)).toBeNull()
  })

  it('把浮动面板限制在工作区内，同时允许折叠头始终可见', () => {
    expect(clampImageEditorFloatingPanelPositionV3(
      { left: -100, top: 900 },
      { width: 400, height: 600 },
      { width: 1000, height: 700 },
    )).toEqual({ left: 8, top: 668 })
  })

  it('根据兄弟面板中心决定停靠组合的上下顺序', () => {
    expect(resolveImageEditorPanelDockIndexV3(100, [300])).toBe(0)
    expect(resolveImageEditorPanelDockIndexV3(500, [300])).toBe(1)
    expect(resolveImageEditorPanelDockIndexV3(500, [])).toBe(0)
  })
})
