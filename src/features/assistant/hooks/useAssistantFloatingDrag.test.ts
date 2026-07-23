import { describe, expect, it } from 'vitest'

import { clampAssistantFloatingPosition } from './useAssistantFloatingDrag'

describe('clampAssistantFloatingPosition', () => {
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

  it('小窗口下仍保留可拖动的安全边距', () => {
    expect(clampAssistantFloatingPosition(
      { x: 300, y: 300 },
      { width: 420, height: 680 },
      { width: 360, height: 500 }
    )).toEqual({ x: 12, y: 48 })
  })
})
