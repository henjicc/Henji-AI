// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'

afterEach(cleanup)

describe('打光方向可视化控件', () => {
  it('支持键盘选择方向并通过标签公开当前模型映射', () => {
    const onDirectionChange = vi.fn()
    const view = render(
      <RelightDirectionVisualizer
        direction="none"
        sourceImage="asset://source.png"
        onDirectionChange={onDirectionChange}
      />,
    )

    const control = screen.getByRole('slider', { name: '主光方向' })
    expect(control.getAttribute('aria-valuetext')).toBe('不指定')
    fireEvent.keyDown(control, { key: 'ArrowRight' })
    expect(onDirectionChange).toHaveBeenCalledWith('right')

    view.rerender(
      <RelightDirectionVisualizer
        direction="right"
        sourceImage="asset://source.png"
        onDirectionChange={onDirectionChange}
      />,
    )
    expect(control.getAttribute('data-relight-direction')).toBe('right')
    expect(screen.getByText('模型方向 · 右侧')).toBeTruthy()
  })

  it('拖过右侧分区时只发送模型支持的右侧方向', () => {
    const onDirectionChange = vi.fn()
    render(
      <RelightDirectionVisualizer
        direction="none"
        sourceImage={null}
        onDirectionChange={onDirectionChange}
      />,
    )

    const control = screen.getByRole('slider', { name: '主光方向' })
    control.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      top: 0,
      right: 200,
      bottom: 200,
      left: 0,
      toJSON: () => ({}),
    })
    control.setPointerCapture = vi.fn()
    control.hasPointerCapture = vi.fn(() => true)
    control.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(control, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(control, { pointerId: 1, clientX: 184, clientY: 100 })
    fireEvent.pointerUp(control, { pointerId: 1, clientX: 184, clientY: 100 })

    expect(onDirectionChange).toHaveBeenCalledTimes(1)
    expect(onDirectionChange).toHaveBeenCalledWith('right')
    expect(control.releasePointerCapture).toHaveBeenCalledWith(1)
  })
})
