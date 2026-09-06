import { describe, expect, it, vi } from 'vitest'
import {
  presentWindow,
  resolveBackgroundThrottling,
  resolveInitialWindowPosition,
  resolveWindowPresentationMode,
} from './window-presentation'

describe('resolveInitialWindowPosition', () => {
  it('places the initial frameless window below the macOS menu bar and above the Dock', () => {
    expect(resolveInitialWindowPosition(
      { width: 1200, height: 800 },
      { x: 0, y: 33, width: 1470, height: 848 },
    )).toEqual({ x: 135, y: 57 })
  })

  it('uses work-area coordinates on offset displays and with a side Dock', () => {
    expect(resolveInitialWindowPosition(
      { width: 1040, height: 720 },
      { x: -1850, y: -1047, width: 1850, height: 1047 },
    )).toEqual({ x: -1445, y: -884 })
  })

  it('keeps the window top-left accessible when its minimum size exceeds the work area', () => {
    expect(resolveInitialWindowPosition(
      { width: 960, height: 640 },
      { x: 80, y: 33, width: 900, height: 600 },
    )).toEqual({ x: 80, y: 33 })
  })
})

describe('resolveWindowPresentationMode', () => {
  it('uses foreground presentation by default', () => {
    expect(resolveWindowPresentationMode(['.'])).toBe('foreground')
  })

  it('uses background presentation for the explicit launch switch', () => {
    expect(resolveWindowPresentationMode(['.', '--background'])).toBe('background')
  })
})

describe('resolveBackgroundThrottling', () => {
  it('keeps minimized background windows rendering', () => {
    expect(resolveBackgroundThrottling('background')).toBe(false)
  })

  it('preserves Electron throttling for normal foreground windows', () => {
    expect(resolveBackgroundThrottling('foreground')).toBe(true)
  })
})

describe('presentWindow', () => {
  it('minimizes a background window without showing or maximizing it', () => {
    const win = {
      maximize: vi.fn(),
      minimize: vi.fn(),
      show: vi.fn(),
    }

    presentWindow(win, 'background')

    expect(win.minimize).toHaveBeenCalledOnce()
    expect(win.maximize).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
  })

  it('preserves the normal foreground presentation', () => {
    const win = {
      maximize: vi.fn(),
      minimize: vi.fn(),
      show: vi.fn(),
    }

    presentWindow(win, 'foreground')

    expect(win.maximize).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.minimize).not.toHaveBeenCalled()
    expect(win.maximize.mock.invocationCallOrder[0])
      .toBeLessThan(win.show.mock.invocationCallOrder[0])
  })
})
