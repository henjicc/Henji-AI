import { describe, expect, it, vi } from 'vitest'
import {
  presentWindow,
  resolveBackgroundThrottling,
  resolveWindowPresentationMode,
} from './window-presentation'

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
