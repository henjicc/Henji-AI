/**
 * 遮挡与裁切的布局检查（重要记录 020）：界面巡检（`ui:tour --audit`，序列化进渲染进程）与运行时布局守卫共用这一份实现。
 *
 * - `controlClipped`：控件或文字被不滚动的祖先（`overflow: hidden / clip`，或窗口边缘）裁掉一部分。
 *   整块看不见（折叠、移出可视区）不算；被滚动容器滚出去也不算——那是滚动，不是裁切。
 * - `controlOccluded`：控件可见范围的中心或两处以上取样点被别的元素盖住，点不到。
 *   盖在上面的是浮层（菜单、弹窗、提示、z-index ≥ 30 的定位层）或吸顶行时不算：前者是打开的浮层，后者是滚动内容滑到吸顶行下面。
 *
 * 有意的裁切 / 覆盖在最近的容器上写 `data-layout-allow="clip"` / `"occlude"`（空格分隔）并在
 * `data-layout-allow-reason` 写明理由；没有理由的声明不生效。自绘滚动的区域（如时间线轨道区）标 `data-layout-scroll-region`。
 *
 * 函数会被 Playwright 整体序列化，所有辅助函数与常量必须写在函数体内，不能引用模块级变量或导入。
 */
export interface LayoutAuditIssue {
  rule: 'controlClipped' | 'controlOccluded'
  /** 元素的可读标签（标签名、类名摘要、可访问名称），也是去重与日志的签名 */
  element: string
  /** 裁掉它的祖先，或盖住它的元素 */
  by: string
  /** 被裁切的方向（裁切）或被盖住的取样点数（遮挡） */
  detail: string
  /** 元素外框 [left, top, right, bottom]（CSS 像素） */
  bounds: [number, number, number, number]
  /** 所在 Surface（最近的 data-application-surface-id） */
  surface: string
}
export interface LayoutAuditResult {
  controlClipped: LayoutAuditIssue[]
  controlOccluded: LayoutAuditIssue[]
  scanned: number
  /** 只在运行时守卫里使用（collectElements）：每条问题与它的元素；巡检序列化时不返回 */
  targets?: Array<{ issue: LayoutAuditIssue; element: Element }>
}

