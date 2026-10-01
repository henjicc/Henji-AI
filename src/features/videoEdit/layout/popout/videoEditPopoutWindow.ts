/**
 * 剪辑系统浮窗的 DOM 宿主：主窗口以 `about:blank` 打开同源子窗口，把主题样式同步过去，
 * 再由主窗口 React 把面板 portal 进容器。子窗口不运行任何应用脚本、没有 preload，
 * 工程、历史与保存仍只在主窗口渲染运行时。
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
}

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
  container.className = 'fixed inset-0 flex min-h-0 flex-col bg-app text-text-dark outline-none'
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

  return {
    window: child,
    container,
    isVisible: () => !closed && target.visibilityState === 'visible',
    restoreFocus: reclaimFocus,
    readBounds: () => closed || child.closed ? null : { x: child.screenX, y: child.screenY, width: child.outerWidth, height: child.outerHeight },
    focus: () => { if (!closed && !target.hasFocus()) child.focus() },
    close: () => { if (closed) return; finish(); child.close() },
  }
}
