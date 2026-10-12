// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { UiSegmented } from './UiSegmented'

afterEach(cleanup)
it('分段单选方向键跳过禁用项并循环，选择与焦点同步，整体禁用后不可操作', () => {
  function Example({ disabled = false }: { disabled?: boolean }): JSX.Element {
    const [value, setValue] = useState('a')
    return <UiSegmented ariaLabel="方式" options={[{ value: 'a', label: '摆放' }, { value: 'b', label: '禁用', disabled: true }, { value: 'c', label: '录制' }]} value={value} onChange={setValue} disabled={disabled} />
  }
  const view = render(<Example />)
  expect(screen.getByRole('radiogroup', { name: '方式' })).toBeDefined()
  const first = screen.getByRole('radio', { name: '摆放' }), last = screen.getByRole('radio', { name: '录制' })
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(last); expect(last.getAttribute('aria-checked')).toBe('true'); expect(first.tabIndex).toBe(-1)
  fireEvent.keyDown(last, { key: 'ArrowRight' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(last)
  view.rerender(<Example disabled />)
  for (const radio of screen.getAllByRole('radio')) { expect((radio as HTMLButtonElement).disabled).toBe(true); expect(radio.tabIndex).toBe(-1) }
})
