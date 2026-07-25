/** @vitest-environment jsdom */

import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dropdown from './Dropdown'
import { resolveDropdownDisplay } from './dropdownUtils'

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
})
