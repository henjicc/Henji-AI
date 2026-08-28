// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NumberInput from './NumberInput'

afterEach(cleanup)

describe('NumberInput', () => {
  it('以竖排箭头步进并遵守数值边界', () => {
    const onChange = vi.fn()
    const view = render(
      <NumberInput
        value={5}
        onChange={onChange}
        min={1}
        max={6}
        increaseLabel="增加时长"
        decreaseLabel="减少时长"
      />
    )

    const increase = screen.getByRole('button', { name: '增加时长' })
    const decrease = screen.getByRole('button', { name: '减少时长' })
    expect(increase.parentElement?.classList.contains('flex-col')).toBe(true)
    expect(increase.parentElement?.classList.contains('border-l')).toBe(false)
    expect(increase.hasAttribute('data-ui-compact-stepper-button')).toBe(true)
    expect(decrease.hasAttribute('data-ui-compact-stepper-button')).toBe(true)

    fireEvent.click(increase)
    expect(onChange).toHaveBeenLastCalledWith(6)

    view.rerender(
      <NumberInput
        value={6}
        onChange={onChange}
        min={1}
        max={6}
        increaseLabel="增加时长"
        decreaseLabel="减少时长"
      />
    )
    expect((screen.getByRole('button', { name: '增加时长' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('输入框上下键与小数步长共用同一套步进逻辑', () => {
    const onChange = vi.fn()
    render(
      <NumberInput
        ariaLabel="权重"
        value={0.2}
        onChange={onChange}
        step={0.1}
        precision={1}
      />
    )

    const input = screen.getByRole('spinbutton', { name: '权重' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(0.3)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(0.2)
  })

  it('紧凑尺寸保持画布参数行所需的 28px 高度', () => {
    render(
      <NumberInput
        ariaLabel="生成数量"
        value={1}
        onChange={() => undefined}
        size="compact"
        align="center"
        widthClassName="w-[72px]"
      />
    )

    const input = screen.getByRole('spinbutton', { name: '生成数量' })
    expect(input.parentElement?.classList.contains('h-7')).toBe(true)
    expect(input.parentElement?.classList.contains('w-[72px]')).toBe(true)
    expect(input.classList.contains('text-center')).toBe(true)
  })

  it('内容宽度策略随当前数字长度收紧和扩展', () => {
    render(
      <NumberInput
        ariaLabel="时长"
        value={5}
        onChange={() => undefined}
        widthStrategy="content"
      />
    )

    const input = screen.getByRole('spinbutton', { name: '时长' })
    expect(input.parentElement?.style.width).toBe('calc(2ch + 46px)')

    fireEvent.change(input, { target: { value: '12' } })
    expect(input.parentElement?.style.width).toBe('calc(2ch + 46px)')

    fireEvent.change(input, { target: { value: '123' } })
    expect(input.parentElement?.style.width).toBe('calc(3ch + 46px)')
  })
})
