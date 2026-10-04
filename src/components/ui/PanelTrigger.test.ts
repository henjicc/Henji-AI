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
    // 动作菜单（默认）：82 文字 + 浮层 p-1 8 + 菜单项内边距 20 + 边框 2 + 取整余量 2，不留选中勾槽（5.9：原 56 留白超过 40 上限）
    expect(panel?.style.width).toBe('114px')
  })

  it('选值菜单（menuSelection="single"）额外预留选中勾槽', () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: () => ({ width: 82 }),
    } as unknown as CanvasRenderingContext2D)
    const view = render(React.createElement(PanelTrigger, {
      display: '模式',
      menuSelection: 'single',
      panelWidthLabels: ['参考生视频'],
      renderPanel: () => React.createElement('div', null, '参考生视频'),
    }))
    fireEvent.click(view.getByRole('button'))
    const panel = document.querySelector<HTMLElement>('[data-panel-placement]')
    // 82 + 8 + 内边距 20 + 勾槽 22 + 2 + 2（4.3：原 30 未计勾槽）
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
  it('锚点模式（任务 5.9）：无内置触发器，按外部元素定位；点锚点元素不算点外，点外收起后回调 onOpenChange(false)', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
      const anchor = document.createElement('button')
      anchor.getBoundingClientRect = () => ({ left: 300, top: 100, bottom: 128, right: 328, width: 28, height: 28, x: 300, y: 100, toJSON: () => ({}) })
      document.body.append(anchor)
      const onOpenChange = vi.fn()
      const view = render(React.createElement(PanelTrigger, {
        anchor,
        open: true,
        onOpenChange,
        alignment: 'bottomRight',
        panelWidth: 200,
        renderPanel: () => React.createElement('div', null, '菜单内容'),
      }))
      expect(view.container.querySelector('button')).toBeNull()
      const panel = view.getByText('菜单内容').closest('[data-panel-placement]') as HTMLElement
      // 右缘对齐锚点：328 - 200
      expect(panel.style.left).toBe('128px')
      expect(panel.style.top).toBe('132px')
      expect(panel.hasAttribute('data-ui-overlay-id')).toBe(true)

      fireEvent.mouseDown(anchor)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onOpenChange).not.toHaveBeenCalled()

      fireEvent.mouseDown(document.body)
      expect(onOpenChange).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(view.queryByText('菜单内容')).toBeNull()
      anchor.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('受控开合：父组件关闭时播放收起动画；收起中再次打开（换锚点）会取消收起并就位', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
      const props = (open: boolean, x: number) => ({
        anchor: { left: x, top: 50, bottom: 50, width: 0 },
        open,
        panelWidth: 120,
        renderPanel: () => React.createElement('div', null, '右键菜单'),
      })
      const view = render(React.createElement(PanelTrigger, props(true, 40)))
      expect(view.getByText('右键菜单')).toBeTruthy()
      view.rerender(React.createElement(PanelTrigger, props(false, 40)))
      // 收起动画期间仍在
      expect(view.queryByText('右键菜单')).not.toBeNull()
      view.rerender(React.createElement(PanelTrigger, props(true, 90)))
      act(() => { vi.advanceTimersByTime(1000) })
      const panel = view.getByText('右键菜单').closest('[data-panel-placement]') as HTMLElement
      expect(panel.style.left).toBe('90px')
      view.rerender(React.createElement(PanelTrigger, props(false, 90)))
      act(() => { vi.advanceTimersByTime(1000) })
      expect(view.queryByText('右键菜单')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('内容宽度：panelWidth="content" 时面板不写死宽度，按视口限制最大宽度', () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    const view = render(React.createElement(PanelTrigger, {
      anchor: { left: 40, top: 50, bottom: 50, width: 0 },
      open: true,
      panelWidth: 'content',
      renderPanel: () => React.createElement('div', null, '内容宽度'),
    }))
    const panel = view.getByText('内容宽度').closest('[data-panel-placement]') as HTMLElement
    expect(panel.style.width).toBe('')
    expect(panel.className).toContain('w-max')
    expect(panel.style.maxWidth).toBe(`${window.innerWidth - 16}px`)
  })
})
