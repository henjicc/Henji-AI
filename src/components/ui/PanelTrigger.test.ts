/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PanelTrigger from './PanelTrigger'
import {
  isPanelInteractionPortalTarget,
  shouldClosePanelAfterInternalClick,
} from './panelTriggerClosePolicy'

const TARGET = {} as Node

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PanelTrigger 面板内部点击关闭策略', () => {
  it('未配置时保持交互型面板打开', () => {
    expect(shouldClosePanelAfterInternalClick(undefined, TARGET)).toBe(false)
  })

  it('支持显式关闭与显式保持打开', () => {
    expect(shouldClosePanelAfterInternalClick(true, TARGET)).toBe(true)
    expect(shouldClosePanelAfterInternalClick(false, TARGET)).toBe(false)
  })

  it('把点击目标交给自定义策略判断', () => {
    const policy = vi.fn(() => true)

    expect(shouldClosePanelAfterInternalClick(policy, TARGET)).toBe(true)
    expect(policy).toHaveBeenCalledWith(TARGET)
  })

  it('下拉和提示词候选 portal 仍归属于当前面板', () => {
    const dropdown = document.createElement('div')
    dropdown.dataset.dropdownPortal = 'true'
    const suggestion = document.createElement('div')
    suggestion.dataset.promptSuggestionPortal = 'true'

    expect(isPanelInteractionPortalTarget(dropdown)).toBe(true)
    expect(isPanelInteractionPortalTarget(suggestion)).toBe(true)
    expect(isPanelInteractionPortalTarget(document.createElement('div'))).toBe(false)
  })

  it('可用高度不足时由共享内容区滚动，不让长面板溢出外壳', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })

    const view = render(React.createElement(PanelTrigger, {
      display: '比例 / 分辨率',
      panelWidth: 360,
      alignment: 'aboveCenter',
      renderPanel: () => React.createElement('div', { style: { height: '900px' } }),
    }))
    const trigger = view.getByRole('button')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 620,
      height: 40,
      left: 320,
      right: 440,
      top: 580,
      width: 120,
      x: 320,
      y: 580,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    const scrollRegion = document.querySelector('[data-panel-scroll-region]')
    expect(scrollRegion).not.toBeNull()
    expect(scrollRegion?.classList.contains('min-h-0')).toBe(true)
    expect(scrollRegion?.classList.contains('overflow-y-auto')).toBe(true)
    expect(scrollRegion?.classList.contains('overscroll-contain')).toBe(true)
  })

  it('首选的上方空间不足时自动向下展开', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })

    const view = render(React.createElement(PanelTrigger, {
      display: '模型',
      panelWidth: 320,
      panelHeight: 260,
      alignment: 'aboveCenter',
      gap: 8,
      renderPanel: () => React.createElement('div', null, '模型列表'),
    }))
    const trigger = view.getByRole('button')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 140,
      height: 40,
      left: 320,
      right: 440,
      top: 100,
      width: 120,
      x: 320,
      y: 100,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    expect(document.querySelector('[data-panel-placement="below"]')).not.toBeNull()
  })

  it('内容宽度模式按最长选项收敛面板', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-panel-scroll-region') ? 112 : 0
    })

    const view = render(React.createElement(PanelTrigger, {
      display: '添加',
      panelWidth: 'content',
      renderPanel: () => React.createElement('div', null, '柔光 / 发光'),
    }))
    const trigger = view.getByRole('button')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 80,
      height: 28,
      left: 800,
      right: 828,
      top: 52,
      width: 28,
      x: 800,
      y: 52,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    const panel = document.querySelector<HTMLElement>('[data-panel-placement]')
    expect(panel?.style.width).toBe('112px')
  })
})
