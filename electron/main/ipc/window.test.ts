import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
vi.mock('electron', () => ({ BrowserWindow: {} }))

import { bindWindowStateEvents, parseZoomFactor } from './window'
import { mediaRecycleLifecycle } from '../services/media-recycle/lifecycle'

it('未加载页面的启动窗口可以直接关闭，准入后恢复保存屏障', () => {
  const opened = vi.spyOn(mediaRecycleLifecycle, 'opened').mockImplementation(() => undefined)
  const closed = vi.spyOn(mediaRecycleLifecycle, 'closed').mockImplementation(() => undefined)
  try {
    const win = Object.assign(new EventEmitter(), { id: 99, isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } })
    const admit = bindWindowStateEvents(win as unknown as BrowserWindow, true)
    const preventDefault = vi.fn()
    win.emit('close', { preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    admit()
    expect(opened).toHaveBeenCalledWith(99)
    win.emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('window:closeRequested')
    win.emit('closed')
    expect(closed).toHaveBeenCalledWith(99)
  } finally { opened.mockRestore(); closed.mockRestore() }
})

describe('window IPC zoom factor parser', () => {
  it.each([0.9, 1, 1.1, 1.25, 1.5] as const)('接受登记的缩放比例 %s', (factor) => {
    expect(parseZoomFactor({ factor })).toBe(factor)
  })

  it.each([0.85, 0, 1.2, '0.9', undefined])('拒绝未登记的缩放比例 %s', (factor) => {
    expect(() => parseZoomFactor({ factor })).toThrow('Expected zoom factor')
  })
})
