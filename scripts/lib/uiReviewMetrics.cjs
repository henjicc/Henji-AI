/**
 * 界面核对的自动指标（skill henji-ui-surface references/review.md 第 2、4 节）：行数、溢出、截断、短标签折行。
 *
 * 分两半：
 * - `collectLayoutMeasurements` 在页面里执行（自包含，不引用外部变量），只采集原始几何与样式；
 * - `analyzeLayoutMetrics` 在 Node 里把原始数据判成指标与可疑原因，纯函数，有精确测试。
 *
 * 指标只用于“先筛可疑项”，不替代 Agent 打开截图目视；判据宁可多报，不漏报。
 */

/** 页面侧：采集目标元素内的原始几何。参数 element 是 Playwright 传入的 DOM 元素。 */
function collectLayoutMeasurements(element) {
  const ATOM_SELECTOR = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role="button"]', '[role="combobox"]', '[role="switch"]', '[role="tab"]', '[role="radio"]',
    '[role="checkbox"]', '[role="menuitem"]', '[role="option"]', '[role="slider"]',
    '[data-panel-trigger-button]', '[data-dropdown-button]',
  ].join(',')
  const round = (value) => Math.round(value * 100) / 100
  const rectOf = (node) => {
    const rect = node.getBoundingClientRect()
    return { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom),
      width: round(rect.width), height: round(rect.height) }
  }
  const isVisible = (node) => {
    const rect = node.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    const style = getComputedStyle(node)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.01
  }
  const describe = (node) => {
    const label = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || ''
    const name = label.replace(/\s+/g, ' ').trim().slice(0, 40)
    return `${node.tagName.toLowerCase()}${name ? `「${name}」` : ''}`
  }
  const ownText = (node) => [...node.childNodes]
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent ?? '').join('').replace(/\s+/g, ' ').trim()

  // 被滚动容器（目标自身或其内部的 overflow 非 visible 祖先）整块裁掉的项，是“滚动后才看得到”，不是溢出
  const scrolledOut = (node) => {
    const rect = node.getBoundingClientRect()
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const clip = ancestor.getBoundingClientRect()
        if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.right <= clip.left || rect.left >= clip.right) return true
      }
      if (ancestor === element) break
    }
    return false
  }
  const container = rectOf(element)
  const containerStyle = getComputedStyle(element)
  const allAtoms = [...element.querySelectorAll(ATOM_SELECTOR)].filter((node) => isVisible(node) && !scrolledOut(node))
  // 只取最外层的可交互件：触发器里的图标按钮不再单独算一项
  const atoms = allAtoms.filter((node) => !allAtoms.some((other) => other !== node && other.contains(node)))
  const items = (atoms.length > 0 ? atoms : [...element.children].filter(isVisible))
    .map((node) => ({ label: describe(node), rect: rectOf(node),
      // 下拉 / 面板触发器：参数选择器；“更多参数”里出现它说明收起的不只是只能放浮层的大块控件
      trigger: node.matches('[data-dropdown-button],[data-panel-trigger-button],[role="combobox"]') }))

  const texts = []
  for (const node of [element, ...element.querySelectorAll('*')]) {
    if (!isVisible(node) || (node !== element && scrolledOut(node))) continue
    const text = ownText(node)
    if (!text) continue
    const style = getComputedStyle(node)
    // 只量自身的文字节点：按整个元素取 range 会把同一行里的图标（svg）也算进来，
    // 图标与文字顶边不同就被误判成“折行”（5.3：带上传图标的“上传 PDF”按钮）。
    // 顶边按半个行高聚类，同一行里不同字体的基线差不算新行。
    const range = document.createRange()
    const rects = []
    for (const child of node.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue
      range.selectNodeContents(child)
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0))
    }
    range.detach?.()
    const lineTops = []
    for (const rect of rects.sort((a, b) => a.top - b.top)) {
      const last = lineTops[lineTops.length - 1]
      if (last === undefined || rect.top - last > rect.height / 2) lineTops.push(rect.top)
    }
    // 悬停可看全：自身或祖先带 title / aria-label（UiMarqueeText 默认把全文写进 title）
    const titled = node.closest('[title],[aria-label]')
    texts.push({
      text: text.slice(0, 60),
      length: [...text].length,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      textOverflow: style.textOverflow,
      lineClamp: style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp') || 'none',
      whiteSpace: style.whiteSpace,
      lineCount: lineTops.length,
      hasFullTextHint: Boolean(titled),
      label: describe(node),
    })
  }

  return {
    container,
    containerScroll: { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight },
    containerOverflowX: containerStyle.overflowX,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    items,
    // 直接子元素的宽度：单行收纳容器（UiOverflowRow）的子元素就是各参数项与“更多参数”入口
    childWidths: [...element.children].filter(isVisible).map((node) => round(node.getBoundingClientRect().width)),
    texts,
  }
}

/**
 * 把一组矩形按“竖直方向是否重叠”分成视觉行：区间图的连通分量。
 * 同一行里高低不同的控件（32 高按钮与 28 高标签）仍算一行；完全错开的才是折行。
 */
