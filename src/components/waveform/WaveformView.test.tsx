/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WaveformView } from './WaveformView'

vi.mock('@/hooks/useThemeTokens', () => ({ useThemeTokens: () => ({ colors: {} }) }))
vi.mock('@/hooks/useWaveformData', () => ({ useWaveformDetail: () => undefined }))
vi.mock('./waveformDraw', () => ({ drawWaveform: () => 'empty' }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