export function auditLayoutIssues(options: { collectElements?: boolean; root?: string } = {}): LayoutAuditResult {
  const CONTROL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="slider"], [role="combobox"], [contenteditable="true"]'
  const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-panel-scroll-region], [data-dropdown-portal="true"]'
  const SKIP = '.react-flow__viewport, [data-layout-guard-layer], [data-ui-drag-ghost]'
  const TOLERANCE = 1.5
  const result: LayoutAuditResult = { controlClipped: [], controlOccluded: [], scanned: 0 }
  const targets: Array<{ issue: LayoutAuditIssue; element: Element }> = []
  const report = (issue: LayoutAuditIssue, element: Element): void => {
    result[issue.rule].push(issue)
    if (options.collectElements) targets.push({ issue, element })
  }
  const root = (options.root ? document.querySelector(options.root) : document.body) ?? document.body
  const styles = new Map<Element, CSSStyleDeclaration>()
  const style = (element: Element): CSSStyleDeclaration => {
    let value = styles.get(element)
    if (!value) { value = getComputedStyle(element); styles.set(element, value) }
    return value
  }
  const classText = (element: Element): string => {
    const value = (element as HTMLElement).className as unknown
    if (typeof value === 'string') return value
    if (value && typeof (value as SVGAnimatedString).baseVal === 'string') return (value as SVGAnimatedString).baseVal
    return ''
  }
  const label = (element: Element): string => {
    const classes = classText(element).trim().split(/\s+/).filter(name => name && !name.includes(':') && !name.includes('[')).slice(0, 4).join('.')
    const name = element.getAttribute('aria-label') || element.getAttribute('data-video-edit-property-row') || (element.textContent || '').trim().slice(0, 24)
    const data = ['data-video-edit-clip', 'data-gallery-rule-sample', 'data-video-edit-keyframe-lane'].find(key => element.hasAttribute(key))
    const sample = element.closest('[data-gallery-rule-sample]')
    return `${sample ? `#${sample.id} / ` : ''}${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${data ? `[${data}]` : ''}${name ? `「${name.replace(/\s+/g, ' ')}」` : ''}`
  }
  const allowed = (element: Element, kind: 'clip' | 'occlude'): boolean => {
    let node: Element | null = element
    while (node) {
      const allow = node.getAttribute('data-layout-allow')
      if (allow && allow.split(/\s+/).includes(kind) && (node.getAttribute('data-layout-allow-reason') || '').trim().length >= 4) return true
      node = node.parentElement
    }
    return false
  }
  const hidden = (element: Element): boolean => {
    let node: Element | null = element
    while (node && node !== document.documentElement) {
      const value = style(node)
      if (value.display === 'none' || value.visibility === 'hidden' || value.visibility === 'collapse' || Number.parseFloat(value.opacity) <= 0.01) return true
      if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) return true
      node = node.parentElement
    }
    return false
  }
  const scrolls = (element: Element, axis: 'x' | 'y'): boolean => {
    if (element.hasAttribute('data-layout-scroll-region')) return true
    const overflow = axis === 'x' ? style(element).overflowX : style(element).overflowY
    return overflow === 'auto' || overflow === 'scroll'
  }
  const clips = (element: Element, axis: 'x' | 'y'): boolean => {
    const overflow = axis === 'x' ? style(element).overflowX : style(element).overflowY
    return overflow === 'hidden' || overflow === 'clip'
  }
  /**
   * 元素真正可见的范围：逐层与祖先求交。滚动容器（含自绘滚动区）挡住的部分是滚动，不追究；
   * 不滚动的裁切祖先（`overflow: hidden / clip`）与窗口边缘挡住的部分才是裁切，记下是谁裁的。
   * 省略号截断容器（`text-overflow: ellipsis`）裁掉的是截断，交给 shortTextTruncated，不算裁切。
   */
  const visibleRect = (element: Element): { rect: DOMRect; left: number; top: number; right: number; bottom: number; lost: number; by: string; axis: string } => {
    const rect = element.getBoundingClientRect()
    let left = rect.left; let top = rect.top; let right = rect.right; let bottom = rect.bottom
    let lost = 0; let by = ''; let axis = ''
    const cut = (next: { left: number; top: number; right: number; bottom: number }, blame: string): void => {
      const before = { left, top, right, bottom }
      left = Math.max(left, next.left); right = Math.min(right, next.right); top = Math.max(top, next.top); bottom = Math.min(bottom, next.bottom)
      if (!blame || right - left <= 1 || bottom - top <= 1) return
      const lostX = Math.max(left - before.left, before.right - right); const lostY = Math.max(top - before.top, before.bottom - bottom)
      const amount = Math.max(lostX, lostY)
      if (amount > TOLERANCE && amount > lost) { lost = amount; by = blame; axis = lostX > TOLERANCE && lostY > TOLERANCE ? 'xy' : lostX > TOLERANCE ? 'x' : 'y' }
    }
    if (style(element).position === 'fixed') { cut({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }, '窗口边缘'); return { rect, left, top, right, bottom, lost, by, axis } }
    // 绝对定位元素只受它的包含块及更外层的裁切：中间不定位的祖先的 overflow 管不到它
    let skipUntil: Element | null = style(element).position === 'absolute' ? (element as HTMLElement).offsetParent : null
    let node = element.parentElement
    while (node && node !== document.documentElement) {
      if (skipUntil && node !== skipUntil) { node = node.parentElement; continue }
      skipUntil = null
      const box = node.getBoundingClientRect()
      const edge = (value: string): number => Number.parseFloat(value) || 0
      const value = style(node)
      const inner = { left: box.left + edge(value.borderLeftWidth), top: box.top + edge(value.borderTopWidth), right: box.right - edge(value.borderRightWidth), bottom: box.bottom - edge(value.borderBottomWidth) }
      const open = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
      const truncation = value.textOverflow === 'ellipsis'
      const xScroll = scrolls(node, 'x'); const yScroll = scrolls(node, 'y')
      const xClip = !xScroll && clips(node, 'x'); const yClip = !yScroll && clips(node, 'y')
      if (xScroll || yScroll) cut({ ...open, ...(xScroll ? { left: inner.left, right: inner.right } : {}), ...(yScroll ? { top: inner.top, bottom: inner.bottom } : {}) }, '')
      if (xClip || yClip) cut({ ...open, ...(xClip ? { left: inner.left, right: inner.right } : {}), ...(yClip ? { top: inner.top, bottom: inner.bottom } : {}) }, truncation ? '' : label(node))
      if (value.position === 'fixed') break
      if (value.position === 'absolute') skipUntil = (node as HTMLElement).offsetParent
      node = node.parentElement
    }
    cut({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }, '窗口边缘')
    return { rect, left, top, right, bottom, lost, by, axis }
  }
  const surface = (element: Element): string => element.closest('[data-application-surface-id]')?.getAttribute('data-application-surface-id') ?? ''
  const bounds = (rect: DOMRect): [number, number, number, number] => [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)]
  const isOverlay = (element: Element): boolean => {
    let node: Element | null = element
    while (node && node !== document.body) {
      if (node.matches(OVERLAY)) return true
      const value = style(node)
      if ((value.position === 'fixed' || value.position === 'absolute') && Number.parseInt(value.zIndex, 10) >= 30) return true
      node = node.parentElement
    }
    return false
  }
  /** 最近的吸顶容器；data-layout-pinned：自绘的吸顶行（如时间线顶部固定的字幕轨），与 position: sticky 同等对待 */
  const stickyContainer = (element: Element): Element | null => {
    let node: Element | null = element
    while (node && node !== document.body) {
      if (style(node).position === 'sticky' || node.hasAttribute('data-layout-pinned')) return node
      node = node.parentElement
    }
    return null
  }
  const directText = (element: Element): string => Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || '').join('').trim()

  const controls = Array.from(root.querySelectorAll(CONTROL))
  const texts = Array.from(root.querySelectorAll('span, p, label, h1, h2, h3, h4, h5, h6, td, th, li, dt, dd, div')).filter(element => directText(element).length > 0 && !element.closest(CONTROL))
  const seen = new Set<Element>()
  for (const element of [...controls, ...texts]) {
    if (seen.has(element)) continue
    seen.add(element)
    if (element.closest(SKIP) || hidden(element)) continue
    const own = element.getBoundingClientRect()
    if (own.width < 2 || own.height < 2) continue
    const control = element.matches(CONTROL)
    if (control && style(element).pointerEvents === 'none') continue
    result.scanned += 1
    const visible = visibleRect(element)
    const width = visible.right - visible.left; const height = visible.bottom - visible.top
    // 整块看不见（折叠、滚出、移出可视区）不是裁切问题；被不滚动的祖先裁掉一截才是。
    if (width <= 1 || height <= 1) continue
    // 时间轴件与画面操纵件随缩放、平移伸出可视区是常态（片段名、逐词块、伸出画布的控制点），不算裁切
    if (visible.lost > TOLERANCE && !allowed(element, 'clip') && !element.closest('[data-ui-timeline-item], [data-ui-manipulator]')) {
      report({ rule: 'controlClipped', element: label(element), by: visible.by, detail: `${visible.axis} 方向裁掉 ${Math.round(visible.lost)}px`, bounds: bounds(own), surface: surface(element) }, element)
      continue
    }
    if (!control || allowed(element, 'occlude')) continue
    // 遮挡：可见范围的中心与四个内点取样，看命中的最上层元素是不是它自己（或它的子元素 / 祖先）。
    const inset = Math.min(3, width / 4, height / 4)
    const points: Array<[number, number]> = [[(visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2],
      [visible.left + inset, visible.top + inset], [visible.right - inset, visible.top + inset], [visible.left + inset, visible.bottom - inset], [visible.right - inset, visible.bottom - inset]]
    let blocked = 0; let centerBlocked = false; let occluder: Element | null = null
    points.forEach(([x, y], index) => {
      const hit = document.elementFromPoint(x, y)
      if (!hit || hit === element || element.contains(hit) || hit.contains(element)) return
      // 守卫自己的描边层、面板分隔条、拖动手柄与悬浮滚动条压在边缘上不算遮挡
      if (hit.closest('[data-layout-guard-layer], .dv-sash, .dv-scrollbar, [role="separator"]')) return
      // 同一个字段控件的组成部分（读数盖在输入框上、标签与控件）不算遮挡
      const field = element.closest('[data-ui-field-control], label')
      if (field && field.contains(hit)) return
      if (isOverlay(hit) && !isOverlay(element)) return
      // 内容滑到吸顶 / 固定行下面：盖住它的吸顶容器不包含它（横向吸附的轨道头被纵向固定的字幕轨盖住也算这种）
      const pinned = stickyContainer(hit)
      if (pinned && !pinned.contains(element)) return
      // 时间轴上同一个片段内部的件、画面上同一组操纵件互相压着（缩放后很窄或很小）：不算遮挡
      const item = element.closest('[data-ui-timeline-item], [data-ui-manipulator]')
      if (item && item.contains(hit)) return
      blocked += 1
      if (index === 0) centerBlocked = true
      occluder ??= hit
    })
    // 角上压着小部件（淡化手柄、角标）是常见设计：中心被盖或五点里三点以上被盖才算
    if (occluder && (centerBlocked || blocked >= 3)) {
      report({ rule: 'controlOccluded', element: label(element), by: label(occluder), detail: `${blocked}/5 个取样点被盖住`, bounds: bounds(own), surface: surface(element) }, element)
    }
  }
  const dedupe = (items: LayoutAuditIssue[], limit = 40): LayoutAuditIssue[] => {
    const keys = new Set<string>()
    return items.filter(item => { const key = `${item.element}|${item.by}`; if (keys.has(key)) return false; keys.add(key); return true }).slice(0, limit)
  }
  if (!options.collectElements) {
    result.controlClipped = dedupe(result.controlClipped)
    result.controlOccluded = dedupe(result.controlOccluded)
  } else result.targets = targets
  return result
}
