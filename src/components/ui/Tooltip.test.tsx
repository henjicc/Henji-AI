/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UiIconButton } from './primitives'
import Tooltip from './Tooltip'
import { resolveTooltipPosition } from './tooltipPosition'

describe('Tooltip', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('工具栏模式让提示框左上角跟随指针，不再向左居中溢出', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="较长的工具名称" delay={180} anchor="pointer-start">
        <UiIconButton aria-label="工具" />
      </Tooltip>,
    )
    const button = screen.getByRole('button', { name: '工具' })
    fireEvent.mouseEnter(button, { clientX: 24, clientY: 120 })
    act(() => vi.advanceTimersByTime(180))
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip.getAttribute('style')).toContain('top: 128px')
    expect(tooltip.getAttribute('style')).toContain('left: 32px')
    expect(tooltip.className).not.toContain('-translate-x-1/2')
  })
})

describe('Tooltip placement（任务 5.4：画布节点参数行的名称提示不盖住上一行）', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const rect = (left: number, width = 40) => ({ top: 100, left, right: left + width, width, height: 20 })

  it('left：左侧放得下就贴在触发元素左侧、垂直居中', () => {
    expect(resolveTooltipPosition({ rect: rect(400), placement: 'left', tooltipWidth: 200, viewportWidth: 1440 }))
      .toEqual({ placement: 'left', top: 110, left: 392 })
  })

  it('left：贴着屏幕左缘放不下时退到右侧，仍不盖住上一行', () => {
    expect(resolveTooltipPosition({ rect: rect(60), placement: 'left', tooltipWidth: 200, viewportWidth: 1440 }))
      .toEqual({ placement: 'right', top: 110, left: 108 })
  })

  it('left：左右都放不下才退到上方；默认 top 行为不变', () => {
    expect(resolveTooltipPosition({ rect: rect(60, 100), placement: 'left', tooltipWidth: 300, viewportWidth: 420 }))
      .toEqual({ placement: 'top', top: 92, left: 110 })
    expect(resolveTooltipPosition({ rect: rect(400), placement: 'top', tooltipWidth: 200, viewportWidth: 1440 }))
      .toEqual({ placement: 'top', top: 92, left: 420 })
  })

  it('组件：placement="left" 的提示框按左侧放置的位移类渲染', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="参数说明" delay={200} placement="left">
        <span>版本</span>
      </Tooltip>,
    )
    const trigger = screen.getByText('版本').parentElement as HTMLElement
    trigger.getBoundingClientRect = () => ({ ...rect(400), bottom: 120, x: 400, y: 100, toJSON: () => ({}) }) as DOMRect
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(200))
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip.getAttribute('data-tooltip-placement')).toBe('left')
    expect(tooltip.className).toContain('-translate-x-full')
    expect(tooltip.getAttribute('style')).toContain('left: 392px')
  })
})
