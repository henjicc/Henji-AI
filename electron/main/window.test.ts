import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const state = vi.hoisted(() => ({ launchQuery: {} as Record<string, string>, events: [] as string[], urls: [] as string[], beginSession: vi.fn(), error: vi.fn(), showMessageBox: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent-crash-dumps' },
  dialog: { showMessageBox: state.showMessageBox },
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
    loadURL(url: string) { state.events.push('renderer'); state.urls.push(url); return Promise.resolve() }
  },
}))
vi.mock('./app-icon', () => ({ resolveAppIconPath: () => undefined }))
vi.mock('./ipc/window', () => ({ bindWindowStateEvents: () => state.beginSession }))
vi.mock('./services/logging/main-logger', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: state.error }) }))
vi.mock('./services/video/frame-export', () => ({ cleanupAllVideoFrameExports: vi.fn() }))
vi.mock('./windows/log-window', () => ({ closeLogWindow: vi.fn() }))
vi.mock('./windows/video-edit-popout', () => ({ createVideoEditPopoutHost: () => ({ handleWindowOpen: (details: { url: string }) => details.url === 'about:blank' ? { action: 'allow' } : undefined }) }))
vi.mock('./services/camera-stage-render', () => ({ closeCameraStageRenderWindow: vi.fn() }))
vi.mock('./services/window-appearance', () => ({ windowAppearance: { getBackgroundColor: () => '' } }))
vi.mock('./services/media-import', () => ({ warmupMediaImportPipeline: vi.fn() }))
vi.mock('./window-presentation', () => ({ presentWindow: (win: { show(): void }) => win.show(), resolveBackgroundThrottling: () => false, resolveInitialWindowPosition: () => ({}), resolveDevelopmentWindowPosition: () => undefined }))
vi.mock('./development-launch', () => ({ resolveDevelopmentLaunchQuery: () => ({ warnings: [], query: { ...state.launchQuery } }) }))

import { createRendererCrashPolicy, createWindow } from './window'

describe('startup window admission', () => {
  beforeEach(() => { vi.useFakeTimers(); state.events.length = 0; vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

  it('共享守卫保留受控剪辑浮窗放行，阻止外部导航、重定向与 webview', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/')
    const win = createWindow({ headless: true })
    const contents = win.webContents as unknown as EventEmitter & { setWindowOpenHandler: ReturnType<typeof vi.fn> }
    const handler = contents.setWindowOpenHandler.mock.calls[0][0]
    expect(handler({ url: 'about:blank' })).toEqual({ action: 'allow' })
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' })
    const preventDefault = vi.fn()
    contents.emit('will-navigate', { preventDefault }, 'http://127.0.0.1:5173/?view=logs#details')
    expect(preventDefault).not.toHaveBeenCalled()
    for (const event of ['will-navigate', 'will-redirect']) contents.emit(event, { preventDefault }, 'https://evil.example/')
    contents.emit('will-attach-webview', { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(3)
  })

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

describe('渲染进程崩溃后的恢复', () => {
  beforeEach(() => { vi.useFakeTimers(); state.events.length = 0; state.urls.length = 0; state.launchQuery = {}; vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  const crash = (win: ReturnType<typeof createWindow>, reason = 'crashed') => (win.webContents as unknown as EventEmitter).emit('render-process-gone', {}, { reason, exitCode: -1073741819 })

  it('5 分钟内第一次直接重载、第二次安全恢复、第三次起交给用户；过了 5 分钟重新计数', () => {
    let now = 0
    const next = createRendererCrashPolicy(() => now)
    expect(next().decision).toBe('reload')
    now += 4 * 60_000
    expect(next().decision).toBe('reload_safe')
    now += 30_000
    expect(next()).toEqual({ decision: 'ask', recentCrashes: 3 })
    expect(next().decision).toBe('ask')
    now += 5 * 60_000
    expect(next().decision).toBe('reload')
  })

  it('崩溃后自动重载，第二次带安全恢复参数且不带开发启动要打开的页面和素材，第三次只弹出说明不再自动重载', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/')
    state.launchQuery = { henjiDevSkipOnboarding: '1', henjiDevSurface: 'tool.image_edit', henjiDevMedia: 'docs/ref/test01.jpg' }
    state.showMessageBox.mockResolvedValue({ response: 0 })
    const win = createWindow()
    state.urls.length = 0
    crash(win)
    await vi.advanceTimersByTimeAsync(500)
    expect(state.urls).toEqual(['http://127.0.0.1:5173/?henjiDevSkipOnboarding=1&henjiDevSurface=tool.image_edit&henjiDevMedia=docs%2Fref%2Ftest01.jpg'])
    crash(win, 'oom')
    await vi.advanceTimersByTimeAsync(500)
    expect(state.urls[1]).toBe('http://127.0.0.1:5173/?henjiDevSkipOnboarding=1&henjiRecovery=safe')
    state.showMessageBox.mockReturnValue(new Promise(() => undefined))
    crash(win)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.showMessageBox).toHaveBeenCalledOnce()
    expect(state.urls).toHaveLength(2)
  })

  it('正常退出、窗口已销毁或助手命令行不触发重载', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/')
    const win = createWindow()
    const cli = createWindow({ recoverRendererCrash: false })
    state.urls.length = 0
    crash(win, 'clean-exit')
    crash(cli)
    await vi.advanceTimersByTimeAsync(5_000)
    crash(win)
    win.destroy()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.urls).toEqual([])
    expect(state.showMessageBox).not.toHaveBeenCalled()
  })
})
