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
  Object.freeze({ key: 'rowHeightMismatch', label: '同行外框高度或中心线不一致' }),
  Object.freeze({ key: 'actionStartsAtLabelColumn', label: '面板动作从标签列起头' }),
  Object.freeze({ key: 'formControlMisaligned', label: '面板控件列未对齐' }),
  Object.freeze({ key: 'multiplePrimary', label: '同一表面多个主动作' }),
  Object.freeze({ key: 'pageTitleInconsistency', label: '页面标题字号不一致' }),
  // 4.3（重要记录 012）：悬停/选中的容器里，行内控件与容器底同色，控件边界消失
  Object.freeze({ key: 'nestedSameBackground', label: '悬停或选中的容器里控件与容器同色' }),
  // 4.3：菜单选项被省略号截断（hardTextClip 豁免 ellipsis，菜单项单独判）
  Object.freeze({ key: 'menuOptionTruncated', label: '菜单选项文字被截断' }),
  // 5.8：条带数量（原 4.2 B 段，skill「页面骨架：横向条带」）与其余四条，判据见 skill references/review.md 第 7 节
  Object.freeze({ key: 'stackedBands', label: '横向条带连续超过 2 条' }),
  Object.freeze({ key: 'toolbarWrap', label: '工具条或底栏折行' }),
  Object.freeze({ key: 'shortTextTruncated', label: '常见短文案被截断' }),
  Object.freeze({ key: 'selectedStateWeak', label: '选中态与静息态差异不足' }),
  Object.freeze({ key: 'overlayClipped', label: '浮层被裁切' }),
  // 重要记录 020：控件与文字被不滚动的容器裁掉一截、被别的元素盖住点不到。实现在 src/core/uiAudit/layoutAudit.ts
  //（运行时布局守卫共用），由 uiLayoutAudit.cjs 与 auditUiDom 的结果合并。
  Object.freeze({ key: 'controlClipped', label: '控件或文字被容器裁掉一截' }),
  Object.freeze({ key: 'controlOccluded', label: '控件被别的元素盖住' }),
])

/** 5.8 新规则的判定阈值（auditUiDom 内有同值副本，精确测试比对；改动同步 references/review.md 第 7 节）。 */
const UI_AUDIT_THRESHOLDS = Object.freeze({
  /** 条带：高 24–64、至少占父容器宽 90%，上下相接（缝 ≤ 2px）连成一串，> 2 条即命中 */
  bandMinHeight: 24,
  bandMaxHeight: 64,
  bandMinWidthRatio: 0.9,
  bandMaxCount: 2,
  /** 短文案：全文不超过 16 个字符的省略号截断才算“常见文本截断”（长的用户内容截断是设计） */
  shortTextMaxLength: 16,
  /** 选中与静息的 OKLab 距离：底色、文字色、描边三者最大值低于它、且无勾/阴影/字重等其他差异即命中 */
  selectedMinDeltaE: 0.03,
  rowTolerance: 1,
  smallTargetMin: 24,
  compactIconMin: 20,
})

/**
 * 该函数会被 Playwright 整体序列化到渲染进程，所有辅助函数必须保持在函数内部。
 */
