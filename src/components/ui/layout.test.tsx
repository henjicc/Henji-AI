/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { UiFormRow, UiGroup, UiTooltipText } from './layout'

afterEach(cleanup)

describe('参数名本身触发说明（不加 ⓘ 图标）', () => {
  it('UiFormRow 有 info 时标签文字可聚焦并显示说明，不再渲染“查看说明”按钮', () => {
    render(
      <UiFormRow label="并发数" info="同时生成的任务上限">
        <span>控件</span>
      </UiFormRow>,
    )
    expect(screen.queryByRole('button', { name: '查看说明' })).toBeNull()
    const label = screen.getByText('并发数')
    expect(label.getAttribute('tabindex')).toBe('0')
    fireEvent.focus(label)
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip.textContent).toBe('同时生成的任务上限')
    expect(label.getAttribute('aria-describedby')).toBe(tooltip.id)
    expect(tooltip.className).toContain('bg-raised')
    expect(tooltip.className).toContain('text-text1')
  })

  it('UiGroup 标题同样由文字本身触发；没有说明时是普通不可聚焦文字', () => {
    render(
      <>
        <UiGroup title="下载" info="下载目录说明"><span /></UiGroup>
        <UiTooltipText>普通标签</UiTooltipText>
      </>,
    )
    expect(screen.getByText('下载').getAttribute('tabindex')).toBe('0')
    expect(screen.getByText('普通标签').hasAttribute('tabindex')).toBe(false)
    expect(document.querySelector('svg')).toBeNull()
  })
})
