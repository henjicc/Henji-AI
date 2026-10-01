import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, HandlerDetails } from 'electron'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, () => void>()
  return {
    listeners,
    displays: [
      { workArea: { x: 0, y: 0, width: 2560, height: 1400 } },
      { workArea: { x: 2560, y: 0, width: 2560, height: 1400 } },
    ],
    screen: {
      getAllDisplays: () => electron.displays,
      getDisplayMatching: () => electron.displays[0],
      on: (event: string, listener: () => void) => { listeners.set(event, listener) },
      off: (event: string) => { listeners.delete(event) },
    },
  }
})
vi.mock('electron', () => ({ screen: electron.screen }))
vi.mock('../app-icon', () => ({ resolveAppIconPath: () => null }))
vi.mock('../services/logging/main-logger', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))

import { createVideoEditPopoutHost } from './video-edit-popout'

class FakeContents extends EventEmitter {
  throttling = true
  openHandler: (() => unknown) | null = null
  getBackgroundThrottling(): boolean { return this.throttling }
  setBackgroundThrottling(value: boolean): void { this.throttling = value }
  setWindowOpenHandler(handler: () => unknown): void { this.openHandler = handler }
}
class FakeWindow extends EventEmitter {
  webContents = new FakeContents()
  destroyed = false
  bounds = { x: 100, y: 100, width: 480, height: 640 }
  isDestroyed(): boolean { return this.destroyed }
  getBounds(): typeof this.bounds { return this.bounds }
  getNormalBounds(): typeof this.bounds { return this.bounds }
  /** 模拟 Windows 小数缩放：setBounds 后实际外框宽高比请求多 setOffset。 */
  setOffset = 0
  setBounds(value: typeof this.bounds): void { this.bounds = { ...value, width: value.width + this.setOffset, height: value.height + this.setOffset } }
  title = ''
  setTitle(value: string): void { this.title = value }
  removeMenu = vi.fn()
  focus = vi.fn()
  destroy(): void { this.destroyed = true; this.emit('closed') }
  close(): void { if (this.destroyed) return; this.emit('close'); this.destroyed = true; this.emit('closed') }
}

const details = (frameName = 'henji-video-edit-popout:effects', url = 'about:blank'): HandlerDetails => ({ url, frameName, features: 'popup,width=480,height=640', disposition: 'new-window', referrer: { url: '', policy: 'default' } })
const asWindow = (value: FakeWindow): BrowserWindow => value as unknown as BrowserWindow

function open(owner: FakeWindow, host: ReturnType<typeof createVideoEditPopoutHost>, frameName?: string): FakeWindow | null {
  const response = host.handleWindowOpen(details(frameName))
  if (!response || response.action !== 'allow') return null
  const child = new FakeWindow()
  const { x = 0, y = 0, width = 0, height = 0 } = response.overrideBrowserWindowOptions ?? {}
  child.bounds = { x, y, width, height }
  owner.webContents.emit('did-create-window', child, { frameName: frameName ?? 'henji-video-edit-popout:effects', url: 'about:blank' })
  return child
}