function auditUiDom(context = {}) {
  // 序列化进渲染进程后拿不到模块级常量，阈值在函数内重复一份（与 UI_AUDIT_THRESHOLDS 一致，精确测试比对）
  const T = { bandMinHeight: 24, bandMaxHeight: 64, bandMinWidthRatio: 0.9, bandMaxCount: 2, shortTextMaxLength: 16, selectedMinDeltaE: 0.03, rowTolerance: 1, smallTargetMin: 24, compactIconMin: 20 }
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
    rowHeightMismatch: [],
    actionStartsAtLabelColumn: [],
    formControlMisaligned: [],
    multiplePrimary: [],
    scrollRegions: [],
    pageTitleInconsistency: [],
    nestedSameBackground: [],
    menuOptionTruncated: [],
    stackedBands: [],
    toolbarWrap: [],
    shortTextTruncated: [],
    selectedStateWeak: [],
    overlayClipped: [],
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
    const sample = element.closest('[data-gallery-rule-sample]')
    return `${sample ? `#${sample.id} / ` : ''}${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}${accessibleName ? `[${accessibleName.slice(0, 32)}]` : ''}`
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
  /** 中心页样张（连同里面定位出去的浮层）整块落在目录滚动区的可见范围内：半截滚出时不对账，也不报滚动造成的浮层裁切 */
  const sampleFullyInView = (sample) => {
    let scroller = sample.parentElement
    while (scroller && scroller !== document.body && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    const area = scroller && scroller !== document.body ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
    const own = sample.getBoundingClientRect()
    let top = own.top; let bottom = own.bottom
    for (const child of sample.querySelectorAll('*')) { const box = child.getBoundingClientRect(); if (box.width > 0 && box.height > 0) { top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom) } }
    return top >= Math.max(0, area.top) && bottom <= Math.min(window.innerHeight, area.bottom)
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

  // 展示样本与断牙反例不同：仅中心页分区内有理由的局部区域可以声明具体规则。
  // 页面根、整个分区、生产表面及通配符均不获得豁免；像素对比度不走此机制。
  const galleryExemptions = new Map()
  const ignoresGalleryRule = (element, rule) => {
    const gallery = element.closest('[data-application-surface-id="dev.ui_gallery"]')
    const section = element.closest('[data-gallery-section]')
    if (!gallery || !section) return false
    let region = element
    while (region && region !== section && region !== gallery) {
      const reason = region.getAttribute('data-gallery-ignore-reason')?.trim()
      if (reason && (region.getAttribute('data-gallery-ignore-rules') || '').split(/\s+/).includes(rule)) {
        if (!galleryExemptions.has(region)) galleryExemptions.set(region, { element: label(region), reason, rules: new Set() })
        galleryExemptions.get(region).rules.add(rule)
        return true
      }
      region = region.parentElement
    }
    return false
  }

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
    // 圆形与胶囊（圆角 ≥ 半高）是形状不是容器转角：封面正中的播放键、角上的徽标不按同心圆角判
    const own = element.getBoundingClientRect()
    if (own.height > 0 && radius >= Math.min(own.width, own.height) / 2 - 0.5) continue
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
    // 键盘焦点环（ring 用 box-shadow 画）不是表面层级阴影；组件样张页的强制聚焦态等同真实聚焦（任务 5.11）
    if (element.matches(':focus-visible, .henji-gallery-force-focus')) continue
    // 阴影正在过渡（失焦后焦点环淡出那 120ms）截到的是中间值，不是静止的层级阴影
    if (typeof element.getAnimations === 'function' && element.getAnimations().some((animation) => animation.playState === 'running')) continue
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
    if (!floating && !ignoresGalleryRule(element, 'shadowOutsideOverlay')) out.shadowOutsideOverlay.push({ element: label(element), shadow: style.boxShadow.slice(0, 80) })
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
      && !element.matches('.react-flow, [data-layout-scroll-region]')
    if ((outsideViewport || clippedContainer) && !ignoresGalleryRule(element, 'horizontalOverflow')) {
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
    if (ignoresGalleryRule(element, 'nestedScroll')) continue
    // 多行输入框（textarea、富文本编辑器）限高后在框内滚动是输入框自身的行为，不是页面布局套了两层滚动
    if (element.matches('textarea, [contenteditable="true"]') || element.closest('[data-ui-field-control]')) continue
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
    // 渐隐遮罩（mask-image，画布节点标题）是另一种截断提示：尾部淡出，不算硬裁
    const mask = style.maskImage || style.webkitMaskImage || ''
    if (mask && mask !== 'none') continue
    out.hardTextClip.push({
      text: text.slice(0, 42),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      element: label(element),
    })
  }

  // 数值框的读数放不下：输入框内文字被裁掉（生成页底栏“1024”显示成“102”）。文本框里长内容横向滚动是常态，只查数值框。
  for (const element of all.filter((node) => node.matches('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]') && isVisible(node))) {
    if (!element.value || element.clientWidth <= 0 || element.scrollWidth <= element.clientWidth + 1) continue
    out.hardTextClip.push({ text: String(element.value).slice(0, 42), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, element: label(element) })
  }

  // 文字跑出自己的控件：控件不裁切（overflow 可见）时文字压到旁边的控件上。分段选项在窄面板里每段只剩 22px，
  // “标准健壮纤细儿童”叠成一串（重要记录 020）。只量文字本身的排版框，被内层截断容器裁住的文字不算。
  for (const element of all.filter((node) => node.matches('button, [role="button"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"]'))) {
    if (element.scrollWidth <= element.clientWidth + 1) continue
    const style = getComputedStyle(element)
    if (['hidden', 'clip'].includes(style.overflowX)) continue
    const box = element.getBoundingClientRect()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let spill = 0
    let spilledText = ''
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!(node.textContent || '').trim() || !node.parentElement) continue
      let clipped = false
      for (let ancestor = node.parentElement; ancestor && ancestor !== element; ancestor = ancestor.parentElement) {
        if (['hidden', 'clip'].includes(getComputedStyle(ancestor).overflowX)) { clipped = true; break }
      }
      if (clipped) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      if (typeof range.getClientRects !== 'function') continue
      for (const rect of range.getClientRects()) {
        const outside = Math.max(box.left - rect.left, rect.right - box.right)
        if (outside > spill) { spill = outside; spilledText = (node.textContent || '').trim() }
      }
    }
    if (spill > 1.5) out.hardTextClip.push({ reason: 'spill', text: spilledText.slice(0, 42), spill: Math.round(spill), element: label(element) })
  }

  const targetSelector = 'button, a[href], input, select, textarea, [role="button"], [role="checkbox"], [role="switch"]'
  for (const element of Array.from(document.querySelectorAll(targetSelector)).filter(isVisible)) {
    if (ignoresGalleryRule(element, 'smallTargets')) continue
    const style = getComputedStyle(element)
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none') continue
    // 数字输入框的竖排步进箭头共享 38px/28px 字段高度，单个箭头无法达到 24px；
    // 同一控件仍提供满足尺寸要求的直接输入区与 ArrowUp/ArrowDown 等价操作，仅豁免这两个附属按钮。
    if (element.matches('[data-ui-compact-stepper-button]')) continue
    // WCAG 2.5.8 行内例外：句子里的链接档按钮与逐字稿行内词块，高度受行高约束（任务 5.11 样张页首次覆盖到）
    if (element.matches('[data-variant="link"], [data-text-token="inline"]')) continue
    // 正文里的行内链接（助手回答、说明文字的 Markdown 链接）同属 WCAG 行内例外：display 为 inline 的 a 不按 24px 判
    if (element.matches('a[href]') && style.display === 'inline') continue
    // 画布视口里的控件会随缩放矩阵一起缩放，getBoundingClientRect 不是其 CSS 命中区尺寸。
    if (element.closest('.react-flow__viewport')) continue
    // 时间轴上的片段、字幕块、标记、关键帧（data-ui-timeline-item）：宽度随缩放变化或是点状记号，按时间轴习惯（PR）不按 24px 判
    if (element.closest('[data-ui-timeline-item], [data-ui-manipulator]')) continue
    const rect = element.getBoundingClientRect()
    // Chromium 在分数像素布局中会把 24px 报成 23.999…，留半像素只用于消除舍入误报。
    const minimum = element.matches('button.ui-btn[data-tone][data-size="2xs"]') ? T.compactIconMin : T.smallTargetMin
    if (rect.width < minimum - 0.5 || rect.height < minimum - 0.5) {
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
  // :hover 也会匹配工作区、页壳等所有祖先；只有交互容器或声明悬停表面的容器才有悬停态。
  const isActiveContainer = (element) => (element.matches(':hover')
    && (element.matches('button, a[href], [role="button"], [role="option"], [role="row"], [role="listitem"], [tabindex]')
      || /(?:^|\s)(?:hover:|group-hover:)bg-/.test(classText(element))))
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



  const surfaceSelector = '[role="dialog"], [data-ui-toolbar], [data-command-bar], [data-application-surface-id]'
  for (const surface of all.filter(element => element.matches(surfaceSelector))) {
    const primary = [...surface.querySelectorAll('[data-variant="primary"], [data-tone="accent"]')]
      .filter(element => isVisible(element) && element.closest(surfaceSelector) === surface && !ignoresGalleryRule(element, 'multiplePrimary'))
    if (primary.length > 1) out.multiplePrimary.push({ element: label(surface), count: primary.length })
  }
  const rowSelector = '[role="toolbar"], [data-ui-toolbar], [data-command-bar], [data-ui-form-control], [data-ui-action-group]'
  const frameSelector = '[data-ui-segmented], [data-ui-readout], [data-ui-field-control], [data-ui-search-input], [role="radiogroup"]'
  for (const row of all.filter(element => element.matches(rowSelector))) {
    if (row.getAttribute('aria-orientation') === 'vertical' || getComputedStyle(row).flexDirection === 'column') continue
    const frames = [...new Set([...row.querySelectorAll(`${targetSelector}, ${frameSelector}`)].map(element => element.closest(frameSelector) || element))]
      .filter(element => isVisible(element) && row.contains(element) && element.closest(rowSelector) === row
        && !element.matches('[data-size="xl"], [data-ui-compact-stepper-button], [data-variant="link"]'))
    if (frames.length < 2) continue
    const rects = frames.map(element => element.getBoundingClientRect())
    // 包含多排字段的容器由 toolbarWrap 处理；这里比较同一水平带的外框。
    if (Math.max(...rects.map(rect => rect.top)) >= Math.min(...rects.map(rect => rect.bottom))) continue
    // 滑杆、复选框、开关的外框只是命中区（看得见的是细轨道或小方框）：只比中心线，不比高度（与 28 / 32 高的字段同行是常态）
    const sized = frames.map(element => !element.matches('input[type="range"], [role="checkbox"], [role="switch"]'))
    const heights = rects.map(rect => rect.height)
    const comparedHeights = heights.filter((_, index) => sized[index])
    const centers = rects.map(rect => rect.top + rect.height / 2)
    if ((comparedHeights.length > 1 && Math.max(...comparedHeights) - Math.min(...comparedHeights) > T.rowTolerance) || Math.max(...centers) - Math.min(...centers) > T.rowTolerance) {
      // 点名“不合群”的件：高度或中心线偏离同行多数值的那几个（重要记录 020，便于直接定位）
      const mode = (values) => { const counts = new Map(); for (const value of values) { const key = Math.round(value); counts.set(key, (counts.get(key) || 0) + 1) } return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] }
      const usualHeight = comparedHeights.length ? mode(comparedHeights) : 0; const usualCenter = mode(centers)
      const outliers = frames.filter((_, index) => (sized[index] && Math.abs(heights[index] - usualHeight) > T.rowTolerance) || Math.abs(centers[index] - usualCenter) > T.rowTolerance).map(element => label(element)).slice(0, 6)
      out.rowHeightMismatch.push({ element: label(row), heights, centers, outliers })
    }
  }
  for (const group of all.filter(element => element.matches('[data-ui-group]'))) {
    const controls = [...group.querySelectorAll('[data-ui-form-row="panel"] [data-ui-form-control]')]
      .filter(element => isVisible(element) && element.closest('[data-ui-group]') === group)
    if (!controls.length) continue
    const lefts = controls.map(element => element.getBoundingClientRect().left)
    if (Math.max(...lefts) - Math.min(...lefts) > T.rowTolerance) out.formControlMisaligned.push({ element: label(group), lefts })
    for (const button of group.querySelectorAll('button, a[href], [role="button"]')) {
      // 展开 / 收起子分组的开关（aria-expanded，不弹菜单）是分组标题，不是行外动作，从标签列起头是对的
      if (!isVisible(button) || button.closest('[data-ui-group]') !== group || button.closest('[data-ui-form-row], [data-ui-field-control]') || button.matches('[data-ui-compact-stepper-button], [aria-expanded]:not([aria-haspopup])')) continue
      if (button.getBoundingClientRect().left < Math.min(...lefts) - T.rowTolerance) out.actionStartsAtLabelColumn.push({ element: label(button), controlLeft: Math.min(...lefts) })
    }
  }
  // 记录完整滚动尺寸，不以视口外子项是否可见推断内容高度；执行器按捕获区间检查漏截。
  for (const region of all.filter(isScrollableY)) {
    const rect = region.getBoundingClientRect()
    out.scrollRegions.push({ element: label(region), id: region.getAttribute('data-ui-scroll-key') || region.querySelector('[data-gallery-section]')?.getAttribute('data-gallery-section') || region.id || '',
      scrollTop: region.scrollTop, scrollHeight: region.scrollHeight, clientHeight: region.clientHeight,
      visibleOffset: Math.max(0, -rect.top),
      visibleHeight: Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) })
  }
  const visibleBorder = (style, side) => (Number.parseFloat(style[`border${side}Width`]) || 0) > 0
    && (parseRgb(style[`border${side}Color`])?.a ?? 0) > 0.05
  const hasScrollAncestor = (element) => {
    let node = element.parentElement
    while (node && node !== document.body) {
      // 开发规范样本各自模拟独立工作面，目录滚动不属于样本内部结构。
      if (node.hasAttribute('data-gallery-rule-sample')) return false
      const style = getComputedStyle(node)
      if (['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflowX)) return true
      node = node.parentElement
    }
    return false
  }

  // —— 横向条带连续超过 2 条（5.8，原 4.2 B 段）——
  // 条带：不在滚动区里（内容行不算）、高 24–64、几乎占满父容器宽，且自己画了分隔（上/下边线、
  // 与父容器不同的底色）或是命令带 / 工具条 / 页头；上下相接的条带连成一串，超过 2 条即命中。
  const bandSelector = '[data-command-bar], [data-command-subordinate], [role="toolbar"], [data-ui-toolbar], [data-ui-page-header]'
  const bands = []
  for (const element of all) {
    // 无边框窗口的标题栏（日志窗口等独立窗口）是窗口外壳，不是视图里的操作条带
    if (element.closest('.react-flow, [data-window-titlebar]')) continue
    const rect = element.getBoundingClientRect()
    if (rect.height < T.bandMinHeight || rect.height > T.bandMaxHeight) continue
    const parent = element.parentElement
    if (!parent) continue
    const parentRect = parent.getBoundingClientRect()
    if (parentRect.width < 320 || rect.width < parentRect.width * T.bandMinWidthRatio) continue
    const style = getComputedStyle(element)
    if (style.position === 'absolute' || style.position === 'fixed') continue
    const distinctBg = Boolean(ownBackground(element))
      && deltaE(effectiveBackground(element).color, effectiveBackground(parent).color) >= 0.02
    const marked = element.matches(bandSelector)
    if (!marked && !visibleBorder(style, 'Bottom') && !visibleBorder(style, 'Top') && !distinctBg) continue
    if (!element.querySelector('button, [role="button"], input, select, a[href], [role="tab"]') && !directText(element)) continue
    if (hasScrollAncestor(element)) continue
    bands.push({ element, rect })
  }
  // 同一块区域（父子同框）只算一次：保留最外层
  const distinctBands = bands.filter((band) => !bands.some((other) => other !== band
    && other.element.contains(band.element)
    && Math.abs(other.rect.top - band.rect.top) <= 2 && Math.abs(other.rect.bottom - band.rect.bottom) <= 2))
  distinctBands.sort((a, b) => a.rect.top - b.rect.top)
  const chains = []
  for (const band of distinctBands) {
    const chain = chains.find((items) => {
      const last = items[items.length - 1]
      const gap = band.rect.top - last.rect.bottom
      const overlap = Math.min(band.rect.right, last.rect.right) - Math.max(band.rect.left, last.rect.left)
      return gap >= -1 && gap <= 2 && overlap >= Math.max(band.rect.width, last.rect.width) * T.bandMinWidthRatio
        && !last.element.contains(band.element) && !band.element.contains(last.element)
    })
    if (chain) chain.push(band)
    else chains.push([band])
  }
  for (const chain of chains.filter((items) => items.length > T.bandMaxCount)) {
    out.stackedBands.push({
      count: chain.length,
      top: Math.round(chain[0].rect.top),
      bands: chain.map((band) => `${Math.round(band.rect.height)}px ${label(band.element)}`).slice(0, 6),
    })
  }

  // —— 工具条与底栏折行（5.8）——
  // 工具条：命令带、从属带、role=toolbar、UiToolbar、溢出收纳行。直接子项排成多行，或子项文字折成两行即命中。
  const toolbarSelector = '[data-command-bar], [data-command-subordinate], [role="toolbar"], [data-ui-toolbar], [data-ui-overflow-row]'
  const textLineCount = (node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const tops = new Set()
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top))
    }
    return tops.size
  }
  for (const toolbar of Array.from(document.querySelectorAll(toolbarSelector)).filter(isVisible)) {
    const items = Array.from(toolbar.children).filter((child) => {
      if (!isVisible(child)) return false
      const position = getComputedStyle(child).position
      return position !== 'absolute' && position !== 'fixed'
    }).map((child) => ({ child, rect: child.getBoundingClientRect() }))
    // 竖排工具条（工具栏竖条、aria-orientation=vertical）子项本来就上下排，折行是排成多列
    const toolbarStyle = getComputedStyle(toolbar)
    const vertical = toolbar.getAttribute('aria-orientation') === 'vertical'
      || (toolbarStyle.display.includes('flex') && toolbarStyle.flexDirection.startsWith('column'))
    const wrapped = vertical
      ? items.some((item) => items.some((other) => other !== item && other.rect.left >= item.rect.right - 1))
      : items.some((item) => items.some((other) => other !== item && other.rect.top >= item.rect.bottom - 1))
    if (wrapped) {
      out.toolbarWrap.push({ reason: 'items', rows: new Set(items.map((item) => Math.round(item.rect.top))).size, element: label(toolbar) })
      continue
    }
    const walker = document.createTreeWalker(toolbar, NodeFilter.SHOW_TEXT)
    let wrappedText = null
    while (!wrappedText && walker.nextNode()) {
      const node = walker.currentNode
      if (!(node.textContent || '').trim() || !node.parentElement || !isVisible(node.parentElement)) continue
      if (textLineCount(node) > 1) wrappedText = node
    }
    if (wrappedText) {
      out.toolbarWrap.push({ reason: 'label', text: (wrappedText.textContent || '').trim().slice(0, 42), element: label(toolbar) })
    }
  }

  // —— 常见短文案被截断（5.8）——
  // 省略号截断本身是长内容（文件名、提示词、用户命名）的设计；全文不超过 16 字的界面文案被截断才算缺陷。
  // 用户内容（data-observation-sensitive / data-user-content）与菜单选项（menuOptionTruncated 单独判）除外。
  for (const element of all) {
    // 截断容器里文字常包在一层提示 / 标签元素里（属性行名称的 UiTooltipText）：只有一个子元素时按整段文字算
    const text = directText(element) || (element.childElementCount === 1 ? (element.textContent || '').trim() : '')
    if (!text || text.length > T.shortTextMaxLength) continue
    const style = getComputedStyle(element)
    if (style.textOverflow !== 'ellipsis' || !['hidden', 'clip'].includes(style.overflowX)) continue
    if (element.scrollWidth <= element.clientWidth) continue
    // 时间轴件（片段名、字幕块）的宽度随缩放变化，截断是常态（重要记录 020）
    if (element.closest('[data-observation-sensitive], [data-user-content], [role="option"], [data-ui-timeline-item]')) continue
    out.shortTextTruncated.push({ text, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, element: label(element) })
  }

  // —— 选中态与静息态差异不足（5.8）——
  // 同一组兄弟选项里，选中项与未选中项的底色、文字色、描边（OKLab）都几乎一样，且没有勾、阴影、字重等其他差异。
  const selectedSelector = '[aria-selected="true"], [aria-pressed="true"], [aria-current="page"], [aria-current="true"], [data-selected="true"], [role="radio"][aria-checked="true"], [role="menuitemradio"][aria-checked="true"]'
  const isSelectedState = (element) => element.matches(selectedSelector)
  // aria-pressed 的开关只有放在同一组（group / toolbar / radiogroup / tablist）里才是“多选一”；
  // 一行里的“显示 / 锁定”这类独立开关各管各的，不比较
  const pressedGroupSelector = '[role="group"], [role="toolbar"], [role="radiogroup"], [role="tablist"]'
  const selectableState = (element) => element.hasAttribute('aria-selected')
    || (element.hasAttribute('aria-pressed') && Boolean(element.parentElement?.matches(pressedGroupSelector)))
    || element.hasAttribute('aria-current') || element.hasAttribute('data-selected')
    || (['radio', 'menuitemradio'].includes(element.getAttribute('role') || '') && element.hasAttribute('aria-checked'))
  const appearance = (element) => {
    const style = getComputedStyle(element)
    const border = parseRgb(style.borderTopColor)
    return {
      background: effectiveBackground(element).color,
      color: parseRgb(style.color) || { r: 0, g: 0, b: 0 },
      border: border && border.a > 0.05 && (Number.parseFloat(style.borderTopWidth) || 0) > 0 ? border : null,
      shadow: style.boxShadow,
      outline: style.outlineStyle !== 'none' ? `${style.outlineWidth} ${style.outlineColor}` : 'none',
      weight: style.fontWeight,
      decoration: style.textDecorationLine,
      icons: Array.from(element.querySelectorAll('svg')).filter(isVisible).length,
      after: getComputedStyle(element, '::after').content,
      before: getComputedStyle(element, '::before').content,
    }
  }
  const checkedGroups = new Set()
  // 选中态可能画在后代上（图层行 treeitem 带 aria-selected，淡强调底画在行内的选项按钮上）：按结构序号逐个比较后代
  const descendantsDiffer = (a, b) => {
    const left = Array.from(a.querySelectorAll('*')).slice(0, 60)
    const right = Array.from(b.querySelectorAll('*')).slice(0, 60)
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      if (left[index].tagName !== right[index].tagName) return true
      const x = appearance(left[index])
      const y = appearance(right[index])
      if (Math.max(deltaE(x.background, y.background), deltaE(x.color, y.color)) >= T.selectedMinDeltaE) return true
      if (x.shadow !== y.shadow || x.weight !== y.weight || (x.border === null) !== (y.border === null)) return true
    }
    return false
  }
  for (const selected of Array.from(document.querySelectorAll(selectedSelector)).filter(isVisible)) {
    if (selected.hasAttribute('aria-pressed') && !selected.hasAttribute('aria-selected')
      && !selected.parentElement?.matches(pressedGroupSelector)) continue
    const parent = selected.parentElement
    if (!parent || checkedGroups.has(parent)) continue
    checkedGroups.add(parent)
    const rests = Array.from(parent.children).filter((child) => child !== selected && isVisible(child)
      && child.tagName === selected.tagName && (child.getAttribute('role') || '') === (selected.getAttribute('role') || '')
      && selectableState(child) && !isSelectedState(child) && !child.matches(':hover, :focus-visible'))
    if (!rests.length || selected.matches(':hover')) continue
    const a = appearance(selected)
    const b = appearance(rests[0])
    const borderDistance = a.border && b.border ? deltaE(a.border, b.border) : (a.border || b.border ? 1 : 0)
    const distance = Math.max(deltaE(a.background, b.background), deltaE(a.color, b.color), borderDistance)
    const otherDifference = a.shadow !== b.shadow || a.outline !== b.outline || a.weight !== b.weight
      || a.decoration !== b.decoration || a.icons !== b.icons || a.after !== b.after || a.before !== b.before
    if (distance < T.selectedMinDeltaE && !otherDifference && !descendantsDiffer(selected, rests[0])) {
      out.selectedStateWeak.push({ deltaE: Math.round(distance * 1000) / 1000, element: label(selected), rest: label(rests[0]) })
    }
  }

  // —— 浮层被裁切（5.8）——
  // 浮层：对话框 / 菜单 / 列表框 / 提示，或 z-index ≥ 30（下拉档）的绝对/固定定位块。在浮层框内取 5 × 5 个点，
  // 点落在窗口外，或该点的命中栈里没有这个浮层（被祖先的 overflow 裁掉）即命中；被别的浮层压住不算（仍在命中栈里）。
  const overlayRoleSelector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"]'
  const overlays = all.filter((element) => {
    const style = getComputedStyle(element)
    if (style.position !== 'absolute' && style.position !== 'fixed') return false
    const rect = element.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 20) return false
    if (rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1) return false
    if (element.closest('.react-flow__viewport')) return false
    const z = Number.parseInt(style.zIndex, 10)
    return element.matches(overlayRoleSelector) || (Number.isFinite(z) && z >= 30)
  })
  const outermostOverlays = overlays.filter((overlay) => !overlays.some((other) => other !== overlay && other.contains(overlay)))
  for (const overlay of outermostOverlays) {
    // 中心页样张半截滚出目录滚动区：浮层被滚动区裁掉是滚动，不是浮层越界
    const ownerSample = overlay.closest('[data-gallery-rule-sample]')
    if (ownerSample && !sampleFullyInView(ownerSample)) continue
    if (ignoresGalleryRule(overlay, 'overlayClipped')) continue
    const rect = overlay.getBoundingClientRect()
    // 圆角外的角点本来就不属于浮层：取点内缩到圆弧以内（r × 0.3 + 2）
    const radius = Number.parseFloat(getComputedStyle(overlay).borderTopLeftRadius) || 0
    const inset = Math.min(Math.ceil(radius * 0.3) + 2, rect.width / 4, rect.height / 4)
    const previousPointerEvents = overlay.style.pointerEvents
    overlay.style.pointerEvents = 'auto'
    let outside = 0
    let clipped = 0
    for (let ix = 0; ix < 5; ix += 1) {
      for (let iy = 0; iy < 5; iy += 1) {
        const x = rect.left + inset + (rect.width - inset * 2) * (ix / 4)
        const y = rect.top + inset + (rect.height - inset * 2) * (iy / 4)
        if (x < 0 || y < 0 || x > window.innerWidth - 1 || y > window.innerHeight - 1) {
          outside += 1
          continue
        }
        const stack = document.elementsFromPoint(x, y)
        if (!stack.some((node) => node === overlay || overlay.contains(node))) clipped += 1
      }
    }
    overlay.style.pointerEvents = previousPointerEvents
    if (outside || clipped) {
      out.overlayClipped.push({ reason: outside ? 'viewport' : 'ancestor', points: outside + clipped,
        bounds: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)], element: label(overlay) })
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
  out.toolbarWrap = dedupe(out.toolbarWrap, (item) => item.element)
  out.shortTextTruncated = dedupe(out.shortTextTruncated, (item) => `${item.element}|${item.text}`)
  out.selectedStateWeak = dedupe(out.selectedStateWeak, (item) => item.element)
  out.overlayClipped = dedupe(out.overlayClipped, (item) => item.element)
  out.notes.push(`扫描可见元素 ${all.length}`)
  // 反例只属于开发样张；普通审计先对账再移除预期命中，规则失败不得被样张豁免吞掉。
  out.gallerySamples = []
  for (const sample of document.querySelectorAll('[data-gallery-rule-sample]')) {
    if (!isVisible(sample)) continue
    const rule = sample.getAttribute('data-gallery-rule-sample')
    const issues = (out[rule] || []).filter(issue => JSON.stringify(issue).includes(`#${sample.id} / `))
    const expectHit = sample.hasAttribute('data-gallery-expect-hit')
    // 只对账整块可见的样张（含定位出去的浮层，且在目录滚动区的可见范围内）
    if (sampleFullyInView(sample)) out.gallerySamples.push({ id: sample.id, rule, expectHit, passed: expectHit === (issues.length > 0), issues })
    if (!context.includeGallerySamples && expectHit) out[rule] = (out[rule] || []).filter(issue => !JSON.stringify(issue).includes(`#${sample.id} / `))
  }
  out.galleryExemptions = [...galleryExemptions.values()].map(entry => ({ ...entry, rules: [...entry.rules] }))
  return out
}

module.exports = {
  UI_AUDIT_RULES,
  UI_AUDIT_THRESHOLDS,
  auditUiDom,
}
