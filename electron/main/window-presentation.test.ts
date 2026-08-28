import { describe, expect, it, vi } from 'vitest'
import {
  presentWindow,
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

describe('presentWindow', () => {
  it('shows a background window without focusing it', () => {
    const win = {
      maximize: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
    }

    presentWindow(win, 'background')

    expect(win.maximize).toHaveBeenCalledOnce()
    expect(win.showInactive).toHaveBeenCalledOnce()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.showInactive.mock.invocationCallOrder[0])
      .toBeLessThan(win.maximize.mock.invocationCallOrder[0])
  })

  it('preserves the normal foreground presentation', () => {
    const win = {
      maximize: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
    }

    presentWindow(win, 'foreground')

    expect(win.maximize).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.showInactive).not.toHaveBeenCalled()
    expect(win.maximize.mock.invocationCallOrder[0])
      .toBeLessThan(win.show.mock.invocationCallOrder[0])
  })
})
