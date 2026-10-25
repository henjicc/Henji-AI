// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiSegmented } from './UiSegmented'

afterEach(cleanup)
it('短数字加中文单位保持分段，并向禁用项传递原因', () => {
  render(<UiSegmented ariaLabel="位深" value={24} onChange={() => {}} options={[{ value: 24, label: '24 位' }, { value: 32, label: '32 位浮点', disabled: true, disabledReason: '设备不支持' }]} />)
  const option = screen.getByRole('radio', { name: '32 位浮点' })
  expect(option.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(option)
  expect(screen.getByRole('tooltip').textContent).toBe('设备不支持')
})
it('英文十二字符以内保持分段，中文超过四字或英文超过十二字符回落下拉', () => {
  const props = { ariaLabel: '语言', value: 'a', onChange: () => undefined }
  const view = render(<UiSegmented {...props} options={[{ value: 'a', label: 'abcdefghijkl' }]} />)
  expect(screen.getByRole('radio', { name: 'abcdefghijkl' })).toBeDefined()
  view.rerender(<UiSegmented {...props} options={[{ value: 'a', label: 'abcdefghijklm' }]} />)
  expect(screen.queryByRole('radiogroup')).toBeNull()
  view.rerender(<UiSegmented {...props} options={[{ value: 'a', label: '浏览或移出时' }]} />)
  expect(screen.queryByRole('radiogroup')).toBeNull()
})

it('选项实际放不下时改用同一组选项的下拉，宽度够了换回分段，卸载清理观察器', () => {
  let available = 40
  let notify: ResizeObserverCallback | undefined
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback }
    observe(): void {}
    disconnect = disconnect
    unobserve(): void {}
  })
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'radio' ? 60 : 0
  })
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'radio') return available >= 200 ? 60 : 20
    return this.hasAttribute('data-ui-segmented-fit') ? available : 0
  })
  try {
    const props = { ariaLabel: '体型', value: 'a', onChange: () => undefined, options: [{ value: 'a', label: '标准' }, { value: 'b', label: '健壮' }] }
    const view = render(<UiSegmented {...props} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('button', { name: '体型' })).toBeDefined()
    // 两段各需 60，加上段间距与内边距约 126：给到 200 后换回分段
    available = 200
    act(() => notify?.([], {} as ResizeObserver))
    expect(screen.getByRole('radiogroup', { name: '体型' })).toBeDefined()
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  } finally { scroll.mockRestore(); client.mockRestore(); vi.unstubAllGlobals() }
})
it('父级宽度跟着内容走、下拉自己比分段还宽时停在下拉，不在两者间来回切', () => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'radio' ? 60 : 0
  })
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'radio') return 20
    if (!this.hasAttribute('data-ui-segmented-fit')) return 0
    return this.querySelector('[role="radiogroup"]') ? 40 : 300
  })
  try {
    render(<UiSegmented ariaLabel="文字稿显示" value="a" onChange={() => undefined} options={[{ value: 'a', label: '原稿' }, { value: 'b', label: '校对后' }]} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('button', { name: '文字稿显示' })).toBeDefined()
  } finally { scroll.mockRestore(); client.mockRestore(); vi.unstubAllGlobals() }
})
it('分段单选方向键跳过禁用项并循环，选择与焦点同步，整体禁用后不可操作', () => {
  const preview = vi.fn()
  function Example({ disabled = false }: { disabled?: boolean }): JSX.Element {
    const [value, setValue] = useState('a')
    return <UiSegmented ariaLabel="方式" options={[{ value: 'a', label: '摆放', title: '摆放提示' }, { value: 'b', label: '禁用', disabled: true }, { value: 'c', label: '录制', ariaLabel: '录制轨迹' }]} value={value} onChange={setValue} disabled={disabled} onPreview={preview} />
  }
  const view = render(<Example />)
  expect(screen.getByRole('radiogroup', { name: '方式' })).toBeDefined()
  const first = screen.getByRole('radio', { name: '摆放' }), last = screen.getByRole('radio', { name: '录制轨迹' })
  expect(first.className).not.toContain('bg-accent')
  fireEvent.focus(first); expect(screen.getByRole('tooltip').textContent).toBe('摆放提示')
  expect(first.className).toContain('bg-segment-selected')
  expect(first.className).toContain('text-text1')
  expect(first.className).not.toContain('bg-accent')
  fireEvent.mouseEnter(last); expect(preview).toHaveBeenLastCalledWith('c')
  fireEvent.mouseLeave(last); expect(preview).toHaveBeenLastCalledWith(undefined)
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(last); expect(last.getAttribute('aria-checked')).toBe('true'); expect(first.tabIndex).toBe(-1)
  fireEvent.keyDown(last, { key: 'ArrowRight' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(last)
  view.rerender(<Example disabled />)
  for (const radio of screen.getAllByRole('radio')) { expect(radio.getAttribute('aria-disabled')).toBe('true'); expect(radio.tabIndex).toBe(-1) }
  view.rerender(<UiSegmented ariaLabel="超过五项" value="1" onChange={() => undefined} options={Array.from({ length: 6 }, (_, i) => ({ value: String(i), label: String(i) }))} />)
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(screen.getByRole('button', { name: '超过五项' }).textContent).toBe('1')
})
