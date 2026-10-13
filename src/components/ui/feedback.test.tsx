// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiButton, UiIconButton, UiInput, UiOptionButton, UiChipButton, UiSelect, UiTextArea, UiRangeInput, UiFieldTrigger } from './primitives'
import { UiFormRow } from './layout'
import { UiSegmented } from './UiSegmented'
import * as states from './states'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('状态与反馈契约', () => {
  it('保留调用方显式的未禁用声明，忙碌期间覆盖为禁用，恢复后仍保留', () => {
    const view = render(<UiButton aria-disabled={false}>复制片段</UiButton>)
    const button = screen.getByRole('button', { name: '复制片段' })
    expect(button.getAttribute('aria-disabled')).toBe('false')
    view.rerender(<UiButton aria-disabled={false} loading>复制片段</UiButton>)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    view.rerender(<UiButton aria-disabled={false}>复制片段</UiButton>)
    expect(button.getAttribute('aria-disabled')).toBe('false')
  })

  it('加载保留原内容占位与名称，阻止重复提交，恢复后可操作', () => {
    const click = vi.fn(), ref = createRef<HTMLButtonElement>()
    const view = render(<UiButton ref={ref} loading onClick={click}>导出文件</UiButton>)
    const button = screen.getByRole('button', { name: '导出文件' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('[data-ui-loading-content]')?.textContent).toBe('导出文件')
    expect(button.querySelector('[data-ui-spinner]')).not.toBeNull()
    expect(ref.current).toBe(button)
    fireEvent.click(button); expect(click).not.toHaveBeenCalled()
    view.rerender(<UiButton ref={ref} onClick={click}>导出文件</UiButton>)
    fireEvent.click(button); expect(click).toHaveBeenCalledTimes(1)
  })

  it.each([UiButton, UiIconButton, UiOptionButton, UiChipButton])('禁用原因可聚焦、可读回，鼠标和键盘都不能触发动作', Component => {
    const click = vi.fn(), key = vi.fn(), pointer = vi.fn()
    render(<Component disabled disabledReason="先选择素材" tooltip="开始处理" aria-label="处理" onClick={click} onKeyDown={key} onPointerDown={pointer}>处理</Component>)
    const button = screen.getByRole('button', { name: '处理' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip').textContent).toBe('先选择素材')
    expect(button.getAttribute('aria-describedby')).toContain(screen.getByRole('tooltip').id)
    fireEvent.pointerDown(button); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button)
    expect(click).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(pointer).not.toHaveBeenCalled()
  })

  it('tooltip 不增加布局包装，保留 ref 和原事件，悬停延迟统一', () => {
    vi.useFakeTimers()
    const ref = createRef<HTMLButtonElement>(), enter = vi.fn()
    const view = render(<div data-testid="toolbar"><UiIconButton ref={ref} tooltip="添加素材" onMouseEnter={enter}>+</UiIconButton></div>)
    const button = screen.getByRole('button', { name: '添加素材' })
    expect(button.parentElement).toBe(screen.getByTestId('toolbar'))
    expect(button.hasAttribute('title')).toBe(false)
    expect(ref.current).toBe(button)
    fireEvent.mouseEnter(button); expect(enter).toHaveBeenCalledOnce()
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(299))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip').textContent).toBe('添加素材')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('字段错误保留自定义名称和已有描述，错误清除后关联恢复', () => {
    const view = render(<UiFormRow label="名称" hint="最多二十字" error="名称已存在"><UiInput aria-label="项目名称" aria-describedby="external" /></UiFormRow>)
    const input = screen.getByRole('textbox', { name: '项目名称' })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(expect.arrayContaining(['external', screen.getByRole('alert').id]))
    view.rerender(<UiFormRow label="名称" hint="最多二十字"><UiInput aria-label="项目名称" aria-describedby="external" /></UiFormRow>)
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('长文案分段回退下拉', () => {
    const preview = vi.fn(), change = vi.fn()
    render(<UiSegmented ariaLabel="展示" options={[{ value: 'a', label: '原始 JSON' }, { value: 'b', label: '摘要' }, { value: 'c', label: '不可选', disabled: true, title: '先选择内容' }]} value="a" onChange={change} onPreview={preview} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展示' }))
    fireEvent.mouseEnter(screen.getByRole('option', { name: '摘要' }))
    expect(preview).toHaveBeenLastCalledWith('b')
    fireEvent.click(screen.getByRole('option', { name: '不可选' }))
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: '摘要' }))
    expect(change).toHaveBeenCalledWith('b')
    expect(preview).toHaveBeenLastCalledWith(undefined)
  })

  it('描述与错误关系覆盖文本、选择、滑杆和复合字段触发器', () => {
    render(<UiFormRow label="参数" error="参数无效"><UiInput /><UiTextArea /><UiSelect><option>选项</option></UiSelect><UiRangeInput /><UiFieldTrigger>选择</UiFieldTrigger></UiFormRow>)
    for (const control of document.querySelectorAll('input,textarea,select,button')) {
      expect(control.getAttribute('aria-invalid')).toBe('true')
      expect(control.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id)
    }
  })

  it('提供统一行内加载、骨架与带语义的反馈', () => {
    const view = render(<><states.UiSpinner /><states.UiSkeleton /><states.UiFieldMessage>名称不能为空</states.UiFieldMessage><states.UiInlineStatus tone="success">保存完成</states.UiInlineStatus></>)
    expect(view.container.querySelector('[data-ui-spinner]')?.getAttribute('class')).toContain('motion-safe:animate-spin')
    expect(view.container.querySelector('[data-ui-skeleton]')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('名称不能为空')
    expect(screen.getByRole('status').textContent).toBe('保存完成')
  })
})
