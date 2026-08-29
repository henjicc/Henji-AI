import { describe, expect, it } from 'vitest'

import { resolveFloatingPanelPosition } from './floatingPanelPosition'

const baseOptions = {
  anchor: { top: 280, bottom: 320, left: 400, width: 160 },
  panelWidth: 320,
  panelHeight: 260,
  viewportWidth: 1200,
  viewportHeight: 800,
  preferredPlacement: 'above' as const,
  horizontalAlign: 'center' as const,
  gap: 8,
  viewportGutter: 12,
  viewportTopInset: 48,
}

describe('resolveFloatingPanelPosition', () => {
  it('首选方向放不下而下方空间充足时自动向下展开', () => {
    const position = resolveFloatingPanelPosition(baseOptions)

    expect(position.placement).toBe('below')
    expect(position.top).toBe(328)
    expect(position.maxHeight).toBe(460)
  })

  it('两侧都放不下时选择空间更大的一侧并限制最大高度', () => {
    const position = resolveFloatingPanelPosition({
      ...baseOptions,
      anchor: { ...baseOptions.anchor, top: 560, bottom: 600 },
      panelHeight: 720,
    })

    expect(position.placement).toBe('above')
    expect(position.top).toBe(48)
    expect(position.maxHeight).toBe(504)
  })

  it('水平居中后仍会收进视口安全区', () => {
    const position = resolveFloatingPanelPosition({
      ...baseOptions,
      anchor: { ...baseOptions.anchor, left: 8 },
    })

    expect(position.left).toBe(12)
    expect(position.width).toBe(320)
  })
})
