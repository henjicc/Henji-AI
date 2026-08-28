/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'

import ApiKeyInput from './ApiKeyInput'

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
      disabled={disabled}
    />
  )
}

describe('ApiKeyInput', () => {
  it('把无框眼睛动作嵌入同一个输入容器，并保持 label 与键盘语义', () => {
    render(<StatefulInput />)
    const input = screen.getByLabelText('API 密钥') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: '显示密钥' })

    expect(input.type).toBe('password')
    expect(input.className).toContain('pr-12')
    expect(toggle.parentElement).toBe(input.parentElement)
    expect(toggle.className).toContain('absolute')
    expect(toggle.className).toContain('border-transparent')

    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Enter' })
    fireEvent.click(toggle)
    expect(input.type).toBe('text')
    expect(input.getAttribute('data-observation-sensitive')).toBe('true')
    expect(screen.getByRole('button', { name: '隐藏密钥' })).toBeTruthy()
  })

  it('默认密码圆点不额外标记敏感区域，禁用态同时禁用输入与动作', () => {
    render(<StatefulInput disabled />)
    const input = screen.getByLabelText('API 密钥') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: '显示密钥' }) as HTMLButtonElement

    expect(input.getAttribute('data-observation-sensitive')).toBeNull()
    expect(input.disabled).toBe(true)
    expect(toggle.disabled).toBe(true)
  })
})
