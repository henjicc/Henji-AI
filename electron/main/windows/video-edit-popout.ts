import { screen, type BrowserWindow, type HandlerDetails, type Rectangle, type WebContents, type WindowOpenHandlerResponse } from 'electron'
import { windowAppearance } from '../services/window-appearance'
import { resolveAppIconPath } from '../app-icon'
import { createMainLogger } from '../services/logging/main-logger'
import {
  parseVideoEditPopoutRequest,
  repairVideoEditPopoutBounds,
  resolveVideoEditPopoutBounds,
  compensateVideoEditPopoutBounds,
  matchVideoEditPopoutWorkArea,
  measureVideoEditPopoutFrameInsets,
  resolveVideoEditPopoutTitle,
  viewRectToVideoEditPopoutBounds,
  type VideoEditPopoutControlRequest,
  type VideoEditPopoutFrameInsets,
  VIDEO_EDIT_POPOUT_FRAME_PREFIX,
  VIDEO_EDIT_POPOUT_MAX_WINDOWS,
  VIDEO_EDIT_POPOUT_MIN_SIZE,
  VIDEO_EDIT_POPOUT_NO_INSETS,
  VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT,
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
  /** 主窗口代为移动/收起/最大化自己的浮窗；面板不属于本宿主的已开浮窗时忽略。 */
  control(request: VideoEditPopoutControlRequest): void
  dispose(): void
}

/** 每个主窗口的浮窗宿主，按主窗口 webContents 查找：IPC 只能控制发送方自己打开的浮窗。 */
const hostsByOwner = new Map<WebContents, VideoEditPopoutHost>()

export function controlVideoEditPopout(sender: WebContents, request: VideoEditPopoutControlRequest): void {
  hostsByOwner.get(sender)?.control(request)
}

/**
 * 剪辑系统浮窗宿主。浮窗是主窗口同进程、同源的 about:blank 子窗口：主窗口渲染运行时
 * 把面板 portal 进去，工程、历史、保存和公共宿主仍只在主窗口。子窗口没有 preload，
 * 导航与再开窗全部锁死；主窗口重载/导航/关闭时一并关闭，避免失去 opener 的幽灵窗口。
 */
