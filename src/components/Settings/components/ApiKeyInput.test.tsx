/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import ApiKeyInput from './ApiKeyInput'
import i18n from '@/i18n/config'

afterEach(cleanup)

function StatefulInput({ disabled = false }: { disabled?: boolean }): JSX.Element {
  const [value, setValue] = useState('secret-value')
  const [visible, setVisible] = useState(false)
  return (
    <ApiKeyInput
      label="API 密钥"
      value={value}
      visible={visible}
      onChange={setValue}
      onToggleVisibility={() => setVisible(current => !current)}
      placeholder="请输入 API Key"
      showLabel="显示密钥"
      hideLabel="隐藏密钥"
      hint="仅保存在本机"
      error={disabled ? '密钥不可用' : undefined}
      disabled={disabled}
    />
  )
}

describe('ApiKeyInput', () => {
  it('把眼睛动作嵌入同一个输入容器，并保持 label 与键盘语义', () => {
    render(<StatefulInput />)
    const input = screen.getByLabelText('API 密钥') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: '显示密钥' })

    expect(input.type).toBe('password')
    expect(toggle.parentElement).toBe(input.parentElement)
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Enter' })
    fireEvent.click(toggle)
    expect(input.type).toBe('text')
    expect(input.getAttribute('data-observation-sensitive')).toBe('true')
    expect(screen.getByRole('button', { name: '隐藏密钥' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '隐藏密钥' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('默认密码圆点不额外标记敏感区域，禁用态同时禁用输入与动作', () => {
    render(<StatefulInput disabled />)
    const input = screen.getByLabelText('API 密钥') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: '显示密钥' }) as HTMLButtonElement

    expect(input.getAttribute('data-observation-sensitive')).toBeNull()
    expect(input.disabled).toBe(true)
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2)
  })
})

it('已配置摘要不是输入值，替换与清除动作保持独立', async () => {
  await i18n.changeLanguage('zh-CN')
  const change = vi.fn(), clear = vi.fn()
  render(<ApiKeyInput value="" maskedHint="••••1234" visible={false} onChange={change} onClear={clear} onToggleVisibility={() => {}} placeholder="密钥" showLabel="显示" hideLabel="隐藏" />)
  expect(screen.getByText('已配置 · ••••1234')).toBeTruthy()
  const input = screen.getByPlaceholderText('输入新密钥以替换') as HTMLInputElement
  expect(input.value).toBe('')
  fireEvent.change(input, { target: { value: 'replacement' } })
  expect(change).toHaveBeenCalledWith('replacement')
  fireEvent.click(screen.getByRole('button', { name: '清除' }))
  expect(clear).toHaveBeenCalledTimes(1)
})

it('密钥自动保存：停顿、失焦、回车与卸载都会保存，没有保存按钮，清空输入不会删除已保存的密钥', async () => {
  await i18n.changeLanguage('zh-CN')
  vi.useFakeTimers()
  try {
    const save = vi.fn()
    function Draft(): JSX.Element {
      const [value, setValue] = useState('')
      return <ApiKeyInput value={value} onChange={setValue} onSave={save} maskedHint="••••1234" visible={false} onToggleVisibility={() => {}} placeholder="密钥" showLabel="显示" hideLabel="隐藏" />
    }
    const view = render(<Draft />)
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    const input = screen.getByPlaceholderText('输入新密钥以替换')
    fireEvent.change(input, { target: { value: 'sk-replacement' } })
    expect(save).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(600) })
    expect(save).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: 'sk-replacement-2' } })
    fireEvent.blur(input)
    expect(save).toHaveBeenCalledTimes(2)
    fireEvent.change(input, { target: { value: 'sk-replacement-3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(save).toHaveBeenCalledTimes(3)
    fireEvent.change(input, { target: { value: '' } })
    act(() => { vi.advanceTimersByTime(600) })
    fireEvent.blur(input)
    expect(save).toHaveBeenCalledTimes(3)
    fireEvent.change(input, { target: { value: 'sk-closing' } })
    view.unmount()
    expect(save).toHaveBeenCalledTimes(4)
  } finally {
    vi.useRealTimers()
  }
})

it('保存失败后内容不变也能失焦或回车重试', async () => {
  await i18n.changeLanguage('zh-CN')
  const save = vi.fn()
  render(<ApiKeyInput value="sk-same" onChange={() => {}} onSave={save} error="密钥更改未保存" visible={false} onToggleVisibility={() => {}} placeholder="密钥" showLabel="显示" hideLabel="隐藏" />)
  const input = screen.getByPlaceholderText('密钥')
  fireEvent.blur(input)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(save).toHaveBeenCalledTimes(2)
})
