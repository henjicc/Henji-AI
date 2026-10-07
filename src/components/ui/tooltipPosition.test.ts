import { describe, expect, it } from 'vitest'
import { resolveTooltipPosition } from './tooltipPosition'

const base = {
  rect: { top: 100, left: 400, right: 440, width: 40, height: 20 },
  placement: 'top' as const, tooltipWidth: 200, tooltipHeight: 40,
  viewportWidth: 1440, viewportHeight: 900,
}

describe('resolveTooltipPosition', () => {
  it('默认上方按真实宽高居中，直接返回左上角', () => {
    expect(resolveTooltipPosition(base)).toMatchObject({ placement: 'top', top: 52, left: 320 })
  })
  it('靠左缘水平夹紧到 8px', () => {
    expect(resolveTooltipPosition({ ...base, rect: { ...base.rect, left: 0, right: 40 } }).left).toBe(8)
  })
  it('靠右缘水平夹紧到 8px 安全边距', () => {
    expect(resolveTooltipPosition({ ...base, rect: { ...base.rect, left: 1400, right: 1440 } }).left).toBe(1232)
  })
  it('靠上缘放不下时翻到下方', () => {
    expect(resolveTooltipPosition({ ...base, rect: { ...base.rect, top: 10 } })).toMatchObject({ placement: 'bottom', top: 38 })
  })
  it('下方放不下时翻到上方', () => {
    expect(resolveTooltipPosition({ ...base, placement: 'bottom', rect: { ...base.rect, top: 870 } })).toMatchObject({ placement: 'top', top: 822 })
  })
  it('左侧首选不盖住相邻行，靠左时翻到右侧', () => {
    expect(resolveTooltipPosition({ ...base, placement: 'left' })).toMatchObject({ placement: 'left', top: 90, left: 192 })
    expect(resolveTooltipPosition({ ...base, placement: 'left', rect: { ...base.rect, left: 60, right: 100 } })).toMatchObject({ placement: 'right', top: 90, left: 108 })
  })
  it('右侧首选靠右时翻到左侧，并夹紧垂直位置', () => {
    expect(resolveTooltipPosition({ ...base, placement: 'right', rect: { ...base.rect, top: 2, left: 1400, right: 1440 } })).toMatchObject({ placement: 'left', top: 8, left: 1192 })
    expect(resolveTooltipPosition({ ...base, placement: 'left', rect: { ...base.rect, top: 880 } }).top).toBe(852)
  })
  it('左右都放不下才退到上方，上方也不足则翻到下方', () => {
    const options = { ...base, placement: 'left' as const, viewportWidth: 420, tooltipWidth: 300, rect: { ...base.rect, left: 60, right: 160, width: 100 } }
    expect(resolveTooltipPosition(options)).toMatchObject({ placement: 'top', top: 52, left: 8 })
    expect(resolveTooltipPosition({ ...options, rect: { ...options.rect, top: 8 } }).placement).toBe('bottom')
  })
  it('超长内容宽高限于视口，任何坐标都不越界', () => {
    expect(resolveTooltipPosition({ ...base, tooltipWidth: 2000, tooltipHeight: 3000, viewportWidth: 240, viewportHeight: 160 }))
      .toMatchObject({ left: 8, top: 8, maxWidth: 224, maxHeight: 144 })
  })
  it('跟随指针的提示在右下角翻转并夹紧', () => {
    expect(resolveTooltipPosition({ ...base, placement: 'bottom', alignment: 'start', rect: { top: 890, left: 1435, right: 1435, width: 0, height: 0 } }))
      .toMatchObject({ placement: 'top', top: 842, left: 1232 })
  })
})
