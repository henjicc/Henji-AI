/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PanelTrigger from './PanelTrigger'
import { shouldClosePanelAfterInternalClick } from './panelTriggerClosePolicy'
import Dropdown from './Dropdown'
import { UiModal } from './UiModal'

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

  it('打开前按最长选项预计算菜单宽度并保留左右留白', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: () => ({ width: 82 }),
    } as unknown as CanvasRenderingContext2D)

    const view = render(React.createElement(PanelTrigger, {
      display: '添加',
      panelWidthLabels: ['栅格图层', '模糊', '柔光 / 发光', '辉光 Pro'],
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
    // 82 文字 + 浮层 p-1 8 + 菜单项留白含选中勾槽 42 + 边框 2 + 取整余量 2（4.3：原 30 未计勾槽）
    expect(panel?.style.width).toBe('136px')
  })
  it('收起动画期间再次点触发器会重新打开，收起计时器不会把它关掉', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
      const view = render(React.createElement(PanelTrigger, {
        display: '新建',
        closeOnPanelClick: true,
        renderPanel: () => React.createElement('button', { type: 'button' }, '新建矩形'),
      }))
      const trigger = view.getAllByRole('button')[0]
      fireEvent.click(trigger)
      // 面板内选项：mousedown 触发收起（动画进行中）
      fireEvent.mouseDown(view.getByText('新建矩形'))
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      // 动画结束前再次点触发器
      fireEvent.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(view.queryByText('新建矩形')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('嵌套浮层：子浮层内点击不关闭父浮层，外部点击全部关闭，Escape 只关最上层', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
      const view = render(React.createElement(PanelTrigger, {
        display: '更多参数',
        renderPanel: () => React.createElement(PanelTrigger, {
          display: '比例',
          renderPanel: () => React.createElement('button', { type: 'button' }, '16:9'),
        }),
      }))
      const outerTrigger = view.getAllByRole('button')[0]
      fireEvent.click(outerTrigger)
      const innerTrigger = view.getByText('比例').closest('button') as HTMLButtonElement
      fireEvent.click(innerTrigger)
      expect(view.queryByText('16:9')).not.toBeNull()

      // 子浮层 portal 到 body，不在父面板 DOM 内，仍算父面板内部
      fireEvent.mouseDown(view.getByText('16:9'))
      act(() => { vi.advanceTimersByTime(1000) })
      expect(outerTrigger.getAttribute('aria-expanded')).toBe('true')
      expect(view.queryByText('16:9')).not.toBeNull()

      // Escape 只关最上层（子浮层）
      fireEvent.keyDown(document, { key: 'Escape' })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(view.queryByText('16:9')).toBeNull()
      expect(outerTrigger.getAttribute('aria-expanded')).toBe('true')

      // 重新打开子浮层后在所有浮层外点击：两层都关
      fireEvent.click(view.getByText('比例').closest('button') as HTMLButtonElement)
      fireEvent.mouseDown(document.body)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(outerTrigger.getAttribute('aria-expanded')).toBe('false')
      expect(view.queryByText('16:9')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('面板里的下拉菜单选项点击不关闭父面板', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
      const onSelect = vi.fn()
      const view = render(React.createElement(PanelTrigger, {
        display: '更多参数',
        renderPanel: () => React.createElement(Dropdown<string>, {
          value: 'a',
          options: [{ value: 'a', label: '文生视频' }, { value: 'b', label: '参考生视频' }],
          onSelect,
        }),
      }))
      const outerTrigger = view.getAllByRole('button')[0]
      fireEvent.click(outerTrigger)
      fireEvent.click(view.getByRole('button', { name: '文生视频' }))
      const option = view.getByRole('option', { name: '参考生视频' })
      fireEvent.mouseDown(option)
      fireEvent.click(option)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onSelect).toHaveBeenCalledWith('b')
      expect(outerTrigger.getAttribute('aria-expanded')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('从面板里打开的弹窗是模态层：弹窗内点击与 Escape 都不关闭面板', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
      const PanelWithDialog = (): React.ReactElement => {
        const [dialogOpen, setDialogOpen] = React.useState(false)
        return React.createElement(React.Fragment, null,
          React.createElement('button', { type: 'button', onClick: () => setDialogOpen(true) }, '打开遮罩编辑'),
          React.createElement(UiModal, {
            isOpen: dialogOpen,
            title: '遮罩编辑',
            onClose: () => setDialogOpen(false),
            children: React.createElement('button', { type: 'button' }, '画笔'),
          }))
      }
      const view = render(React.createElement(PanelTrigger, {
        display: '更多参数',
        renderPanel: () => React.createElement(PanelWithDialog),
      }))
      const outerTrigger = view.getAllByRole('button')[0]
      fireEvent.click(outerTrigger)
      fireEvent.click(view.getByText('打开遮罩编辑'))
      act(() => { vi.advanceTimersByTime(1000) })
      fireEvent.mouseDown(view.getByText('画笔'))
      fireEvent.keyDown(document, { key: 'Escape' })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(outerTrigger.getAttribute('aria-expanded')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })
})
