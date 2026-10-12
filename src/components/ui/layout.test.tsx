/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { UiFormRow, UiGroup, UiToolbar, UiTooltipText } from './layout'

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

describe('工具页命令带骨架', () => {
  it('命令带与从属参数带是同一块表面：一个 data-command-stack、一条 data-command-bar', () => {
    const rendered = render(
      <UiToolbar
        variant="command"
        barProps={{ 'data-document-revision': 3 }}
        center={<span>参数</span>}
        trailing={<span>导出</span>}
        subordinate={<span>查找</span>}
      >
        <span>返回</span>
      </UiToolbar>,
    )
    const stacks = rendered.container.querySelectorAll('[data-command-stack]')
    expect(stacks).toHaveLength(1)
    const bar = stacks[0].querySelector('[data-command-bar]')
    expect(bar?.getAttribute('data-document-revision')).toBe('3')
    expect(bar?.querySelector('[data-command-bar-leading]')?.textContent).toBe('返回')
    expect(bar?.querySelector('[data-command-bar-center]')?.textContent).toBe('参数')
    expect(bar?.querySelector('[data-command-bar-trailing]')?.textContent).toBe('导出')
    const subordinate = stacks[0].querySelector('[data-command-subordinate]')
    expect(subordinate?.textContent).toBe('查找')
    expect(subordinate?.closest('[data-command-bar]')).toBeNull()
  })

  it('默认 plain 不画命令带', () => {
    const rendered = render(<UiToolbar trailing={<span>右</span>}><span>左</span></UiToolbar>)
    expect(rendered.container.querySelector('[data-command-stack]')).toBeNull()
  })
})

describe('UiFormRow 标签关联到行内控件（任务 5.8，B-50）', () => {
  it('面板统一继承列档位、嵌套分组不丢失；网格显式 auto 保留上方标签，字段填满控件列', async () => {
    const { default: Dropdown } = await import('./Dropdown')
    const { default: NumberInput } = await import('./NumberInput')
    const { UiSegmented } = await import('./UiSegmented')
    const { UiFieldLayoutContext } = await import('./fieldLayout')
    render(<UiGroup labelWidth={96}>
      <UiGroup><UiFormRow label="路径组合方式" density="compact"><Dropdown ariaLabel="组合方式" value="add" options={[{ value: 'add', label: '合并' }]} /></UiFormRow></UiGroup>
      <UiFormRow label="锚点横向"><NumberInput ariaLabel="锚点横向" value={10} onChange={() => undefined} /></UiFormRow>
      <UiFormRow label="通道"><UiSegmented ariaLabel="通道" value="r" options={[{ value: 'r', label: '红' }, { value: 'g', label: '绿' }]} onChange={() => undefined} /></UiFormRow>
      <UiFormRow label="网格横向" labelColumn="auto"><span>网格控件</span></UiFormRow>
      <UiFieldLayoutContext.Provider value="toolbar"><UiFormRow label="工具条" inline><span>工具条控件</span></UiFormRow></UiFieldLayoutContext.Provider>
    </UiGroup>)
    const rows = document.querySelectorAll('[data-ui-form-row="panel"]')
    expect(rows).toHaveLength(3)
    expect([...rows].map(row => row.getAttribute('data-label-width'))).toEqual(['96', '96', '96'])
    expect(rows[0].firstElementChild?.className).not.toContain('justify-end')
    const dropdown = screen.getByRole('button', { name: '组合方式' })
    expect(dropdown.parentElement?.style.width).toBe('100%')
    expect(dropdown.className).toContain('w-full')
    expect(screen.getByRole('spinbutton', { name: '锚点横向' }).closest('[data-ui-field-control]')?.className).toContain('w-full')
    expect(screen.getByRole('radiogroup', { name: '通道' }).className).toContain('w-full')
    expect(screen.getByText('网格横向').closest('[data-ui-form-row="panel"]')).toBeNull()
    expect(screen.getByText('工具条').closest('[data-ui-form-row="panel"]')).toBeNull()
  })

  it('开关、输入框与下拉没有自己的名称时，读作行标签；下拉读作“标签 + 当前值”', async () => {
    const { UiInput, UiSwitch } = await import('./primitives')
    const { default: Dropdown } = await import('./Dropdown')
    render(
      <>
        <UiFormRow label="允许外部智能体连接" hint="关闭后外部客户端无法连接" inline>
          <UiSwitch checked={false} onCheckedChange={() => undefined} />
        </UiFormRow>
        <UiFormRow label="保存目录">
          <UiInput value="D:/out" readOnly />
        </UiFormRow>
        <UiFormRow label="语言">
          <Dropdown value="zh" options={[{ value: 'zh', label: '中文' }]} onSelect={() => undefined} />
        </UiFormRow>
      </>,
    )
    const toggle = screen.getByRole('switch', { name: '允许外部智能体连接' })
    expect(toggle.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent).toBe('关闭后外部客户端无法连接')
    expect(screen.getByRole('textbox', { name: '保存目录' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '语言 中文' })).toBeTruthy()
  })

  it('控件自己带名称时以自己的为准；行外的控件不受影响', async () => {
    const { UiSwitch } = await import('./primitives')
    render(
      <>
        <UiFormRow label="行标签" inline>
          <UiSwitch aria-label="自定义名称" checked onCheckedChange={() => undefined} />
        </UiFormRow>
        <UiSwitch checked onCheckedChange={() => undefined} />
      </>,
    )
    expect(screen.getByRole('switch', { name: '自定义名称' })).toBeTruthy()
    const switches = screen.getAllByRole('switch')
    expect(switches[1].getAttribute('aria-labelledby')).toBeNull()
  })
})
