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

  it('向上展开的底边不依赖历史高度或筛选后的内容高度', () => {
    const options = { ...baseOptions, anchor: { ...baseOptions.anchor, top: 700, bottom: 740 } }
    for (const panelHeight of [900, 500, 120]) {
      const position = resolveFloatingPanelPosition({ ...options, panelHeight })
      expect(position.placement).toBe('above')
      expect(position.bottom).toBe(108)
      expect(options.viewportHeight - position.bottom! + options.gap).toBe(options.anchor.top)
    }
    expect(resolveFloatingPanelPosition(baseOptions).bottom).toBeUndefined()
  })
})

it('画布内菜单避开侧栏并按宿主范围限制宽高', () => {
  const result = resolveFloatingPanelPosition({
    anchor: { left: 940, top: 600, bottom: 630, width: 40 },
    panelWidth: 320, panelHeight: 800,
    viewportWidth: 1200, viewportHeight: 900,
    preferredPlacement: 'below', horizontalAlign: 'left', gap: 8,
    boundary: { left: 220, top: 80, width: 760, height: 600 },
    viewportGutter: 12,
  })
  expect(result.left).toBe(648)
  expect(result.placement).toBe('above')
  expect(result.top).toBe(92)
  expect(result.maxHeight).toBe(500)
})
