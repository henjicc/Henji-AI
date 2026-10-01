import { screen, type BrowserWindow, type HandlerDetails, type Rectangle, type WindowOpenHandlerResponse } from 'electron'
import { APP_WINDOW_BACKGROUND_HEX } from '../../../src/core/theme/colorTokens'
import { resolveAppIconPath } from '../app-icon'
import { createMainLogger } from '../services/logging/main-logger'
import {
  parseVideoEditPopoutRequest,
  repairVideoEditPopoutBounds,
  resolveVideoEditPopoutBounds,
  compensateVideoEditPopoutBounds,
  resolveVideoEditPopoutTitle,
  VIDEO_EDIT_POPOUT_FRAME_PREFIX,
  VIDEO_EDIT_POPOUT_MAX_WINDOWS,
  VIDEO_EDIT_POPOUT_MIN_SIZE,
} from './video-edit-popout-policy'

const logger = createMainLogger('main.window.video_edit_popout')

/**
 * 让窗口实际外框等于期望值。Windows 小数缩放下有框窗口的实际外框会比请求多出几像素
 * （实测 1.5 倍：构造 +4、setBounds +1）；渲染层记录的是实际外框，不校正会让“关闭→重开”
 * 每轮变大。按偏差补偿，最多两次。
 */
function applyBounds(child: BrowserWindow, intended: Rectangle): void {
  let request = intended
  if (!compensateVideoEditPopoutBounds(request, child.getBounds(), intended)) return
  child.setBounds(request)
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = compensateVideoEditPopoutBounds(request, child.getBounds(), intended)
    if (!next) return
    request = next
    child.setBounds(request)
  }
}

export interface VideoEditPopoutHost {
  /** 白名单请求返回 allow 与受控窗口选项；其余返回 null，由调用方统一 deny。 */
  handleWindowOpen(details: HandlerDetails): WindowOpenHandlerResponse | null
  closeAll(reason: string): void
  dispose(): void
}

/**
 * 剪辑系统浮窗宿主。浮窗是主窗口同进程、同源的 about:blank 子窗口：主窗口渲染运行时
 * 把面板 portal 进去，工程、历史、保存和公共宿主仍只在主窗口。子窗口没有 preload，
 * 导航与再开窗全部锁死；主窗口重载/导航/关闭时一并关闭，避免失去 opener 的幽灵窗口。
 */
