/**
 * 剪辑系统浮窗的 DOM 宿主：主窗口以 `about:blank` 打开同源子窗口，把主题样式同步过去，
 * 再由主窗口 React 把面板 portal 进容器。子窗口不运行任何应用脚本、没有 preload，
 * 剪辑、历史与保存仍只在主窗口渲染运行时。
 *
 * 前缀必须与 `electron/main/windows/video-edit-popout-policy.ts` 一致，主进程只放行该白名单。
 */
export const VIDEO_EDIT_POPOUT_FRAME_PREFIX = 'henji-video-edit-popout:'

/** 浮窗内容中由 React 渲染、可聚焦的焦点根（tabIndex=-1）。 */
export const VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE = 'data-video-edit-popout-focus'

export interface VideoEditPopoutBounds { x: number; y: number; width: number; height: number }

export interface VideoEditPopoutWindow {
  readonly window: Window
  readonly container: HTMLElement
  isVisible(): boolean
  /** 浮窗当前的外框位置与尺寸（DIP）；已关闭时为 null。 */
  readBounds(): VideoEditPopoutBounds | null
  /** 内容挂载后调用：焦点仍在 body/容器时移到焦点根。 */
  restoreFocus(): void
  focus(): void
  /** 移动/缩放窗口（渲染层看到的窗口矩形，DIP）；没有主进程代管时的兜底路径。 */
  setBounds(bounds: Partial<VideoEditPopoutBounds>): void
  /** 标题栏拖动：在屏幕坐标 `pointer` 处抓起（最大化时先还原，指针保持在标题栏同样的相对位置）。 */
  beginMove(pointer: { x: number; y: number }): void
  /** 拖动中：窗口跟随指针。 */
  moveWith(pointer: { x: number; y: number }): void
  /** 拖向主窗口停靠时收成只剩标题条／恢复原高度。 */
  setCollapsed(collapsed: boolean): void
  /** 拖动结束（未停靠）：恢复收起前的高度。 */
  endMove(): void
  /** 最大化／还原（标题栏双击）。 */
  toggleMaximized(): void
  /** 主动关闭；`onClosed` 仍只触发一次。 */
  close(): void
}

export interface OpenVideoEditPopoutOptions {
  title: string
  size: { width: number; height: number }
  /** 上次的屏幕位置（DIP）；主进程会把它校正到仍可见的显示器。 */
  position?: { x: number; y: number }
  onClosed: () => void
  onVisibilityChange: (visible: boolean) => void
  /** 用户调整浮窗尺寸时通知，便于记住位置；移动没有事件，在关闭或退出前读取。 */
  onResize?: () => void
  /**
   * 主进程代管窗口几何（桌面端）：标题栏拖动、收起、最大化交给打开它的主窗口经 IPC 请求主进程执行——
   * 渲染层 moveTo 必须完整留在当前屏幕内，拖不过显示器。不提供时用 moveTo/resizeTo 兜底（测试与浏览器）。
   */
  control?: (request: VideoEditPopoutControl) => void
}

/** 浮窗标题栏高度（DIP）；与主进程 `VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT` 同值。 */
export const VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT = 32
export type VideoEditPopoutControl =
  | { action: 'begin-move' | 'move'; x: number; y: number }
  | { action: 'end-move' | 'collapse' | 'expand' | 'toggle-maximize' }

const STYLE_SELECTOR = 'style, link[rel="stylesheet"]'

function copyAttributes(from: Element, to: Element): void {
  for (const name of to.getAttributeNames()) if (!from.hasAttribute(name)) to.removeAttribute(name)
  for (const { name, value } of Array.from(from.attributes)) if (to.getAttribute(name) !== value) to.setAttribute(name, value)
}

/**
 * 增量镜像主文档 head 中的样式：新增克隆、移除删除、内容或地址变化就地更新，
 * 不重建已加载的样式表，避免运行时注入样式时浮窗整体闪烁。
 */
function mirrorStyles(source: Document, target: Document, mirrored: Map<Element, Element>, onLoaded: () => void): void {
  const current = Array.from(source.head.querySelectorAll(STYLE_SELECTOR))
  const alive = new Set(current)
  for (const [node, clone] of mirrored) if (!alive.has(node)) { clone.remove(); mirrored.delete(node) }
  let previous: Element | null = null
  for (const node of current) {
    let clone = mirrored.get(node)
    if (!clone) {
      clone = target.importNode(node, true)
      if (clone.tagName === 'LINK') { clone.addEventListener('load', onLoaded, { once: true }); clone.addEventListener('error', onLoaded, { once: true }) }
      mirrored.set(node, clone)
    } else if (node.tagName === 'STYLE' && clone.textContent !== node.textContent) clone.textContent = node.textContent
    // about:blank 的基准地址不应被依赖：样式表一律用主文档已解析的绝对地址。
    if (node.tagName === 'LINK' && (clone as HTMLLinkElement).href !== (node as HTMLLinkElement).href) (clone as HTMLLinkElement).href = (node as HTMLLinkElement).href
    const anchor: ChildNode | null = previous ? previous.nextSibling : target.head.firstChild
    if (anchor !== clone) target.head.insertBefore(clone, anchor)
    previous = clone
  }
}

