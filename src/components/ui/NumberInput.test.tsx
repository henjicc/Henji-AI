// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NumberInput from './NumberInput'
import { resolveScrubFactor } from './numberScrub'

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

  it('输入框上下键与小数步长共用同一套步进逻辑，Shift 一次十步', () => {
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

    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(1.2)
  })

  it('尺寸档决定外框高度（sm 28），字段为 raised 无边框表面', () => {
    render(
      <NumberInput
        ariaLabel="生成数量"
        value={1}
        onChange={() => undefined}
        size="sm"
        align="center"
        widthClassName="w-[72px]"
      />
    )

    const input = screen.getByRole('spinbutton', { name: '生成数量' })
    const field = input.parentElement as HTMLElement
    expect(field.classList.contains('h-control-sm')).toBe(true)
    expect(field.classList.contains('w-[72px]')).toBe(true)
    expect(field.classList.contains('bg-raised')).toBe(true)
    expect(field.className).not.toMatch(/(^| )border( |$)/)
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
    expect(input.parentElement?.style.width).toBe('calc(2ch + 34px)')

    fireEvent.change(input, { target: { value: '12' } })
    expect(input.parentElement?.style.width).toBe('calc(2ch + 34px)')

    fireEvent.change(input, { target: { value: '123' } })
    expect(input.parentElement?.style.width).toBe('calc(3ch + 34px)')
  })

  it('固定宽度时外框最小宽度仍容纳读数，步进列不会裁掉数字', () => {
    render(
      <NumberInput
        ariaLabel="网格密度"
        value={1000}
        onChange={() => undefined}
        widthClassName="w-16"
      />
    )
    const field = screen.getByRole('spinbutton', { name: '网格密度' }).parentElement as HTMLElement
    expect(field.classList.contains('w-16')).toBe(true)
    expect(field.style.minWidth).toBe('calc(4ch + 34px)')
  })

  it('在读数上按住左右拖动改值（每 2px 一步），松开后不进入编辑', () => {
    const onChange = vi.fn()
    render(<NumberInput ariaLabel="缩放" value={10} onChange={onChange} min={0} max={100} />)
    const input = screen.getByRole('spinbutton', { name: '缩放' })

    fireEvent.pointerDown(input, { pointerId: 1, button: 0, clientX: 100 })
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 102 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 110 })
    expect(onChange).toHaveBeenLastCalledWith(15)
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 80 })
    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.pointerUp(input, { pointerId: 1, clientX: 80 })
    expect(document.activeElement).not.toBe(input)
  })

  it('拖动时 Shift 精细、Alt 粗调，中途切换修饰键不跳变', () => {
    expect(resolveScrubFactor({ shiftKey: true, altKey: false })).toBe(0.1)
    expect(resolveScrubFactor({ shiftKey: false, altKey: true })).toBe(10)
    expect(resolveScrubFactor({ shiftKey: true, altKey: true })).toBe(0.1)
    expect(resolveScrubFactor({ shiftKey: false, altKey: false })).toBe(1)

    const onChange = vi.fn()
    render(<NumberInput ariaLabel="旋转" value={0} onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: '旋转' })
    fireEvent.pointerDown(input, { pointerId: 2, button: 0, clientX: 0 })
    fireEvent.pointerMove(input, { pointerId: 2, clientX: 4, altKey: true })
    expect(onChange).toHaveBeenLastCalledWith(20)
    fireEvent.pointerMove(input, { pointerId: 2, clientX: 44, shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(22)
    fireEvent.pointerUp(input, { pointerId: 2, clientX: 44 })
  })

  it('单击读数（未拖动）进入编辑并全选；标签也可拖动改值', () => {
    const onChange = vi.fn()
    render(<NumberInput label="不透明度" value={50} onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: '不透明度' })

    fireEvent.pointerDown(input, { pointerId: 3, button: 0, clientX: 10 })
    fireEvent.pointerUp(input, { pointerId: 3, clientX: 11 })
    expect(document.activeElement).toBe(input)
    expect(onChange).not.toHaveBeenCalled()

    // 编辑中按下读数是移动光标，不触发拖动
    fireEvent.pointerDown(input, { pointerId: 4, button: 0, clientX: 10 })
    fireEvent.pointerMove(input, { pointerId: 4, clientX: 60 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(input, { pointerId: 4, clientX: 60 })

    const label = screen.getByText('不透明度')
    fireEvent.pointerDown(label, { pointerId: 5, button: 0, clientX: 0 })
    fireEvent.pointerMove(label, { pointerId: 5, clientX: 10 })
    expect(onChange).toHaveBeenLastCalledWith(55)
  })

  it('禁用时不响应拖动', () => {
    const onChange = vi.fn()
    render(<NumberInput ariaLabel="音量" value={0} onChange={onChange} disabled />)
    const input = screen.getByRole('spinbutton', { name: '音量' })
    fireEvent.pointerDown(input, { pointerId: 6, button: 0, clientX: 0 })
    fireEvent.pointerMove(input, { pointerId: 6, clientX: 40 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('拖动手势只在越过阈值时开始，松手提交，Esc 取消并回到拖动前的读数', () => {
    const onChange = vi.fn(); const onScrubStart = vi.fn(); const onScrubEnd = vi.fn()
    render(<NumberInput ariaLabel="亮度" value={100} min={0} max={200} onChange={onChange} onScrubStart={onScrubStart} onScrubEnd={onScrubEnd} />)
    const input = screen.getByRole('spinbutton', { name: '亮度' }) as HTMLInputElement
    fireEvent.pointerDown(input, { pointerId: 7, button: 0, clientX: 0 })
    fireEvent.pointerMove(input, { pointerId: 7, clientX: 2 })
    expect(onScrubStart).not.toHaveBeenCalled()
    fireEvent.pointerMove(input, { pointerId: 7, clientX: 400 })
    expect(onScrubStart).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(200)
    fireEvent.pointerUp(input, { pointerId: 7, clientX: 400 })
    expect(onScrubEnd).toHaveBeenLastCalledWith(false)

    fireEvent.pointerDown(input, { pointerId: 8, button: 0, clientX: 0 })
    fireEvent.pointerMove(input, { pointerId: 8, clientX: 20 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onScrubEnd).toHaveBeenLastCalledWith(true)
    expect(input.value).toBe('100')
    const calls = onChange.mock.calls.length
    fireEvent.pointerMove(input, { pointerId: 8, clientX: 60 })
    fireEvent.pointerUp(input, { pointerId: 8, clientX: 60 })
    expect(onChange).toHaveBeenCalledTimes(calls); expect(onScrubEnd).toHaveBeenCalledTimes(2)
  })

  it('键盘编辑时 Esc 放弃输入，不提交', () => {
    const onChange = vi.fn()
    render(<NumberInput ariaLabel="旋转" value={5} onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: '旋转' }) as HTMLInputElement
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '90' } })
    fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled(); expect(input.value).toBe('5')
  })
})