export function createVideoEditPopoutHost(owner: BrowserWindow): VideoEditPopoutHost {
  const windows = new Map<string, BrowserWindow>()
  /** 已放行、尚未创建的浮窗：应有外框，及渲染层给出的窗口矩形（含隐形边框，隐形边框未知时用于创建后校正）。 */
  const pending = new Map<string, { bounds: Rectangle; view: Rectangle | null; size: { width: number; height: number } }>()
  /** 无边框浮窗的隐形边框；同一宿主的浮窗样式相同，第一次测得后复用。 */
  let frameInsets: VideoEditPopoutFrameInsets | null = null
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
    const request = pending.get(panelKey)
    if (!pending.delete(panelKey) || !request || details.url !== 'about:blank') {
      // 不是本宿主刚放行的请求（例如已被 closeAll 取消）：不保留。
      child.destroy(); updateResourcePolicy(); return
    }
    windows.set(panelKey, child)
    applyBounds(child, request.bounds)
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
    // 渲染层看到的窗口矩形含 Windows 无边框窗口的隐形缩放边框，BrowserWindow 外框不含：创建后测一次两者之差。
    const insetsReady: Promise<VideoEditPopoutFrameInsets> = frameInsets ? Promise.resolve(frameInsets) : (async () => {
      try {
        const view: unknown = await contents.executeJavaScript('[window.screenX, window.screenY, window.outerWidth, window.outerHeight]', false)
        if (!child.isDestroyed() && Array.isArray(view)) frameInsets = measureVideoEditPopoutFrameInsets(view, child.getBounds())
      } catch { /* 窗口已关闭：按无隐形边框处理 */ }
      return frameInsets ?? VIDEO_EDIT_POPOUT_NO_INSETS
    })()
    if (request.view && !frameInsets) {
      // 渲染层记住的位置是它看到的窗口矩形；隐形边框测得后按外框语义校正一次，避免“关闭→重开”每轮漂移。
      const view = request.view
      void insetsReady.then(insets => {
        if (child.isDestroyed() || (!insets.left && !insets.top && !insets.right && !insets.bottom)) return
        applyBounds(child, resolveVideoEditPopoutBounds(viewRectToVideoEditPopoutBounds(view, insets), request.size, screen.getAllDisplays(), ownerWorkArea()))
      })
    }
    // 无边框浮窗由主窗口脚本 moveTo/resizeTo 驱动（标题栏拖动、双击最大化、拖向停靠时收成标题条）。
    // 默认处理把渲染层的窗口矩形直接当外框，隐形边框会让窗口每次变大、错位；这里换算成外框。
    // 请求正好是某个显示器的可用区域时按系统最大化处理（标题栏双击）。
    let latest: Rectangle | null = null
    const applyRequested = (insets: VideoEditPopoutFrameInsets): void => {
      const rect = latest; latest = null
      if (!rect || child.isDestroyed()) return
      if (matchVideoEditPopoutWorkArea(rect, screen.getAllDisplays())) { child.maximize(); return }
      if (child.isMaximized()) child.unmaximize()
      applyBounds(child, viewRectToVideoEditPopoutBounds(rect, insets))
    }
    contents.on('content-bounds-updated', (event, bounds) => {
      event.preventDefault()
      latest = bounds
      if (frameInsets) applyRequested(frameInsets)
      else void insetsReady.then(applyRequested)
    })
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

  /** 正在被标题栏拖动的浮窗：抓取点相对窗口外框的偏移、收起前的高度。 */
  const moving = new Map<string, { offsetX: number; offsetY: number; height: number | null }>()
  const control = (request: VideoEditPopoutControlRequest): void => {
    const child = windows.get(request.panelKey)
    if (!child || child.isDestroyed()) return
    switch (request.action) {
      case 'begin-move': {
        if (child.isMaximized()) {
          // 从最大化拖出：先还原，指针保持在标题栏上同样的相对横向位置（与系统标题栏一致）。
          const maximized = child.getBounds()
          child.unmaximize()
          const normal = child.getBounds()
          const ratio = Math.min(1, Math.max(0, (request.x - maximized.x) / Math.max(1, maximized.width)))
          child.setPosition(Math.round(request.x - normal.width * ratio), Math.round(request.y - Math.min(VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT / 2, request.y - maximized.y)))
        }
        const bounds = child.getBounds()
        moving.set(request.panelKey, { offsetX: request.x - bounds.x, offsetY: request.y - bounds.y, height: null })
        return
      }
      case 'move': {
        const state = moving.get(request.panelKey)
        if (state) child.setPosition(Math.round(request.x - state.offsetX), Math.round(request.y - state.offsetY))
        return
      }
      case 'collapse': {
        // 拖向主窗口停靠时收成只剩标题条，不挡住停靠指示。
        const state = moving.get(request.panelKey)
        if (!state || state.height !== null) return
        const bounds = child.getBounds()
        state.height = bounds.height
        child.setBounds({ ...bounds, height: VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT })
        return
      }
      case 'expand':
      case 'end-move': {
        const state = moving.get(request.panelKey)
        if (state && state.height !== null) { child.setBounds({ ...child.getBounds(), height: state.height }); state.height = null }
        if (request.action === 'end-move') moving.delete(request.panelKey)
        return
      }
      case 'toggle-maximize':
        if (child.isMaximized()) child.unmaximize(); else child.maximize()
        return
    }
  }

  const host: VideoEditPopoutHost = {
    control,
    handleWindowOpen(details) {
      const request = parseVideoEditPopoutRequest(details)
      if (!request) return null
      const existing = windows.get(request.panelKey)
      if (existing && !existing.isDestroyed()) { existing.focus(); return null }
      if (pending.has(request.panelKey) || windows.size + pending.size >= VIDEO_EDIT_POPOUT_MAX_WINDOWS) return null
      // 渲染层记住的位置优先（跨重启），其次本会话内存；都经显示器修复，不信任原值。
      // 渲染层的位置是它看到的窗口矩形（含隐形边框），已知隐形边框时先换算成外框。
      const view = request.position ? { ...request.position, ...request.size } : null
      const requested = view ? viewRectToVideoEditPopoutBounds(view, frameInsets ?? VIDEO_EDIT_POPOUT_NO_INSETS) : remembered.get(request.panelKey)
      const bounds = resolveVideoEditPopoutBounds(requested, request.size, screen.getAllDisplays(), ownerWorkArea())
      pending.set(request.panelKey, { bounds, view, size: request.size })
      updateResourcePolicy()
      const iconPath = resolveAppIconPath()
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...bounds,
          minWidth: VIDEO_EDIT_POPOUT_MIN_SIZE.width,
          // 渲染层把窗口拖向主窗口停靠时会收成只剩标题条，最小高度放到标题条高度。
          minHeight: VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT,
          parent: owner,
          // 无系统边框：标题栏由渲染层自绘（面板标签、贴回、关闭，拖动与双击最大化由主窗口脚本驱动
          // window.moveTo/resizeTo）；四边与四角的缩放由无边框窗口的系统缩放边框提供。
          frame: false,
          show: true,
          autoHideMenuBar: true,
          backgroundColor: windowAppearance.getBackgroundColor(),
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
      if (hostsByOwner.get(ownerContents) === host) hostsByOwner.delete(ownerContents)
      closeAll('host_disposed')
      ownerContents.off('did-create-window', onCreated)
      ownerContents.off('did-navigate', onOwnerNavigation)
      ownerContents.off('render-process-gone', onOwnerGone)
      owner.off('closed', onOwnerClosed)
    },
  }
  hostsByOwner.set(ownerContents, host)
  return host
}
