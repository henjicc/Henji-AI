// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'

afterEach(cleanup)

describe('轮廓光灯位交互', () => {
  it('拖动只预览，松手提交八方位且不改变主光；取消恢复原灯位', () => {
    const onMain = vi.fn()
    const onRim = vi.fn()
    render(<RelightDirectionVisualizer direction="right" rimDirection="top-left" sourceImage={null}
      sourceAlt="源图" onDirectionChange={onMain} onRimDirectionChange={onRim} />)
    fireEvent.click(screen.getByRole('button', { name: '正面' }))
    const main = screen.getByRole('slider', { name: '主光方向' })
    const rim = screen.getByRole('slider', { name: '轮廓光方向' })
    main.parentElement!.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 200, top: 0, right: 200, bottom: 200, left: 0, toJSON: () => ({}),
    })
    rim.setPointerCapture = vi.fn()
    rim.hasPointerCapture = vi.fn(() => true)
    rim.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(rim, { button: 0, pointerId: 1, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(rim, { pointerId: 1, clientX: 140, clientY: 120 })
    expect(rim.getAttribute('aria-valuetext')).toBe('右下')
    expect(onRim).not.toHaveBeenCalled()
    expect(onMain).not.toHaveBeenCalled()
    fireEvent.pointerUp(rim, { pointerId: 1 })
    expect(onRim).toHaveBeenCalledTimes(1)
    expect(onRim).toHaveBeenCalledWith('bottom-right')
    const committedZ = rim.getAttribute('data-light-z')
    fireEvent.pointerDown(rim, { button: 0, pointerId: 2, clientX: 140, clientY: 120 })
    fireEvent.pointerMove(rim, { pointerId: 2, clientX: 170, clientY: 100 })
    fireEvent.pointerCancel(rim, { pointerId: 2 })
    expect(rim.getAttribute('aria-valuetext')).toBe('右下')
    expect(rim.getAttribute('data-light-z')).toBe(committedZ)
    expect(onRim).toHaveBeenCalledTimes(1)
  })

  it('主光不指定时仍可独立调轮廓光，关闭后移除灯位与光束', () => {
    const onRim = vi.fn()
    const props = { direction: 'none' as const, sourceImage: null, sourceAlt: '源图', onDirectionChange: vi.fn(), onRimDirectionChange: onRim }
    const view = render(<RelightDirectionVisualizer {...props} rimDirection="top-left" />)
    fireEvent.keyDown(screen.getByRole('slider', { name: '轮廓光方向' }), { key: 'ArrowRight' })
    expect(onRim).toHaveBeenCalledWith('top')
    expect(props.onDirectionChange).not.toHaveBeenCalled()
    view.rerender(<RelightDirectionVisualizer {...props} rimDirection="off" />)
    expect(screen.queryByRole('slider', { name: '轮廓光方向' })).toBeNull()
    expect(view.container.querySelector('[data-relight-rim-light]')).toBeNull()
  })
})
