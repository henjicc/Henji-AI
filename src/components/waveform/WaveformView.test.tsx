/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WaveformView } from './WaveformView'

vi.mock('@/hooks/useThemeTokens', () => ({ useThemeTokens: () => ({ colors: {} }) }))
vi.mock('@/hooks/useWaveformData', () => ({ useWaveformDetail: () => undefined }))
const mocks = vi.hoisted(() => ({ draw: vi.fn(() => 'empty') }))
vi.mock('./waveformDraw', () => ({ drawWaveform: mocks.draw }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('波形与叠加层同一次提交画完，尺寸通知按帧合并，卸载不再绘制', () => {
  const queue = new Map<number, FrameRequestCallback>()
  let next = 1, resize: (() => void) | undefined
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = next++; queue.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(): void {} disconnect(): void {} })
  const flush = (): void => { const pending = [...queue.values()]; queue.clear(); act(() => pending.forEach(callback => callback(0))) }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 100 } as DOMRect)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  const view = render(<WaveformView waveform={{ status: 'idle' }} startSeconds={0} endSeconds={10} />)
  view.rerender(<WaveformView waveform={{ status: 'idle' }} startSeconds={1} endSeconds={11} />)
  view.rerender(<WaveformView waveform={{ status: 'idle' }} startSeconds={2} endSeconds={12} />)
  // 每次换视图当场重画，不等下一帧：和选区、刻度同帧
  expect(mocks.draw).toHaveBeenCalledTimes(3)
  expect(mocks.draw).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ startFrame: 2, endFrame: 12 }))
  resize?.(); resize?.(); resize?.()
  expect(queue.size).toBe(1)
  view.unmount(); flush()
  expect(mocks.draw).toHaveBeenCalledTimes(3)
})

it('窄波形的时间码复用提示框测量定位，悬停和拖动定位行为保持可用', () => {
  const rect = { left: window.innerWidth - 80, top: 0, right: window.innerWidth, bottom: 24, width: 80, height: 24, x: window.innerWidth - 80, y: 0, toJSON: () => ({}) }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
  const onSeek = vi.fn()
  const view = render(<WaveformView waveform={{ status: 'idle' }} height={24} durationSeconds={60} onSeek={onSeek} />)
  const host = view.container.firstElementChild!
  fireEvent.mouseMove(host, { clientX: rect.right - 8, clientY: 4 })
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.textContent).toBe('0:54')
  expect(tooltip.style.left).toBe(`${window.innerWidth - 68}px`)
  expect(tooltip.style.top).toBe('8px')
  expect(tooltip.parentElement).toBe(document.body)
  fireEvent.mouseDown(host, { button: 0, clientX: rect.left + 40 })
  fireEvent.mouseUp(host, { button: 0, clientX: rect.left + 40 })
  expect(onSeek).toHaveBeenCalledWith(0.5)
  fireEvent.mouseLeave(host)
  expect(screen.queryByRole('tooltip')).toBeNull()
})
