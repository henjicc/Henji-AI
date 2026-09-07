import { describe, expect, it } from 'vitest'
import { resolveNodeToolbarPosition } from './nodeToolbarPosition'

const boundary = { left: 180, top: 80, width: 780, height: 600 }
const toolbar = { width: 600, height: 42 }

describe('节点工具栏边缘避让', () => {
  it.each([190, 800])('节点靠近左右边缘时保留完整工具栏：%s', (left) => {
    const result = resolveNodeToolbarPosition({ left, top: 300, width: 160, height: 100 }, toolbar, boundary)
    expect(result.left).toBeGreaterThanOrEqual(192)
    expect(result.left + toolbar.width).toBeLessThanOrEqual(948)
    expect(result.top).toBe(233)
  })
  it('顶部放不下时翻到下方，底部仍优先上方', () => {
    expect(resolveNodeToolbarPosition({ left: 400, top: 90, width: 160, height: 100 }, toolbar, boundary)).toMatchObject({ top: 215, side: 'below' })
    expect(resolveNodeToolbarPosition({ left: 400, top: 630, width: 160, height: 100 }, toolbar, boundary)).toMatchObject({ top: 563, side: 'above' })
  })
  it('巨大节点占满视口时仍保留工具栏高度', () => {
    const result = resolveNodeToolbarPosition({ left: -500, top: -300, width: 1800, height: 2000 }, toolbar, boundary)
    expect(result.top).toBe(92)
    expect(result.left).toBe(192)
  })
  it('有空间时按节点中心对齐', () => {
    expect(resolveNodeToolbarPosition({ left: 470, top: 300, width: 160, height: 100 }, toolbar, boundary).left).toBe(250)
  })
  it('换回上方留缓冲，菜单打开时不翻转', () => {
    const anchor = { left: 400, top: 164, width: 160, height: 100 }
    expect(resolveNodeToolbarPosition(anchor, toolbar, boundary, 'below').side).toBe('below')
    expect(resolveNodeToolbarPosition({ ...anchor, top: 180 }, toolbar, boundary, 'below').side).toBe('above')
    expect(resolveNodeToolbarPosition({ ...anchor, top: 300 }, toolbar, boundary, 'below', true).side).toBe('below')
  })
})
