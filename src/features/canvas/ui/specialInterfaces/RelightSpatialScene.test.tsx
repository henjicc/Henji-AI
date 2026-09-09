// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'

afterEach(cleanup)
describe('灯位遮挡与图片平面', () => {
  it('主光和轮廓光跨过图片平面时，都改变遮挡顺序', () => {
    const { container } = render(<RelightDirectionVisualizer direction="right" rimDirection="top-left"
      sourceImage="asset://portrait.png" sourceAlt="源图" onDirectionChange={vi.fn()} onRimDirectionChange={vi.fn()} />)
    const plane = container.querySelector('[data-relight-image-plane]')!
    for (const [name, key] of [['主光方向', 'main'], ['轮廓光方向', 'rim']]) {
      const light = (): Element => container.querySelector(`[data-relight-light="${key}"]`)!
      const wasFront = light().getAttribute('data-relight-depth') === 'front'
      expect(Boolean(plane.compareDocumentPosition(light()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(wasFront)
      fireEvent.keyDown(screen.getByRole('slider', { name }), { key: 'End' })
      expect(light().getAttribute('data-relight-depth')).toBe(wasFront ? 'back' : 'front')
      expect(Boolean(plane.compareDocumentPosition(light()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(!wasFront)
    }
  })
  it('加载竖图后平面收窄，图像没有黑底容器', () => {
    const { container } = render(<RelightDirectionVisualizer direction="top" sourceImage="asset://portrait.png"
      sourceAlt="源图" onDirectionChange={vi.fn()} />)
    const image = container.querySelector('img')!
    Object.defineProperties(image, { naturalWidth: { value: 300 }, naturalHeight: { value: 600 } })
    fireEvent.load(image)
    expect(container.querySelector('[data-relight-image-plane]')?.getAttribute('data-image-aspect')).toBe('0.5')
    expect(image.parentElement?.className).not.toContain('bg-')
    expect(container.textContent).not.toContain('大光点调主光')
  })
})
