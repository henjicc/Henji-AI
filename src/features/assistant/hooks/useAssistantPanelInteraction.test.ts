import { describe, expect, it } from 'vitest'

import {
  clampAssistantFloatingPosition,
  clampAssistantPanelSize,
  resizeAssistantPanelLayout,
} from './useAssistantPanelInteraction'

describe('assistant panel interaction geometry', () => {
  it('把悬浮面板约束在标题栏下方和可视区内', () => {
    expect(clampAssistantFloatingPosition(
      { x: -100, y: 2 },
      { width: 420, height: 680 },
      { width: 1280, height: 900 }
    )).toEqual({ x: 12, y: 48 })

    expect(clampAssistantFloatingPosition(
      { x: 2_000, y: 2_000 },
      { width: 420, height: 680 },
      { width: 1280, height: 900 }
    )).toEqual({ x: 848, y: 208 })
  })

  it('按停靠方向解释内侧边缘拖动并限制宽度', () => {
    const layout = { position: { x: 12, y: 48 }, size: { width: 420, height: 680 } }
    const viewport = { width: 1280, height: 900 }
    expect(resizeAssistantPanelLayout('left', 'width', layout, { x: 100, y: 0 }, viewport).size.width).toBe(520)
    expect(resizeAssistantPanelLayout('right', 'width', layout, { x: -100, y: 0 }, viewport).size.width).toBe(520)
    expect(resizeAssistantPanelLayout('right', 'width', layout, { x: 500, y: 0 }, viewport).size.width).toBe(320)
  })

  it('悬浮态可同时调整宽高且不会越过右下边界', () => {
    const layout = { position: { x: 100, y: 60 }, size: { width: 420, height: 500 } }
    expect(resizeAssistantPanelLayout(
      'floating',
      'both',
      layout,
      { x: 100, y: 100 },
      { width: 1280, height: 900 }
    ).size).toEqual({ width: 520, height: 600 })

    expect(clampAssistantPanelSize(
      'floating',
      { width: 1_200, height: 1_200 },
      { x: 700, y: 400 },
      { width: 1280, height: 900 }
    )).toEqual({ width: 568, height: 488 })
  })

  it('小窗口下仍保留可拖动的安全位置', () => {
    expect(clampAssistantFloatingPosition(
      { x: 300, y: 300 },
      { width: 420, height: 680 },
      { width: 360, height: 500 }
    )).toEqual({ x: 12, y: 48 })
  })
})