export function openVideoEditPopoutWindow(panelKey: string, options: OpenVideoEditPopoutOptions, host: Window = window): VideoEditPopoutWindow | null {
  const width = Math.max(320, Math.round(options.size.width))
  const height = Math.max(200, Math.round(options.size.height))
  const position = options.position && Number.isFinite(options.position.x) && Number.isFinite(options.position.y)
    ? `,left=${Math.round(options.position.x)},top=${Math.round(options.position.y)}` : ''
  // width/height/left/top 与 readBounds 同为窗口外框（DIP）；henjiTitle 让主进程创建时即用面板名作标题。
  const child = host.open('about:blank', `${VIDEO_EDIT_POPOUT_FRAME_PREFIX}${panelKey}`, `popup,width=${width},height=${height}${position},henjiTitle=${encodeURIComponent(options.title)}`)
  if (!child) return null
  let target: Document
  try {
    target = child.document
    if (child.location.href !== 'about:blank') throw new Error('浮窗不是受控空白页')
  } catch {
    child.close()
    return null
  }
  const source = host.document
  let closed = false
  const mirrored = new Map<Element, Element>()
  const container = target.createElement('div')
  container.className = 'fixed inset-0 flex min-h-0 flex-col bg-window text-text1 outline-none'
  // 键盘事件必须从 portal 内的 React 节点发出，才能沿 React 树冒泡到剪辑工作区唯一的快捷键
  // 处理器；焦点落在子窗 body 时 Ctrl+Z 会走浏览器原生撤销，改写输入框产生新编辑。容器本身
  // 不是 React 节点（以它为目标的事件不会分发给 React），只在内容挂载前兜底可聚焦。
  container.tabIndex = -1
  // 首批样式表加载完成前隐藏内容，避免未套用主题的瞬间画面；背景由窗口底色兜住。
  container.style.visibility = 'hidden'
  let pendingSheets = 0
  const sheetSettled = (): void => { pendingSheets = Math.max(0, pendingSheets - 1); if (pendingSheets === 0) container.style.visibility = '' }
  mirrorStyles(source, target, mirrored, sheetSettled)
  pendingSheets = Array.from(mirrored.values()).filter(clone => clone.tagName === 'LINK').length
  if (pendingSheets === 0) container.style.visibility = ''
  const revealTimer = host.setTimeout(() => { pendingSheets = 0; container.style.visibility = '' }, 2000)
  copyAttributes(source.documentElement, target.documentElement)
  copyAttributes(source.body, target.body)
  target.title = options.title
  target.body.appendChild(container)
  /** 焦点掉到 body/容器（或无焦点）时收回到 React 焦点根；正在编辑的输入框、浮窗内菜单等其他焦点不动。 */
  const reclaimFocus = (): void => {
    if (closed) return
    const active = target.activeElement
    if (active && active !== target.body && active !== target.documentElement && active !== container) return
    const root = container.querySelector<HTMLElement>(`[${VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE}]`) ?? container
    if (root !== active) root.focus({ preventScroll: true })
  }
  let reclaimTimer: number | undefined
  const focusLeft = (): void => {
    // focusout 时新焦点尚未落定，等本轮事件结束再判断。
    host.clearTimeout(reclaimTimer)
    reclaimTimer = host.setTimeout(reclaimFocus, 0)
  }
  const pointerOutside = (event: Event): void => {
    const node = event.target as Node | null
    if (node && (node === target.body || node === target.documentElement)) host.setTimeout(reclaimFocus, 0)
  }
  child.addEventListener('focus', reclaimFocus)
  target.addEventListener('focusout', focusLeft)
  target.addEventListener('mousedown', pointerOutside, true)
  reclaimFocus()

  let resyncQueued = false
  const resyncStyles = (): void => {
    resyncQueued = false
    if (!closed) mirrorStyles(source, target, mirrored, () => {})
  }
  const headObserver = new MutationObserver(() => {
    if (resyncQueued) return
    resyncQueued = true
    queueMicrotask(resyncStyles)
  })
  headObserver.observe(source.head, { childList: true, subtree: true, characterData: true, attributes: true })
  const rootObserver = new MutationObserver(() => {
    if (closed) return
    copyAttributes(source.documentElement, target.documentElement)
    copyAttributes(source.body, target.body)
    target.title = options.title
  })
  rootObserver.observe(source.documentElement, { attributes: true })
  rootObserver.observe(source.body, { attributes: true })

  const finish = (): void => {
    if (closed) return
    closed = true
    headObserver.disconnect(); rootObserver.disconnect(); host.clearTimeout(revealTimer)
    child.removeEventListener('pagehide', finish)
    child.removeEventListener('resize', resized)
    child.removeEventListener('focus', reclaimFocus)
    target.removeEventListener('focusout', focusLeft)
    target.removeEventListener('mousedown', pointerOutside, true)
    host.clearTimeout(reclaimTimer)
    target.removeEventListener('visibilitychange', visibility)
    options.onClosed()
  }
  const visibility = (): void => { if (!closed) options.onVisibilityChange(target.visibilityState === 'visible') }
  const resized = (): void => { if (!closed) options.onResize?.() }
  child.addEventListener('pagehide', finish)
  child.addEventListener('resize', resized)
  target.addEventListener('visibilitychange', visibility)

  // 无系统边框：最大化只能由宿主模拟（铺满所在显示器的可用区域），记住还原外框。
  let restoreBounds: VideoEditPopoutBounds | null = null
  const readBounds = (): VideoEditPopoutBounds | null => closed || child.closed ? null : { x: child.screenX, y: child.screenY, width: child.outerWidth, height: child.outerHeight }
  const setBounds = (bounds: Partial<VideoEditPopoutBounds>): void => {
    if (closed || child.closed) return
    const resize = bounds.width !== undefined && bounds.height !== undefined
    // 浏览器会把窗口夹在屏幕内：先按目标尺寸缩放再移动，移动后再定一次尺寸（从最大化还原时，
    // 先移动会因大窗口放不下而被夹回原处）。
    if (resize) child.resizeTo(Math.round(bounds.width!), Math.round(bounds.height!))
    if (bounds.x !== undefined && bounds.y !== undefined) child.moveTo(Math.round(bounds.x), Math.round(bounds.y))
    if (resize) child.resizeTo(Math.round(bounds.width!), Math.round(bounds.height!))
  }
  const readAvailableArea = (): VideoEditPopoutBounds | null => {
    if (closed || child.closed) return null
    const screen = child.screen as Screen & { availLeft?: number; availTop?: number }
    return { x: screen.availLeft ?? 0, y: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight }
  }
  const restoreFromMaximized = (): VideoEditPopoutBounds | null => {
    const previous = restoreBounds
    if (!previous) return null
    restoreBounds = null
    setBounds(previous)
    return previous
  }
  // 兜底路径的拖动状态：抓取时的窗口矩形与指针、收起前的高度。
  let move: { origin: VideoEditPopoutBounds; anchor: { x: number; y: number }; last: { x: number; y: number }; collapsedFrom: number | null } | null = null
  const positionAt = (pointer: { x: number; y: number }): { x: number; y: number } => move
    ? { x: move.origin.x + pointer.x - move.anchor.x, y: move.origin.y + pointer.y - move.anchor.y }
    : pointer
  const control = options.control

  return {
    window: child,
    container,
    setBounds,
    beginMove: pointer => {
      if (closed) return
      if (control) { control({ action: 'begin-move', x: pointer.x, y: pointer.y }); return }
      let origin = readBounds()
      if (!origin) return
      if (restoreBounds) {
        const area = readAvailableArea() ?? origin
        const restored = restoreFromMaximized()!
        const ratio = Math.min(1, Math.max(0, (pointer.x - area.x) / Math.max(1, area.width)))
        origin = { ...restored, x: Math.round(pointer.x - restored.width * ratio), y: Math.round(pointer.y - Math.min(VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT / 2, pointer.y - area.y)) }
        setBounds({ x: origin.x, y: origin.y })
      }
      move = { origin, anchor: pointer, last: pointer, collapsedFrom: null }
    },
    moveWith: pointer => {
      if (closed) return
      if (control) { control({ action: 'move', x: pointer.x, y: pointer.y }); return }
      if (!move) return
      move.last = pointer
      setBounds(positionAt(pointer))
    },
    setCollapsed: collapsed => {
      if (closed) return
      if (control) { control({ action: collapsed ? 'collapse' : 'expand' }); return }
      if (!move || collapsed === (move.collapsedFrom !== null)) return
      // 窗口矩形含系统的隐形边框（Windows 无边框窗口下沿约 7），标题条高度要加上它才完整露出。
      const chromeHeight = child.outerHeight - child.innerHeight
      const chrome = Number.isFinite(chromeHeight) ? Math.max(0, chromeHeight) : 0
      if (collapsed) move.collapsedFrom = move.origin.height
      setBounds({ ...positionAt(move.last), width: move.origin.width, height: collapsed ? VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT + chrome : move.collapsedFrom ?? move.origin.height })
      if (!collapsed) move.collapsedFrom = null
    },
    endMove: () => {
      if (closed) return
      if (control) { control({ action: 'end-move' }); return }
      if (move?.collapsedFrom !== null && move) setBounds({ ...positionAt(move.last), width: move.origin.width, height: move.collapsedFrom })
      move = null
    },
    toggleMaximized: () => {
      if (closed) return
      if (control) { control({ action: 'toggle-maximize' }); return }
      if (restoreFromMaximized()) return
      const current = readBounds(); const area = readAvailableArea()
      if (!current || !area) return
      restoreBounds = current
      setBounds(area)
    },
    isVisible: () => !closed && target.visibilityState === 'visible',
    restoreFocus: reclaimFocus,
    readBounds: () => closed || child.closed ? null : restoreBounds ?? readBounds(),
    focus: () => { if (!closed && !target.hasFocus()) child.focus() },
    close: () => { if (closed) return; finish(); child.close() },
  }
}
