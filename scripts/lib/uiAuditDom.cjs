const UI_AUDIT_RULES = Object.freeze([
  Object.freeze({ key: 'surfaceStacks', label: '表面叠 3 层以上' }),
  Object.freeze({ key: 'lowContrast', label: '文字与图标对比度不足（渲染后像素，见 uiContrastAudit）' }),
  Object.freeze({ key: 'oversizedRadius', label: '内层圆角大于外层' }),
  Object.freeze({ key: 'shadowOutsideOverlay', label: '非浮层使用阴影' }),
  Object.freeze({ key: 'hiddenPositioning', label: '布局定位藏在 CSS' }),
  Object.freeze({ key: 'insetEscape', label: '工作区逃逸助手插入量' }),
  Object.freeze({ key: 'horizontalOverflow', label: '横向溢出' }),
  Object.freeze({ key: 'nestedScroll', label: '嵌套双滚动' }),
  Object.freeze({ key: 'hardTextClip', label: '文本硬裁切' }),
  Object.freeze({ key: 'smallTargets', label: '命中区小于 24px' }),
  Object.freeze({ key: 'pageTitleInconsistency', label: '页面标题字号不一致' }),
  // 4.3（重要记录 012）：悬停/选中的容器里，行内控件与容器底同色，控件边界消失
  Object.freeze({ key: 'nestedSameBackground', label: '悬停或选中的容器里控件与容器同色' }),
  // 4.3：菜单选项被省略号截断（hardTextClip 豁免 ellipsis，菜单项单独判）
  Object.freeze({ key: 'menuOptionTruncated', label: '菜单选项文字被截断' }),
])

/**
 * 该函数会被 Playwright 整体序列化到渲染进程，所有辅助函数必须保持在函数内部。
 */
