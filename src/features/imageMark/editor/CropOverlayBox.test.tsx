// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CropOverlayBox } from './CropOverlayBox'

afterEach(cleanup)
describe('共享裁剪框的缩放与扩图约束', () => {
  it('扩图实时缩放后使用新比例换算增量，静止指针不会重复扩张', () => {
    const onChange = vi.fn()
    const props = { displayWidth: 500, displayHeight: 500, scale: 1,
      crop: { x: 0, y: 0, width: 500, height: 500 }, imageWidth: 1000, imageHeight: 1000,
      ratio: null, onChange, onCommit: vi.fn(), constrainRect: (rect: { x: number; y: number; width: number; height: number }) => rect }
    const view = render(<CropOverlayBox {...props} appearance="expand" />)
    vi.spyOn(view.container.firstElementChild as HTMLElement, 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect)
    fireEvent.mouseDown(view.container.querySelector('[data-crop-handle="e"]')!, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 600 })
    view.rerender(<CropOverlayBox {...props} appearance="expand" scale={0.5} crop={onChange.mock.lastCall![0]} />)
    fireEvent.mouseMove(window, { clientX: 600 })
    expect(onChange.mock.lastCall![0].width).toBe(600)
    fireEvent.mouseMove(window, { clientX: 610 })
    expect(onChange.mock.lastCall![0].width).toBe(620)
    fireEvent.mouseUp(window)
  })
  it.each([1, 0.5, 2])('画布缩放 %s 时以图片像素计算，松手仅提交一次', zoom => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const view = render(<CropOverlayBox displayWidth={500} displayHeight={500} scale={0.5}
      crop={{ x: 100, y: 100, width: 200, height: 200 }} imageWidth={1000} imageHeight={1000}
      ratio={null} onChange={onChange} onCommit={onCommit} />)
    const overlay = view.container.firstElementChild as HTMLElement
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ width: 500 * zoom } as DOMRect)
    fireEvent.mouseDown(view.container.querySelector('[data-crop-handle="e"]')!, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 100 + 50 * zoom, clientY: 100 })
    expect(onChange).toHaveBeenLastCalledWith({ x: 100, y: 100, width: 300, height: 200 })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.mouseUp(window)
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.mouseMove(window, { clientX: 400 })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it('默认裁剪仍受图片边界限制，扩图允许使用自己的边界', () => {
    const onChange = vi.fn()
    const props = { displayWidth: 500, displayHeight: 500, scale: 1,
      crop: { x: 0, y: 0, width: 500, height: 500 }, imageWidth: 500, imageHeight: 500,
      ratio: null, onChange, onCommit: vi.fn() }
    const view = render(<CropOverlayBox {...props} />)
    vi.spyOn(view.container.firstElementChild as HTMLElement, 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect)
    fireEvent.mouseDown(view.container.querySelector('[data-crop-handle="w"]')!, { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: -100 })
    expect(onChange.mock.lastCall![0].x).toBe(0)
    fireEvent.mouseUp(window)
    view.rerender(<CropOverlayBox {...props} constrainRect={rect => rect} />)
    fireEvent.mouseDown(view.container.querySelector('[data-crop-handle="w"]')!, { clientX: 0 })
    fireEvent.mouseMove(window, { clientX: -100 })
    expect(onChange.mock.lastCall![0].x).toBe(-100)
    fireEvent.mouseUp(window)
  })
})
