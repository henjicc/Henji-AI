// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiSegmented } from './UiSegmented'

afterEach(cleanup)
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
  expect(first.title).toBe('摆放提示')
  expect(first.className).toContain('bg-raised')
  expect(first.className).toContain('text-text1')
  expect(first.className).not.toContain('bg-accent')
  fireEvent.mouseEnter(last); expect(preview).toHaveBeenLastCalledWith('c')
  fireEvent.mouseLeave(last); expect(preview).toHaveBeenLastCalledWith(undefined)
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(last); expect(last.getAttribute('aria-checked')).toBe('true'); expect(first.tabIndex).toBe(-1)
  fireEvent.keyDown(last, { key: 'ArrowRight' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(last)
  view.rerender(<Example disabled />)
  for (const radio of screen.getAllByRole('radio')) { expect((radio as HTMLButtonElement).disabled).toBe(true); expect(radio.tabIndex).toBe(-1) }
  view.rerender(<UiSegmented ariaLabel="超过五项" value="1" onChange={() => undefined} options={Array.from({ length: 6 }, (_, i) => ({ value: String(i), label: String(i) }))} />)
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(screen.getByRole('button', { name: '超过五项' }).textContent).toBe('1')
})
