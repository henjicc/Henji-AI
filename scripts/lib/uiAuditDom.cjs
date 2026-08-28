const UI_AUDIT_RULES = Object.freeze([
  Object.freeze({ key: 'surfaceStacks', label: '表面叠 3 层以上' }),
  Object.freeze({ key: 'lowContrast', label: '文字对比度不足' }),
  Object.freeze({ key: 'oversizedRadius', label: '内层圆角大于外层' }),
  Object.freeze({ key: 'shadowOutsideOverlay', label: '非浮层使用阴影' }),
  Object.freeze({ key: 'hiddenPositioning', label: '布局定位藏在 CSS' }),
  Object.freeze({ key: 'insetEscape', label: '工作区逃逸助手插入量' }),
  Object.freeze({ key: 'horizontalOverflow', label: '横向溢出' }),
  Object.freeze({ key: 'nestedScroll', label: '嵌套双滚动' }),
  Object.freeze({ key: 'hardTextClip', label: '文本硬裁切' }),
  Object.freeze({ key: 'smallTargets', label: '命中区小于 24px' }),
  Object.freeze({ key: 'pageTitleInconsistency', label: '页面标题字号不一致' }),
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
  const luminance = (color) => {
    const channel = (value) => {
      const normalized = value / 255
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  }
  const composite = (foreground, background) => {
    const alpha = foreground.a
    return {
      r: foreground.r * alpha + background.r * (1 - alpha),
      g: foreground.g * alpha + background.g * (1 - alpha),
      b: foreground.b * alpha + background.b * (1 - alpha),
      a: 1,
    }
  }
  const effectiveBackground = (element) => {
    let node = element
    let accumulated = null
    while (node && node !== document.documentElement) {
      const color = parseRgb(getComputedStyle(node).backgroundColor)
      if (color && color.a > 0) {
        accumulated = accumulated ? composite(accumulated, color) : color
        if (accumulated.a >= 0.999) return accumulated
      }
      node = node.parentElement
    }
    return accumulated || { r: 10, g: 10, b: 10, a: 1 }
  }
  const contrastRatio = (first, second) => {
    const firstLuminance = luminance(first)
    const secondLuminance = luminance(second)
    return (Math.max(firstLuminance, secondLuminance) + 0.05)
      / (Math.min(firstLuminance, secondLuminance) + 0.05)
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

  for (const element of all) {
    const text = directText(element)
    if (!text) continue
    const style = getComputedStyle(element)
    const foreground = parseRgb(style.color)
    if (!foreground || foreground.a < 0.05) continue
    const background = effectiveBackground(element)
    const ratio = contrastRatio(composite(foreground, background), background)
    const size = Number.parseFloat(style.fontSize)
    const bold = Number.parseInt(style.fontWeight, 10) >= 700
    const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
    if (ratio < required) {
      out.lowContrast.push({
        ratio: Math.round(ratio * 100) / 100,
        required,
        size,
        text: text.slice(0, 42),
        color: style.color,
        element: label(element),
      })
    }
  }

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
  out.lowContrast = dedupe(out.lowContrast, (item) => `${item.element}|${item.color}`, 30)
  out.oversizedRadius = dedupe(out.oversizedRadius, (item) => item.element)
  out.shadowOutsideOverlay = dedupe(out.shadowOutsideOverlay, (item) => item.element)
  out.hiddenPositioning = dedupe(out.hiddenPositioning, (item) => item.element)
  out.insetEscape = dedupe(out.insetEscape, (item) => item.element)
  out.horizontalOverflow = dedupe(out.horizontalOverflow, (item) => `${item.reason}|${item.element}`)
  out.nestedScroll = dedupe(out.nestedScroll, (item) => `${item.inner}|${item.outer}`)
  out.hardTextClip = dedupe(out.hardTextClip, (item) => item.element)
  out.smallTargets = dedupe(out.smallTargets, (item) => item.element)
  out.notes.push(`扫描可见元素 ${all.length}`)
  return out
}

module.exports = {
  UI_AUDIT_RULES,
  auditUiDom,
}
