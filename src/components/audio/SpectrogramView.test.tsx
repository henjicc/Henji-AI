/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SpectrogramView } from './SpectrogramView'

const mocks = vi.hoisted(() => ({ draw: vi.fn(), clear: vi.fn(), dispose: vi.fn() }))
vi.mock('./spectrogramGl', () => ({ createSpectrogramGl: () => mocks }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('同帧多次更新只绘制一次，空数据清屏，尺寸变化不重新创建 GPU，卸载取消待绘制', () => {
  const queue = new Map<number, FrameRequestCallback>()
  let next = 1
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = next++; queue.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))
  let resize: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(): void {} disconnect(): void {} })
  const flush = (): void => { const pending = [...queue.values()]; queue.clear(); act(() => pending.forEach(callback => callback(0))) }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 200 } as DOMRect)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
  const tiles = { sampleRate: 48000, channels: 2, durationFrames: 48000, lowBins: 205, highBins: 1025, version: 1, get: () => undefined }
  const props = { tiles, startFrame: 0, endFrame: 512, minHz: 20, maxHz: 24000 }
  const view = render(<SpectrogramView {...props} />)
  view.rerender(<SpectrogramView {...props} startFrame={1} />)
  view.rerender(<SpectrogramView {...props} startFrame={2} />)
  flush()
  expect(mocks.draw).toHaveBeenCalledTimes(2)
  expect(mocks.draw.mock.calls[0][1].startFrame).toBe(2)
  expect(view.container.querySelectorAll('[data-spectrogram-state="ready"]')).toHaveLength(1)
  resize?.(); resize?.(); resize?.()
  expect(queue.size).toBe(1)
  flush()
  expect(mocks.dispose).not.toHaveBeenCalled()
  view.rerender(<SpectrogramView {...props} tiles={undefined} />); flush()
  expect(mocks.clear).toHaveBeenCalledOnce()
  expect(view.container.querySelector('[data-spectrogram-state="empty"]')).not.toBeNull()
  view.rerender(<SpectrogramView {...props} />)
  view.unmount(); flush()
  expect(mocks.draw).toHaveBeenCalledTimes(2)
  expect(mocks.dispose).toHaveBeenCalledOnce()
})
