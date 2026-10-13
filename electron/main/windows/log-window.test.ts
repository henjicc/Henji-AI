import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

type LogWindowMock = EventEmitter & {
  destroyed: boolean
  prevented: ReturnType<typeof vi.fn>
  close(): void
  webContents: EventEmitter & { send: ReturnType<typeof vi.fn>; setWindowOpenHandler: ReturnType<typeof vi.fn> }
}
const state = vi.hoisted(() => ({ opened: vi.fn(), closed: vi.fn(), saved: vi.fn(), windows: [] as LogWindowMock[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class MockWindow extends EventEmitter {
    id = 42
    destroyed = false
    prevented = vi.fn()
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(), isDestroyed: () => this.destroyed,
      setWindowOpenHandler: vi.fn(),
    })
    constructor() { super(); state.windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    isMaximized() { return false }
    focus() {}
    show() {}
    setMenuBarVisibility() {}
    loadFile() { return Promise.resolve() }
    loadURL() { return Promise.resolve() }
    close() {
      let prevented = false
      this.emit('close', { preventDefault: () => { prevented = true; this.prevented() } })
      if (!prevented) { this.destroyed = true; this.emit('closed') }
    }
  }
  return { BrowserWindow: MockWindow, screen: { getPrimaryDisplay: () => ({ workArea: {} }) } }
})
vi.mock('../services/media-recycle/lifecycle', () => ({ mediaRecycleLifecycle: state }))
vi.mock('../services/window-appearance', () => ({ windowAppearance: { getBackgroundColor: () => '' } }))
vi.mock('../services/logging/main-logger', () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
vi.mock('../app-icon', () => ({ resolveAppIconPath: () => undefined }))
vi.mock('../development-launch', () => ({ resolveSecondaryWindowLaunchQuery: () => ({}) }))

import { closeLogWindow, openLogWindow } from './log-window'

afterEach(() => { closeLogWindow(); vi.clearAllMocks(); vi.unstubAllEnvs() })
describe('独立日志窗口', () => {
  it.each(['直接关闭', '主窗口联动关闭'])('%s 保留状态广播，不经过保存屏障、不参与媒体回收会话', (mode) => {
    openLogWindow()
    const win = state.windows.at(-1)!
    win.emit('resize')
    expect(win.webContents.send).toHaveBeenCalledWith('window:stateChanged', { isMaximized: false })
    if (mode === '直接关闭') win.close()
    else closeLogWindow()
    expect(win.prevented).not.toHaveBeenCalled()
    expect(win.destroyed).toBe(true)
    expect(state.opened).not.toHaveBeenCalled()
    expect(state.closed).not.toHaveBeenCalled()
    expect(state.saved).not.toHaveBeenCalled()
    openLogWindow()
    expect(state.windows.at(-1)).not.toBe(win)
  })
  it('拒绝外部导航、子窗口和 webview，允许应用查询参数', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/')
    openLogWindow()
    const contents = state.windows.at(-1)!.webContents
    const preventDefault = vi.fn()
    contents.emit('will-navigate', { preventDefault }, 'http://127.0.0.1:5173/?view=logs#details')
    expect(preventDefault).not.toHaveBeenCalled()
    contents.emit('will-navigate', { preventDefault }, 'https://evil.example/')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce()
    const handler = contents.setWindowOpenHandler.mock.calls[0][0]
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' })
    contents.emit('will-attach-webview', { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    contents.emit('will-redirect', { preventDefault }, 'https://evil.example/')
    expect(preventDefault).toHaveBeenCalledTimes(3)
  })
})
