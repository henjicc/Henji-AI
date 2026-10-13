import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const state = vi.hoisted(() => ({ events: [] as string[], beginSession: vi.fn(), error: vi.fn() }))
vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: {} }) },
  BrowserWindow: class extends EventEmitter {
    id = 1
    destroyed = false
    visible = false
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return false }
    show() { this.visible = true; state.events.push('show') }
    destroy() { this.destroyed = true; this.emit('closed') }
    setMenuBarVisibility() {}
    loadFile() { state.events.push('renderer'); return Promise.resolve() }
    loadURL() { state.events.push('renderer'); return Promise.resolve() }
  },
}))
vi.mock('./app-icon', () => ({ resolveAppIconPath: () => undefined }))
vi.mock('./ipc/window', () => ({ bindWindowStateEvents: () => state.beginSession }))
vi.mock('./services/logging/main-logger', () => ({ createMainLogger: () => ({ warn: vi.fn(), error: state.error }) }))
vi.mock('./services/video/frame-export', () => ({ cleanupAllVideoFrameExports: vi.fn() }))
vi.mock('./windows/log-window', () => ({ closeLogWindow: vi.fn() }))
vi.mock('./windows/video-edit-popout', () => ({ createVideoEditPopoutHost: () => ({ handleWindowOpen: vi.fn() }) }))
vi.mock('./services/camera-stage-render', () => ({ closeCameraStageRenderWindow: vi.fn() }))
vi.mock('./services/window-appearance', () => ({ windowAppearance: { getBackgroundColor: () => '' } }))
vi.mock('./services/media-import', () => ({ warmupMediaImportPipeline: vi.fn() }))
vi.mock('./window-presentation', () => ({ presentWindow: (win: { show(): void }) => win.show(), resolveBackgroundThrottling: () => false, resolveInitialWindowPosition: () => ({}), resolveDevelopmentWindowPosition: () => undefined }))
vi.mock('./development-launch', () => ({ resolveDevelopmentLaunchQuery: () => ({ warnings: [], query: {} }) }))

import { createWindow } from './window'

describe('startup window admission', () => {
  beforeEach(() => { vi.useFakeTimers(); state.events.length = 0; vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers() })

  it('先显示窗口，回收结束后才加载业务页面和准入文档会话', async () => {
    let finish!: () => void
    const beforeRendererLoad = vi.fn(() => { state.events.push('sweep'); return new Promise<void>(resolve => { finish = resolve }) })
    createWindow({ beforeRendererLoad })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.events).toEqual(['show', 'sweep'])
    expect(state.beginSession).not.toHaveBeenCalled()
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.beginSession).toHaveBeenCalledOnce()
    expect(state.events).toEqual(['show', 'sweep', 'renderer'])
  })

  it('扫描期间关闭窗口不再加载页面或打开会话', async () => {
    let finish!: () => void
    const win = createWindow({ beforeRendererLoad: () => new Promise<void>(resolve => { finish = resolve }) })
    await vi.advanceTimersByTimeAsync(0)
    win.destroy()
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.events).not.toContain('renderer')
    expect(state.beginSession).not.toHaveBeenCalled()
  })

  it('准备失败记录错误并关闭空窗口，不放行业务页面', async () => {
    const win = createWindow({ beforeRendererLoad: async () => { throw new Error('startup failed') } })
    await vi.advanceTimersByTimeAsync(0)
    expect(win.isDestroyed()).toBe(true)
    expect(state.error).toHaveBeenCalledOnce()
    expect(state.events).not.toContain('renderer')
  })
})
