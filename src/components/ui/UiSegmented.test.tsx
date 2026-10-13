// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiSegmented } from './UiSegmented'

afterEach(cleanup)
it('英文十二字符以内保持分段，中文超过四字或英文超过十二字符回落下拉', () => {
  const props = { ariaLabel: '语言', value: 'a', onChange: () => undefined }
  const view = render(<UiSegmented {...props} options={[{ value: 'a', label: 'abcdefghijkl' }]} />)
  expect(screen.getByRole('radio', { name: 'abcdefghijkl' })).toBeDefined()
  view.rerender(<UiSegmented {...props} options={[{ value: 'a', label: 'abcdefghijklm' }]} />)
  expect(screen.queryByRole('radiogroup')).toBeNull()
  view.rerender(<UiSegmented {...props} options={[{ value: 'a', label: '浏览或移出时' }]} />)
  expect(screen.queryByRole('radiogroup')).toBeNull()
})

it('开发态测到选项实际溢出时告警，卸载清理观察器', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: HTMLElement): void {
      Object.defineProperties(element, { scrollWidth: { value: 120, configurable: true }, clientWidth: { value: 40, configurable: true } })
      this.callback([], this as unknown as ResizeObserver)
    }
    disconnect = disconnect
    unobserve(): void {}
  })
  try {
    const view = render(<UiSegmented ariaLabel="方式" options={[{ value: 'a', label: '方式' }]} value="a" onChange={() => undefined} />)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('UiSegmented'), expect.objectContaining({ ariaLabel: '方式' }))
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  } finally { warn.mockRestore(); vi.unstubAllGlobals() }
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
