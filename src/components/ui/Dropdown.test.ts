/** @vitest-environment jsdom */

import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dropdown from './Dropdown'
import { DROPDOWN_MENU_MAX_WIDTH_PX, resolveDropdownDisplay, resolveDropdownMenuWidth } from './dropdownUtils'

describe('Dropdown 显示文本', () => {
  const options = [
    { label: '自定义贝塞尔', value: 'bezier' },
    { label: '直线', value: 'linear' },
  ]

  it('默认显示匹配选项的中文标签', () => {
    expect(resolveDropdownDisplay(undefined, 'bezier', options)).toBe('自定义贝塞尔')
  })

  it('显式 display 优先于选项标签，未知值回退原值', () => {
    expect(resolveDropdownDisplay('当前路径', 'bezier', options)).toBe('当前路径')
    expect(resolveDropdownDisplay(undefined, 'unknown', options)).toBe('unknown')
  })
})

describe('Dropdown 键盘交互', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('用方向键打开并用 Enter 选择当前选项，同时保留可访问状态', () => {
    const onSelect = vi.fn()
    const rendered = render(React.createElement(Dropdown, {
      ariaLabel: '柔光模式',
      value: 'black_mist',
      options: [
        { value: 'black_mist', label: '黑柔' },
        { value: 'white_mist', label: '白柔' },
      ],
      onSelect,
    }))
    const trigger = rendered.getByRole('button', { name: '柔光模式' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(rendered.getByRole('listbox', { name: '柔光模式' })).toBeTruthy()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('white_mist')
  })

  it('触发器下方空间不足时自动向上展开', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-dropdown-button')) {
        return new DOMRect(120, 760, 120, 32)
      }
      return new DOMRect(120, 0, 120, 120)
    })

    const rendered = render(React.createElement(Dropdown, {
      ariaLabel: '展开方向',
      value: 'auto',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'manual', label: '手动' },
      ],
    }))

    fireEvent.keyDown(rendered.getByRole('button', { name: '展开方向' }), { key: 'ArrowDown' })

    const panel = document.querySelector<HTMLElement>('[data-dropdown-placement="above"]')
    expect(panel).toBeTruthy()
    if (!panel) throw new Error('下拉浮层未渲染')
    expect(panel.style.top).toBe('632px')
    // 普通界面上的下拉是实底浮层（玻璃只给压在画布与媒体上的 surface="glass"）
    expect(panel.classList.contains('bg-panel')).toBe(true)
    expect(panel.classList.contains('ui-glass')).toBe(false)
  })

  it('文字外观只保留轻量文字按钮语义', () => {
    const rendered = render(React.createElement(Dropdown, {
      appearance: 'text',
      ariaLabel: '切换语言',
      value: 'zh-CN',
      options: [
        { value: 'zh-CN', label: '简体中文' },
        { value: 'en-US', label: 'English' },
      ],
    }))

    const trigger = rendered.getByRole('button', { name: '切换语言' })
    // 文字外观 = 静默档字段触发器（静息无底无框），不叠 raised 字段表面
    expect(trigger.dataset.appearance).toBe('quiet')
    expect(trigger.className).toContain('ui-btn-quiet')
    expect(trigger.className).toContain('font-normal')
    expect(trigger.className).not.toContain('bg-raised')
  })
})

describe('Dropdown 字段触发器与浮层（任务 2.2）', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('字段触发器是 raised 无边框表面，高度只由 size 决定；当前项中性选中并带勾', () => {
    const rendered = render(React.createElement(Dropdown, {
      ariaLabel: '排序',
      size: 'sm',
      value: 'recent',
      options: [
        { value: 'created', label: '最新创建' },
        { value: 'recent', label: '最近使用' },
      ],
    }))
    const trigger = rendered.getByRole('button', { name: '排序' })
    expect(trigger.dataset.size).toBe('sm')
    expect(trigger.className).toContain('h-control-sm')
    expect(trigger.className).toContain('bg-raised')
    expect(trigger.className).not.toMatch(/(^| )border( |$)/)

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const selected = rendered.getByRole('option', { name: '最近使用' })
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(selected.className).toContain('ui-glass-adaptive-selected')
    expect(selected.className).not.toMatch(/brand-600/)
    expect(selected.querySelector('svg')).toBeTruthy()
    expect(rendered.getByRole('option', { name: '最新创建' }).dataset.size).toBe('sm')
  })

  it('挂到 body 的浮层默认用 popover 层级（盖住弹窗与查看器、低于提示）', () => {
    const rendered = render(React.createElement(Dropdown, {
      ariaLabel: '层级',
      value: 'a',
      options: [{ value: 'a', label: 'A' }],
    }))
    fireEvent.keyDown(rendered.getByRole('button', { name: '层级' }), { key: 'ArrowDown' })
    const panel = document.querySelector<HTMLElement>('[data-dropdown-portal="true"]')
    expect(panel?.style.zIndex).toBe('75')
  })
})

describe('Dropdown 菜单宽度（任务 4.3）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('菜单宽度按菜单项自己的留白计算，含选中勾槽，并封顶', () => {
    // 文字 65 + 菜单项（md：左右 20 + 间距 8 + 勾 14）+ 浮层（边框 2 + p-1 8）+ 取整余量 2
    expect(resolveDropdownMenuWidth(65, 'md')).toBe(119)
    expect(resolveDropdownMenuWidth(65, 'sm')).toBe(115)
    expect(resolveDropdownMenuWidth(65, 'lg')).toBe(123)
    expect(resolveDropdownMenuWidth(1000, 'md')).toBe(DROPDOWN_MENU_MAX_WIDTH_PX)
    // 自定义面板（动作菜单）不留勾槽：65 + 20 + 10 + 2
    expect(resolveDropdownMenuWidth(65, 'md', 'none')).toBe(97)
  })

  it('静默触发器（工具条）下，选中项“参考生视频”的菜单宽度足够放下文字与勾', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 13 }),
    } as unknown as CanvasRenderingContext2D)
    const rendered = render(React.createElement(Dropdown, {
      ariaLabel: '模式',
      appearance: 'text',
      value: 'reference',
      options: [
        { value: 'text', label: '文生视频' },
        { value: 'reference', label: '参考生视频' },
      ],
      panelWidthStrategy: 'options',
      buttonClassName: 'w-auto',
      onSelect: () => {},
    }))
    const trigger = rendered.getByRole('button', { name: '模式' })
    fireEvent.click(trigger)
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
      ?.closest<HTMLElement>('[data-dropdown-portal="true"]')
    // 5 字 × 13 = 65，需要 119；修复前按触发器留白算只有 65 + 16 + 24 = 105
    expect(Number.parseFloat(panel?.style.width ?? '0')).toBeGreaterThanOrEqual(119)
  })
})