export function createVideoEditPopoutHost(owner: BrowserWindow): VideoEditPopoutHost {
  const windows = new Map<string, BrowserWindow>()
  /** 已放行、尚未创建的浮窗及其应有外框。 */
  const pending = new Map<string, Rectangle>()
  const remembered = new Map<string, Rectangle>()
  let ownerThrottling: boolean | null = null
  let displayListening = false

  const ownerWorkArea = (): Rectangle => screen.getDisplayMatching(owner.getBounds()).workArea
  const repairAll = (): void => {
    const displays = screen.getAllDisplays()
    for (const [panelKey, child] of windows) {
      if (child.isDestroyed()) continue
      const repaired = repairVideoEditPopoutBounds(child.getBounds(), displays, ownerWorkArea())
      if (!repaired) continue
      applyBounds(child, repaired)
      logger.info('剪辑浮窗已移回可见显示器', { event: 'video_edit.popout.bounds_repaired', context: { panel: panelKey } })
    }
  }
  const updateResourcePolicy = (): void => {
    const active = windows.size + pending.size > 0
    if (active && ownerThrottling === null && !owner.isDestroyed()) {
      // 浮窗内容由主窗口 JS 驱动；主窗口最小化或被遮挡时仍须继续调度帧与定时器。
      ownerThrottling = owner.webContents.getBackgroundThrottling()
      owner.webContents.setBackgroundThrottling(false)
    } else if (!active && ownerThrottling !== null) {
      if (!owner.isDestroyed()) owner.webContents.setBackgroundThrottling(ownerThrottling)
      ownerThrottling = null
    }
    if (active && !displayListening) {
      screen.on('display-removed', repairAll); screen.on('display-metrics-changed', repairAll); displayListening = true
    } else if (!active && displayListening) {
      screen.off('display-removed', repairAll); screen.off('display-metrics-changed', repairAll); displayListening = false
    }
  }

  const closeAll = (reason: string): void => {
    pending.clear()
    if (windows.size) logger.info('关闭全部剪辑浮窗', { event: 'video_edit.popout.close_all', context: { reason, count: windows.size } })
    for (const child of [...windows.values()]) if (!child.isDestroyed()) child.close()
    updateResourcePolicy()
  }

  const onCreated = (child: BrowserWindow, details: { frameName: string; url: string }): void => {
    if (!details.frameName.startsWith(VIDEO_EDIT_POPOUT_FRAME_PREFIX)) return
    const panelKey = details.frameName.slice(VIDEO_EDIT_POPOUT_FRAME_PREFIX.length)
    const intended = pending.get(panelKey)
    if (!pending.delete(panelKey) || !intended || details.url !== 'about:blank') {
      // 不是本宿主刚放行的请求（例如已被 closeAll 取消）：不保留。
      child.destroy(); updateResourcePolicy(); return
    }
    windows.set(panelKey, child)
    applyBounds(child, intended)
    child.removeMenu()
    const contents = child.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => event.preventDefault())
    contents.on('will-redirect', event => event.preventDefault())
    contents.on('will-frame-navigate', event => {
      if (event.url === 'about:blank') return
      event.preventDefault()
      logger.warn('已阻止剪辑浮窗导航', { event: 'video_edit.popout.navigation.blocked', context: { panel: panelKey } })
    })
    contents.on('will-attach-webview', event => event.preventDefault())
    // 页面标题只提供面板名；原生标题始终由宿主规范化，不能与主窗口“痕迹AI”相同。
    child.on('page-title-updated', (event, title) => {
      event.preventDefault()
      if (!child.isDestroyed()) child.setTitle(resolveVideoEditPopoutTitle(title))
    })
    child.on('close', () => { if (!child.isDestroyed()) remembered.set(panelKey, child.getNormalBounds()) })
    child.on('closed', () => {
      if (windows.get(panelKey) === child) windows.delete(panelKey)
      updateResourcePolicy()
    })
    logger.info('剪辑浮窗已打开', { event: 'video_edit.popout.opened', context: { panel: panelKey, count: windows.size } })
  }

  const ownerContents = owner.webContents
  // 主帧跨文档导航提交后（旧文档已卸载）再关闭：若在导航开始时关闭，旧页面仍会收到浮窗
  // pagehide 并把它当成“用户关闭=贴回”，丢失应在重载后恢复的浮窗记录。
  const onOwnerNavigation = (): void => closeAll('owner_navigation')
  const onOwnerGone = (): void => closeAll('owner_render_process_gone')
  const onOwnerClosed = (): void => closeAll('owner_closed')
  ownerContents.on('did-create-window', onCreated)
  ownerContents.on('did-navigate', onOwnerNavigation)
  ownerContents.on('render-process-gone', onOwnerGone)
  owner.on('closed', onOwnerClosed)

  return {
    handleWindowOpen(details) {
      const request = parseVideoEditPopoutRequest(details)
      if (!request) return null
      const existing = windows.get(request.panelKey)
      if (existing && !existing.isDestroyed()) { existing.focus(); return null }
      if (pending.has(request.panelKey) || windows.size + pending.size >= VIDEO_EDIT_POPOUT_MAX_WINDOWS) return null
      // 渲染层记住的位置优先（跨重启），其次本会话内存；都经显示器修复，不信任原值。
      const requested = request.position ? { ...request.position, ...request.size } : remembered.get(request.panelKey)
      const bounds = resolveVideoEditPopoutBounds(requested, request.size, screen.getAllDisplays(), ownerWorkArea())
      pending.set(request.panelKey, bounds)
      updateResourcePolicy()
      const iconPath = resolveAppIconPath()
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...bounds,
          minWidth: VIDEO_EDIT_POPOUT_MIN_SIZE.width,
          minHeight: VIDEO_EDIT_POPOUT_MIN_SIZE.height,
          parent: owner,
          show: true,
          autoHideMenuBar: true,
          backgroundColor: APP_WINDOW_BACKGROUND_HEX,
          title: request.title,
          ...(iconPath ? { icon: iconPath } : {}),
          webPreferences: {
            preload: undefined,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      }
    },
    closeAll,
    dispose() {
      closeAll('host_disposed')
      ownerContents.off('did-create-window', onCreated)
      ownerContents.off('did-navigate', onOwnerNavigation)
      ownerContents.off('render-process-gone', onOwnerGone)
      owner.off('closed', onOwnerClosed)
    },
  }
}