describe('剪辑浮窗宿主', () => {
  beforeEach(() => { electron.listeners.clear() })

  it('白名单请求放行为同样隔离、无 preload 的受控子窗；其他请求交回调用方拒绝', () => {
    const owner = new FakeWindow()
    const host = createVideoEditPopoutHost(asWindow(owner))
    expect(host.handleWindowOpen(details('popup'))).toBeNull()
    expect(host.handleWindowOpen(details(undefined, 'https://example.com/'))).toBeNull()
    const response = host.handleWindowOpen(details())
    expect(response).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: {
      parent: owner, minWidth: 320, minHeight: 200,
      webPreferences: { preload: undefined, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    } })
  })

  it('同一面板只允许一个浮窗；子窗导航、跳转与再开窗全部锁死', () => {
    const owner = new FakeWindow()
    const host = createVideoEditPopoutHost(asWindow(owner))
    const child = open(owner, host)!
    expect(host.handleWindowOpen(details())).toBeNull()
    expect(child.focus).toHaveBeenCalledOnce()
    expect(child.webContents.openHandler?.()).toEqual({ action: 'deny' })
    for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
      const preventDefault = vi.fn(); child.webContents.emit(event, { preventDefault }); expect(preventDefault).toHaveBeenCalledOnce()
    }
    const blocked = { url: 'https://example.com/', preventDefault: vi.fn() }
    child.webContents.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    const initial = { url: 'about:blank', preventDefault: vi.fn() }
    child.webContents.emit('will-frame-navigate', initial)
    expect(initial.preventDefault).not.toHaveBeenCalled()
  })

  it('浮窗初始与页面更新后的原生标题都与主窗口“痕迹AI”区分', () => {
    const owner = new FakeWindow()
    const host = createVideoEditPopoutHost(asWindow(owner))
    expect(host.handleWindowOpen(details())).toMatchObject({ overrideBrowserWindowOptions: { title: '痕迹AI · 剪辑面板' } })
    owner.webContents.emit('did-create-window', new FakeWindow(), { frameName: 'henji-video-edit-popout:effects', url: 'about:blank' })
    const child = open(owner, host, 'henji-video-edit-popout:timeline')!
    for (const [page, expected] of [['痕迹AI · 时间线', '痕迹AI · 时间线'], ['痕迹AI', '痕迹AI · 剪辑面板'], ['', '痕迹AI · 剪辑面板']]) {
      const preventDefault = vi.fn()
      child.emit('page-title-updated', { preventDefault }, page, true)
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(child.title).toBe(expected)
    }
  })

  it('创建时即用渲染层传来的面板名作标题；Windows 小数缩放的外框偏差被补偿，多轮重开不漂移', () => {
    const owner = new FakeWindow()
    const host = createVideoEditPopoutHost(asWindow(owner))
    const request = (features: string): HandlerDetails => ({ ...details('henji-video-edit-popout:program'), features })
    const intended = { x: 3439, y: 241, width: 805, height: 921 }
    let record = intended
    for (let round = 0; round < 3; round++) {
      const response = host.handleWindowOpen(request(`popup,width=${record.width},height=${record.height},left=${record.x},top=${record.y},henjiTitle=${encodeURIComponent('痕迹AI · 节目画面')}`))
      expect(response).toMatchObject({ overrideBrowserWindowOptions: { ...intended, title: '痕迹AI · 节目画面' } })
      // 构造后实际外框 +4、setBounds 再 +1，与 1.5 倍缩放实测一致。
      const child = new FakeWindow(); child.setOffset = 1
      child.bounds = { ...intended, width: intended.width + 4, height: intended.height + 4 }
      owner.webContents.emit('did-create-window', child, { frameName: 'henji-video-edit-popout:program', url: 'about:blank' })
      expect(child.getBounds()).toEqual(intended)
      record = child.getBounds(); child.close()
    }
    expect(host.handleWindowOpen(request('popup,henjiTitle=%E0%A4%A'))).toMatchObject({ overrideBrowserWindowOptions: { title: '痕迹AI · 剪辑面板' } })
  })

  it('未经本宿主放行的同名子窗立即销毁', () => {
    const owner = new FakeWindow()
    createVideoEditPopoutHost(asWindow(owner))
    const stray = new FakeWindow()
    owner.webContents.emit('did-create-window', stray, { frameName: 'henji-video-edit-popout:effects', url: 'about:blank' })
    expect(stray.destroyed).toBe(true)
  })

  it('主窗口导航提交（旧文档已卸载）、渲染进程退出或关闭时关闭所有浮窗；导航刚开始时不关闭', () => {
    for (const trigger of ['navigation', 'gone', 'closed'] as const) {
      const owner = new FakeWindow()
      const host = createVideoEditPopoutHost(asWindow(owner))
      const effects = open(owner, host)!
      const timeline = open(owner, host, 'henji-video-edit-popout:timeline')!
      owner.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      owner.webContents.emit('did-navigate-in-page', {}, 'file:///index.html#x', true)
      expect(effects.destroyed).toBe(false)
      if (trigger === 'navigation') owner.webContents.emit('did-navigate', {}, 'file:///index.html', 200, 'OK')
      else if (trigger === 'gone') owner.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      else owner.emit('closed')
      expect([effects.destroyed, timeline.destroyed]).toEqual([true, true])
    }
  })

  it('浮窗存在期间主窗口不节流且监听显示器变化；全部关闭后恢复原设置', () => {
    const owner = new FakeWindow()
    const host = createVideoEditPopoutHost(asWindow(owner))
    const child = open(owner, host)!
    expect(owner.webContents.throttling).toBe(false)
    expect([...electron.listeners.keys()].sort()).toEqual(['display-metrics-changed', 'display-removed'])
    child.bounds = { x: 2760, y: 200, width: 480, height: 320 }
    electron.displays = [electron.displays[0]]
    electron.listeners.get('display-removed')?.()
    expect(child.bounds).toEqual({ x: 1040, y: 540, width: 480, height: 320 })
    child.close()
    expect(owner.webContents.throttling).toBe(true)
    expect(electron.listeners.size).toBe(0)
    electron.displays = [{ workArea: { x: 0, y: 0, width: 2560, height: 1400 } }, { workArea: { x: 2560, y: 0, width: 2560, height: 1400 } }]
  })

  it('同一面板重新打开时恢复上次关闭前的位置，并受数量上限约束', () => {
    const owner = new FakeWindow()
    const host = createVideoEditPopoutHost(asWindow(owner))
    const child = open(owner, host)!
    child.bounds = { x: 2760, y: 200, width: 500, height: 360 }
    child.close()
    expect(host.handleWindowOpen(details())).toMatchObject({ overrideBrowserWindowOptions: { x: 2760, y: 200, width: 500, height: 360 } })
    // 渲染层跨重启记住的位置优先，但仍经显示器修复：所在显示器已拔除时回到主窗口显示器。
    const restored = createVideoEditPopoutHost(asWindow(new FakeWindow()))
    const withPosition = (features: string): HandlerDetails => ({ ...details('henji-video-edit-popout:timeline'), features })
    expect(restored.handleWindowOpen(withPosition('popup,width=400,height=300,left=2700,top=100'))).toMatchObject({ overrideBrowserWindowOptions: { x: 2700, y: 100, width: 400, height: 300 } })
    const unplugged = createVideoEditPopoutHost(asWindow(new FakeWindow()))
    expect(unplugged.handleWindowOpen(withPosition('popup,width=400,height=300,left=9000,top=100'))).toMatchObject({ overrideBrowserWindowOptions: { x: 1080, y: 550, width: 400, height: 300 } })
    const second = new FakeOwnerLimit()
    expect(second.openUntilDenied()).toBe(6)
  })
})

class FakeOwnerLimit {
  owner = new FakeWindow()
  host = createVideoEditPopoutHost(asWindow(this.owner))
  openUntilDenied(): number {
    let count = 0
    for (let index = 0; index < 10; index++) if (open(this.owner, this.host, `henji-video-edit-popout:panel-${index}`)) count++
    return count
  }
}