function auditUiDom(context = {}) {
  const out = {
    surfaceStacks: [],
    lowContrast: [],
    oversizedRadius: [],
    shadowOutsideOverlay: [],
    hiddenPositioning: [],
    insetEscape: [],
    horizontalOverflow: [],
    nestedScroll: [],
    hardTextClip: [],
    smallTargets: [],
    pageTitleInconsistency: [],
    nestedSameBackground: [],
    menuOptionTruncated: [],
    pageTitles: [],
    notes: [],
  }

  const classText = (element) => {
    if (typeof element.className === 'string') return element.className
    if (element.className && typeof element.className.baseVal === 'string') return element.className.baseVal
    return ''
  }
  const parseRgb = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || '')
    if (!match) return null
    const parts = match[1].replaceAll('/', ' ').split(/[\s,]+/).filter(Boolean).map((part) => Number.parseFloat(part))
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 }
  }
  const label = (element) => {
    const classes = classText(element).trim().replace(/\s+/g, '.').slice(0, 110)
    const id = element.id ? `#${element.id}` : ''
    const accessibleName = element.getAttribute('aria-label') || element.getAttribute('title') || ''
    return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}${accessibleName ? `[${accessibleName.slice(0, 32)}]` : ''}`
  }
  const hasHiddenAncestor = (element) => {
    let node = element
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) <= 0.01) return true
      if (node.getAttribute('aria-hidden') === 'true') return true
      node = node.parentElement
    }
    return false
  }
  const isVisible = (element) => {
    if (hasHiddenAncestor(element)) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 4
      && rect.height > 4
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth
  }
  const directText = (element) => Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || '')
    .join(' ')
    .trim()
  const dedupe = (items, key, limit = 30) => {
    const seen = new Set()
    return items.filter((item) => {
      const value = key(item)
      if (seen.has(value)) return false
      seen.add(value)
      return true
    }).slice(0, limit)
  }
  const isScrollableY = (element) => {
    const style = getComputedStyle(element)
    return ['auto', 'scroll'].includes(style.overflowY)
      && element.scrollHeight > element.clientHeight + 2
  }
  const isManagedLayoutElement = (element) => Boolean(
    element.closest('.react-flow, .henji-cameraStage-dock')
  ) || classText(element).split(/\s+/).some((name) => name.startsWith('dv-'))
  const hasHorizontalClipAncestor = (element) => {
    const rect = element.getBoundingClientRect()
    let node = element.parentElement
    while (node && node !== document.body) {
      const style = getComputedStyle(node)
      if (['hidden', 'clip'].includes(style.overflowX)) {
        const parentRect = node.getBoundingClientRect()
        if (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1) return true
      }
      node = node.parentElement
    }
    return false
  }

  const all = Array.from(document.querySelectorAll('body *')).filter(isVisible)

  const isSurface = (element) => {
    // 输入控件的边框表达可操作区域，不是结构层；把它算成一层会把
    // 「画布节点 → 参数行 → 下拉控件」误判为三层卡片。
    if (element.matches('button, input, select, textarea, [data-ui-field-control]') || element.matches('.react-flow__handle')) return false
    const style = getComputedStyle(element)
    const borderWidth = Number.parseFloat(style.borderTopWidth) || 0
    const borderColor = parseRgb(style.borderTopColor)
    const background = parseRgb(style.backgroundColor)
    return borderWidth > 0
      && borderColor
      && borderColor.a > 0.05
      && background
      && background.a > 0.05
  }
  for (const element of all) {
    if (!isSurface(element)) continue
    const chain = []
    let node = element
    while (node && node !== document.body) {
      if (isSurface(node)) chain.push(label(node))
      node = node.parentElement
    }
    if (chain.length >= 3) out.surfaceStacks.push({ depth: chain.length, chain: chain.slice(0, 5) })
  }

  // lowContrast 不在这里按 DOM 祖先链估算背景：半透明叠加、玻璃与压在媒体上的文字只有合成后
  // 的像素才是真背景。由 ui-visual-audit 调用 uiContrastAudit 截“只有背景”的图后填入。

  for (const element of all) {
    const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
    const parent = element.parentElement
    if (radius <= 0 || !parent) continue
    const parentStyle = getComputedStyle(parent)
    const parentRadius = Number.parseFloat(parentStyle.borderTopLeftRadius) || 0
    if (parentRadius > 0 && radius > parentRadius + 1 && parentStyle.overflow !== 'visible') {
      out.oversizedRadius.push({ child: radius, parent: parentRadius, element: label(element) })
    }
  }

  for (const element of all) {
    const style = getComputedStyle(element)
    if (style.boxShadow === 'none' || style.boxShadow.includes('inset')) continue
    if (/rgba?\([^)]*\)\s+0px\s+0px\s+0px\s+0px/.test(style.boxShadow)) continue
    let node = element
    let floating = false
    while (node && node !== document.body) {
      const position = getComputedStyle(node).position
      if (position === 'fixed' || position === 'absolute') {
        floating = true
        break
      }
      node = node.parentElement
    }
    if (!floating) out.shadowOutsideOverlay.push({ element: label(element), shadow: style.boxShadow.slice(0, 80) })
  }

  for (const element of all) {
    const position = getComputedStyle(element).position
    if (position !== 'fixed' && position !== 'absolute') continue
    // React Flow 与 Dockview 的定位由依赖库运行时样式管理，业务 JSX 无法也不应复制。
    if (isManagedLayoutElement(element)) continue
    const classes = classText(element)
    const positionVisibleInClass = new RegExp(`(^|\\s)!?${position}(\\s|$)`).test(classes)
    const positionVisibleInline = element.style.position === position
    if (!positionVisibleInClass && !positionVisibleInline) {
      out.hiddenPositioning.push({ position, element: label(element) })
    }
  }

  const insetRoot = document.querySelector('[data-ui-workspace-inset-root]')
  const assistant = document.querySelector('aside[aria-label="智能助手"]')
  if (insetRoot && assistant && isVisible(assistant)) {
    const rootRect = insetRoot.getBoundingClientRect()
    const rootStyle = getComputedStyle(insetRoot)
    const contentLeft = rootRect.left + (Number.parseFloat(rootStyle.paddingLeft) || 0)
    const contentRight = rootRect.right - (Number.parseFloat(rootStyle.paddingRight) || 0)
    const contentWidth = contentRight - contentLeft
    if (contentWidth < rootRect.width - 8) {
      for (const element of Array.from(insetRoot.querySelectorAll('*')).filter(isVisible)) {
        const rect = element.getBoundingClientRect()
        if (rect.width < 64 || rect.height < 24) continue
        const isPaintedLeaf = directText(element)
          || ['IMG', 'VIDEO', 'SVG', 'CANVAS'].includes(element.tagName)
        if (element.children.length === 0 && !isPaintedLeaf) continue
        if (rect.left < contentLeft - 2 || rect.right > contentRight + 2 || rect.width > contentWidth + 2) {
          out.insetEscape.push({
            bounds: [Math.round(rect.left), Math.round(rect.right)],
            expected: [Math.round(contentLeft), Math.round(contentRight)],
            element: label(element),
          })
        }
      }
    }
  }

  for (const element of all) {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    // 被明确裁切容器截住的子元素不会撑破页面；时间轴首尾拖柄和画布节点常会有意越界半格。
    const outsideViewport = (rect.left < -2 || rect.right > window.innerWidth + 2)
      && !hasHorizontalClipAncestor(element)
    const clippedContainer = element.children.length > 0
      && !directText(element)
      && rect.width >= window.innerWidth * 0.75
      && element.clientWidth > 32
      && element.scrollWidth > element.clientWidth + 2
      && ['hidden', 'clip'].includes(style.overflowX)
      && !element.matches('.react-flow')
    if (outsideViewport || clippedContainer) {
      out.horizontalOverflow.push({
        reason: outsideViewport ? 'viewport' : 'clipped-container',
        width: Math.round(rect.width),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        element: label(element),
      })
    }
  }

  for (const element of all.filter(isScrollableY)) {
    let ancestor = element.parentElement
    while (ancestor && ancestor !== document.body) {
      if (isScrollableY(ancestor)) {
        out.nestedScroll.push({ inner: label(element), outer: label(ancestor) })
        break
      }
      ancestor = ancestor.parentElement
    }
  }

  for (const element of all) {
    const text = directText(element)
    if (!text || element.clientWidth <= 0 || element.scrollWidth <= element.clientWidth + 1) continue
    const style = getComputedStyle(element)
    if (!['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis') continue
    out.hardTextClip.push({
      text: text.slice(0, 42),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      element: label(element),
    })
  }

  const targetSelector = 'button, a[href], input, select, textarea, [role="button"], [role="checkbox"], [role="switch"]'
  for (const element of Array.from(document.querySelectorAll(targetSelector)).filter(isVisible)) {
    const style = getComputedStyle(element)
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none') continue
    // 数字输入框的竖排步进箭头共享 38px/28px 字段高度，单个箭头无法达到 24px；
    // 同一控件仍提供满足尺寸要求的直接输入区与 ArrowUp/ArrowDown 等价操作，仅豁免这两个附属按钮。
    if (element.matches('[data-ui-compact-stepper-button]')) continue
    // 画布视口里的控件会随缩放矩阵一起缩放，getBoundingClientRect 不是其 CSS 命中区尺寸。
    if (element.closest('.react-flow__viewport')) continue
    const rect = element.getBoundingClientRect()
    // Chromium 在分数像素布局中会把 24px 报成 23.999…，留半像素只用于消除舍入误报。
    if (rect.width < 23.5 || rect.height < 23.5) {
      out.smallTargets.push({
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        element: label(element),
      })
    }
  }

  // —— 悬停/选中的容器里控件与容器同色（4.3）——
  // 只判“自己画了底”的交互控件：沿祖先合成出控件的实际底色，与最近一层画了底的祖先合成色比较 OKLab 距离。
  // 容器须处于悬停（:hover 链）或选中（aria-selected / aria-current / data-selected）状态；
  // 链上有 backdrop-filter（玻璃）时实际底色取决于背后内容，DOM 估算不可靠，跳过并计数。
  const srgbToLinear = (v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const toOklab = ({ r, g, b }) => {
    const lr = srgbToLinear(r); const lg = srgbToLinear(g); const lb = srgbToLinear(b)
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    const s2 = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2,
    }
  }
  const deltaE = (x, y) => {
    const p = toOklab(x); const q = toOklab(y)
    return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b)
  }
  const ownBackground = (element) => {
    const color = parseRgb(getComputedStyle(element).backgroundColor)
    return color && color.a > 0.01 ? color : null
  }
  const effectiveBackground = (element) => {
    const layers = []
    let node = element
    let glass = false
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node)
      if (style.backdropFilter && style.backdropFilter !== 'none') glass = true
      const color = ownBackground(node)
      if (color) {
        layers.push(color)
        if (color.a >= 0.999) break
      }
      node = node.parentElement
    }
    let result = { r: 0, g: 0, b: 0 }
    for (const layer of layers.reverse()) {
      result = {
        r: layer.r * layer.a + result.r * (1 - layer.a),
        g: layer.g * layer.a + result.g * (1 - layer.a),
        b: layer.b * layer.a + result.b * (1 - layer.a),
      }
    }
    return { color: result, glass }
  }
  const isActiveContainer = (element) => element.matches(':hover')
    || element.getAttribute('aria-selected') === 'true'
    || element.getAttribute('aria-current') === 'true'
    || element.getAttribute('aria-current') === 'page'
    || element.getAttribute('data-selected') === 'true'
  const controlSelector = 'button, [role="button"], [data-panel-trigger-button], [data-dropdown-button], input, select, textarea'
  let glassSkipped = 0
  for (const control of Array.from(document.querySelectorAll(controlSelector)).filter(isVisible)) {
    if (!ownBackground(control)) continue
    let container = control.parentElement
    while (container && container !== document.body && !ownBackground(container)) container = container.parentElement
    if (!container || container === document.body || !isActiveContainer(container)) continue
    const inner = effectiveBackground(control)
    const outer = effectiveBackground(container)
    if (inner.glass || outer.glass) {
      glassSkipped += 1
      continue
    }
    const distance = deltaE(inner.color, outer.color)
    if (distance < 0.02) {
      out.nestedSameBackground.push({
        deltaE: Math.round(distance * 1000) / 1000,
        element: label(control),
        container: label(container),
      })
    }
  }
  if (glassSkipped > 0) out.notes.push(`nestedSameBackground：${glassSkipped} 个控件在玻璃上，底色取决于背后内容，未判`)

  // —— 菜单选项被截断（4.3）——
  for (const option of Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible)) {
    const candidates = [option, ...Array.from(option.querySelectorAll('*'))]
    const clipped = candidates.find((element) => directText(element)
      && element.clientWidth > 0
      // 不留 1px 容差：选中项差一个亚像素就会被画成省略号（4.3 实测“休闲”→“休…”）
      && element.scrollWidth > element.clientWidth)
    if (clipped) {
      out.menuOptionTruncated.push({
        text: directText(clipped).slice(0, 42),
        scrollWidth: clipped.scrollWidth,
        clientWidth: clipped.clientWidth,
        element: label(option),
      })
    }
  }

  for (const element of Array.from(document.querySelectorAll('[data-ui-page-title]')).filter(isVisible)) {
    const style = getComputedStyle(element)
    out.pageTitles.push({
      scene: context.scene || '',
      surface: context.surface || '',
      text: (element.textContent || '').trim().slice(0, 42),
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      element: label(element),
    })
  }

  out.surfaceStacks = dedupe(out.surfaceStacks, (item) => item.chain.join('|'), 20)
  out.oversizedRadius = dedupe(out.oversizedRadius, (item) => item.element)
  out.shadowOutsideOverlay = dedupe(out.shadowOutsideOverlay, (item) => item.element)
  out.hiddenPositioning = dedupe(out.hiddenPositioning, (item) => item.element)
  out.insetEscape = dedupe(out.insetEscape, (item) => item.element)
  out.horizontalOverflow = dedupe(out.horizontalOverflow, (item) => `${item.reason}|${item.element}`)
  out.nestedScroll = dedupe(out.nestedScroll, (item) => `${item.inner}|${item.outer}`)
  out.hardTextClip = dedupe(out.hardTextClip, (item) => item.element)
  out.smallTargets = dedupe(out.smallTargets, (item) => item.element)
  out.nestedSameBackground = dedupe(out.nestedSameBackground, (item) => `${item.element}|${item.container}`)
  out.menuOptionTruncated = dedupe(out.menuOptionTruncated, (item) => item.element)
  out.notes.push(`扫描可见元素 ${all.length}`)
  return out
}

module.exports = {
  UI_AUDIT_RULES,
  auditUiDom,
}