function countVisualRows(rects, minOverlapPx = 2) {
  const intervals = rects
    .filter((rect) => rect && rect.height > 0 && rect.width > 0)
    .map((rect) => [rect.top, rect.bottom])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let rows = 0
  let currentBottom = -Infinity
  for (const [top, bottom] of intervals) {
    if (top > currentBottom - minOverlapPx) {
      rows += 1
      currentBottom = bottom
    } else {
      currentBottom = Math.max(currentBottom, bottom)
    }
  }
  return rows
}

const OVERFLOW_TOLERANCE_PX = 1
const SHORT_LABEL_MAX_CHARS = 12

function isTruncated(text) {
  const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(text.overflowX) || text.textOverflow === 'ellipsis'
  if (clipsX && text.scrollWidth > text.clientWidth + OVERFLOW_TOLERANCE_PX) return 'horizontal'
  const clamped = text.lineClamp && text.lineClamp !== 'none'
  const clipsY = clamped || ['hidden', 'clip'].includes(text.overflowY)
  if (clipsY && text.scrollHeight > text.clientHeight + OVERFLOW_TOLERANCE_PX) return 'vertical'
  return null
}

/**
 * Node 侧：原始几何 → 指标与可疑原因。
 * @param {ReturnType<typeof collectLayoutMeasurements>} raw
 * @param {{ maxRows?: number }} [expect] maxRows 默认 1（工具条、底栏、命令带必须单行）；表单类目标传 null 不判行数
 */
function analyzeLayoutMetrics(raw, expect = {}) {
  const maxRows = expect.maxRows === undefined ? 1 : expect.maxRows
  const rows = countVisualRows(raw.items.map((item) => item.rect))
  const { container } = raw
  const overflowingItems = raw.items.filter(({ rect }) => (
    rect.left < container.left - OVERFLOW_TOLERANCE_PX || rect.right > container.right + OVERFLOW_TOLERANCE_PX
  )).map((item) => item.label)
  const offscreenItems = raw.items.filter(({ rect }) => (
    rect.left < -OVERFLOW_TOLERANCE_PX || rect.right > raw.viewport.width + OVERFLOW_TOLERANCE_PX
    || rect.bottom > raw.viewport.height + OVERFLOW_TOLERANCE_PX
  )).map((item) => item.label)
  // 只有会裁切/滚动的容器才算“横向溢出”；overflow: visible 的容器里向外凸出的件（如节点端口）是有意设计，
  // 真正挤出容器的件由下面的 overflowingItems 按几何判断
  const containerOverflow = raw.containerOverflowX !== 'visible'
    && raw.containerScroll.scrollWidth > raw.containerScroll.clientWidth + OVERFLOW_TOLERANCE_PX
  const truncated = raw.texts
    .map((text) => ({ text, kind: isTruncated(text) }))
    .filter(({ kind }) => kind)
    .map(({ text, kind }) => ({ text: text.text, kind, hint: text.hasFullTextHint, element: text.label }))
  const wrappedLabels = raw.texts
    .filter((text) => text.length <= SHORT_LABEL_MAX_CHARS && text.lineCount > 1 && !isTruncated(text))
    .map((text) => ({ text: text.text, lines: text.lineCount, element: text.label }))

  const reasons = []
  if (maxRows !== null && rows > maxRows) reasons.push(`折行：${rows} 行（上限 ${maxRows}）`)
  if (containerOverflow) reasons.push(`容器横向溢出 ${raw.containerScroll.scrollWidth}>${raw.containerScroll.clientWidth}`)
  if (overflowingItems.length) reasons.push(`超出容器：${overflowingItems.slice(0, 3).join('、')}`)
  if (offscreenItems.length) reasons.push(`超出窗口：${offscreenItems.slice(0, 3).join('、')}`)
  const unhinted = truncated.filter((item) => !item.hint)
  if (unhinted.length) reasons.push(`截断且悬停看不全：${unhinted.slice(0, 3).map((item) => item.text).join('、')}`)
  if (truncated.length > unhinted.length) reasons.push(`截断（有悬停提示）：${truncated.length - unhinted.length} 处`)
  if (wrappedLabels.length) reasons.push(`短标签折行：${wrappedLabels.slice(0, 3).map((item) => item.text).join('、')}`)

  // 未占用宽度：容器宽减去直接子元素宽度之和（不扣间距）。单行收纳容器里它很大却仍有收起项，就是可疑
  const slack = Math.round(container.width - (raw.childWidths ?? []).reduce((sum, width) => sum + width, 0))
  return {
    rows,
    itemCount: raw.items.length,
    triggerCount: raw.items.filter((item) => item.trigger).length,
    slack,
    childWidths: raw.childWidths ?? [],
    width: container.width,
    height: container.height,
    containerOverflow,
    overflowingItems,
    offscreenItems,
    truncated,
    wrappedLabels,
    // 目标里可见的文字（去重、按文档顺序），用于汇总“哪些参数在底栏 / 被收进更多参数”
    texts: [...new Set(raw.texts.map((text) => text.text))].slice(0, 60),
    suspicious: reasons.length > 0,
    reasons,
  }
}

module.exports = {
  SHORT_LABEL_MAX_CHARS,
  analyzeLayoutMetrics,
  collectLayoutMeasurements,
  countVisualRows,
  isTruncated,
}
