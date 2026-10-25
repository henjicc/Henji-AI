/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { UiSpecialPanel } from './UiSpecialPanel'
import { resolveSpecialPanelColumns, specialPanelGridWidth } from './specialPanelLayout'
import { groupAspectRatioOptions, type AspectRatioTileOption } from '@/components/params/panels/ResolutionPanel/aspectRatioGrouping'

const ratio = (value: string): AspectRatioTileOption => {
  const [width, height] = value.split(':').map(Number)
  return { value, label: value, ratio: { width, height } }
}

describe('特殊面板外壳', () => {
  it('网格列数按 760 上限与窗口宽度算，不超过声明的最多列数', () => {
    const grid = { cellWidth: 190, gap: 6, chrome: 144 + 1 + 24 + 2, maxColumns: 3 }
    expect(resolveSpecialPanelColumns(1440, grid)).toBe(3)
    // 960 宽窗口：上限仍是 760，三列放得下
    expect(resolveSpecialPanelColumns(960, grid)).toBe(3)
    // 窗口只有 600：可用 568 - 外框，只放两列
    expect(resolveSpecialPanelColumns(600, grid)).toBe(2)
    expect(resolveSpecialPanelColumns(200, grid)).toBe(1)
    expect(specialPanelGridWidth(3, 190, 6)).toBe(582)
  })

  it('只有一个正文时不出头部与底部行；给了 status 或 action 才出底部操作行', () => {
    const { container, rerender } = render(<UiSpecialPanel>正文</UiSpecialPanel>)
    expect(container.querySelector('[data-special-panel-header]')).toBeNull()
    expect(container.querySelector('[data-special-panel-footer]')).toBeNull()
    rerender(<UiSpecialPanel header="头部" status="参考音频不足 10 秒" bodyWidth={300} bodyPadding="sm">正文</UiSpecialPanel>)
    expect(container.querySelector('[data-special-panel-header]')?.textContent).toBe('头部')
    expect(container.querySelector('[data-special-panel-footer]')?.textContent).toContain('参考音频不足 10 秒')
    expect((container.querySelector('[data-special-panel-body]') as HTMLElement).style.width).toBe('316px')
  })
})

describe('比例格分行', () => {
  it('不多于 6 个时排一行、保持声明顺序', () => {
    const options = [{ value: 'smart', label: '智能', ratio: null, smart: true }, ratio('16:9'), ratio('9:16'), ratio('1:1')]
    expect(groupAspectRatioOptions(options).map(row => row.options.map(option => option.value))).toEqual([['smart', '16:9', '9:16', '1:1']])
  })

  it('多时按形状分三行，横、竖各自从接近方形排到最极端', () => {
    const options = [
      { value: 'smart', label: '智能', ratio: null, smart: true },
      ...['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'].map(ratio),
    ]
    expect(groupAspectRatioOptions(options).map(row => [row.key, row.options.map(option => option.value)])).toEqual([
      ['lead', ['smart', '1:1']],
      ['landscape', ['5:4', '4:3', '3:2', '16:9', '21:9', '4:1', '8:1']],
      ['portrait', ['4:5', '3:4', '2:3', '9:16', '1:4', '1:8']],
    ])
  })
})
