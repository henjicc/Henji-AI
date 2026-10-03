/**
 * 渲染后对比度审计（check:ui-visual 的 lowContrast 规则，界面重设计 4.1）。
 *
 * 不按 DOM 祖先链猜背景：半透明叠加、玻璃（backdrop-filter）、压在图片/视频/画布上的浮层，
 * 只有合成后的像素才是真背景。做法：
 * 1. 在渲染进程收集候选（有直接文字的元素、输入框的值与占位符、lucide 图标）：前景色、
 *    祖先 opacity 乘积、字号字重、可见区域；临时把 pointer-events 全部打开后用命中测试剔除
 *    被弹窗/菜单等遮住的候选（它们不可读，也不该判）。
 * 2. 注入样式把全部文字与 lucide 图标隐藏（颜色透明 / visibility:hidden，不影响布局），
 *    用正式截屏通道截一张“只有背景”的图，再移除样式。
 * 3. 在每个候选可见区域内网格取样背景像素，前景按 alpha 与 opacity 合成到每个样本上算
 *    WCAG 对比度，取最差 10% 分位作为该候选的对比度（文字压在渐变/图片上时不靠平均值蒙混）。
 * 门槛：正文与辅助文字 ≥ 4.5:1；大字（≥ 24px，或 ≥ 18.66px 且字重 ≥ 700）与图标 ≥ 3:1。
 * 不判：禁用控件（WCAG 1.4.3 对非活动组件豁免）、aria-hidden 文字、被遮挡或裁切到不可见的部分。
 * 合理例外登记在 scripts/ui-visual-contrast-exceptions.json，每条必须写理由。
 */
const fs = require('node:fs')
const path = require('node:path')

const CONTRAST_TEXT_MIN = 4.5
const CONTRAST_LARGE_MIN = 3
const CONTRAST_ICON_MIN = 3
/** 取样对比度的分位：0.1 = 候选区域里最差的 10% 背景像素。 */
const CONTRAST_SAMPLE_PERCENTILE = 0.1
const MAX_SAMPLES_PER_CANDIDATE = 240
const DEFAULT_EXCEPTIONS_FILE = path.resolve(__dirname, '..', 'ui-visual-contrast-exceptions.json')

const HIDE_FOREGROUND_STYLE_ID = '__henji_contrast_hide_foreground__'
const HIDE_FOREGROUND_CSS = `*, *::before, *::after {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; caret-color: transparent !important;
  text-decoration-color: transparent !important; transition: none !important;
}
*::placeholder { color: transparent !important; }
svg.lucide { visibility: hidden !important; }`
const NO_TRANSITION_CSS = '*, *::before, *::after { transition: none !important; }'

function parseCssColor(value) {
  const text = String(value || '').trim()
  let match = /^rgba?\(([^)]+)\)$/i.exec(text)
  if (match) {
    const parts = match[1].replaceAll('/', ' ').split(/[\s,]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (part) => (part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part))
    const alpha = parts[3] === undefined ? 1
      : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])
    const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha }
    return Object.values(color).every(Number.isFinite) ? color : null
  }
  // color-mix() 等在 Chromium 的计算值是 color(srgb r g b / a)，通道为 0–1。
  match = /^color\(srgb\s+([^)]+)\)$/i.exec(text)
  if (match) {
    const parts = match[1].replaceAll('/', ' ').split(/\s+/).filter(Boolean).map(Number.parseFloat)
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: Number.isFinite(parts[3]) ? parts[3] : 1 }
  }
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  return null
}

function compositeOver(foreground, background) {
  const alpha = Math.min(1, Math.max(0, foreground.a))
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  }
}

function relativeLuminance(color) {
  const channel = (value) => {
    const normalized = Math.min(255, Math.max(0, value)) / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** WCAG 2.x：≥ 24px（18pt），或 ≥ 18.66px（14pt）且粗体，为大字。 */
function requiredContrast({ kind, fontSize, fontWeight }) {
  if (kind === 'icon') return CONTRAST_ICON_MIN
  const size = Number(fontSize) || 0
  const weight = Number(fontWeight) || 400
  return size >= 24 || (size >= 18.66 && weight >= 700) ? CONTRAST_LARGE_MIN : CONTRAST_TEXT_MIN
}

/** 已升序数组的分位值（取下界，偏严格）。 */
function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return undefined
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * fraction)))
  return sortedValues[index]
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function formatRgb(color) {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

/** 在候选可见区域（CSS 像素）内网格取样截图像素；bitmap 为 sharp raw（RGB/RGBA）。 */
function sampleBackground(bitmap, rect, viewport) {
  const scaleX = bitmap.width / viewport.width
  const scaleY = bitmap.height / viewport.height
  const left = Math.max(0, Math.floor(rect.x * scaleX))
  const top = Math.max(0, Math.floor(rect.y * scaleY))
  const right = Math.min(bitmap.width, Math.ceil((rect.x + rect.width) * scaleX))
  const bottom = Math.min(bitmap.height, Math.ceil((rect.y + rect.height) * scaleY))
  if (right <= left || bottom <= top) return []
  const width = right - left
  const height = bottom - top
  const aspect = width / height
  const columns = Math.max(1, Math.min(width, Math.round(Math.sqrt(MAX_SAMPLES_PER_CANDIDATE * aspect))))
  const rows = Math.max(1, Math.min(height, Math.floor(MAX_SAMPLES_PER_CANDIDATE / columns)))
  const samples = []
  for (let row = 0; row < rows; row += 1) {
    const y = top + Math.min(height - 1, Math.floor(((row + 0.5) * height) / rows))
    for (let column = 0; column < columns; column += 1) {
      const x = left + Math.min(width - 1, Math.floor(((column + 0.5) * width) / columns))
      const offset = (y * bitmap.width + x) * bitmap.channels
      samples.push({ r: bitmap.data[offset], g: bitmap.data[offset + 1], b: bitmap.data[offset + 2], a: 1 })
    }
  }
  return samples
}

function measureCandidate(candidate, bitmap, viewport) {
  const color = parseCssColor(candidate.color)
  if (!color) return { skipped: 'unparsedColor' }
  const alpha = color.a * (Number.isFinite(candidate.opacity) ? candidate.opacity : 1)
  if (alpha < 0.05) return { skipped: 'transparentForeground' }
  const samples = sampleBackground(bitmap, candidate.rect, viewport)
  if (samples.length === 0) return { skipped: 'outsideCapture' }
  const foreground = { ...color, a: alpha }
  const measured = samples.map((background) => ({ background, ratio: contrastRatio(compositeOver(foreground, background), background) }))
  measured.sort((first, second) => first.ratio - second.ratio)
  const worst = percentile(measured, CONTRAST_SAMPLE_PERCENTILE)
  return { ratio: worst.ratio, background: worst.background, median: percentile(measured, 0.5).ratio }
}

function loadContrastExceptions(file = DEFAULT_EXCEPTIONS_FILE) {
  if (!fs.existsSync(file)) return []
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  return validateContrastExceptions(parsed.exceptions ?? [])
}

/** 例外必须写理由与匹配条件；正则在登记时编译，写错立即报错而不是悄悄不匹配。 */
function validateContrastExceptions(entries) {
  const ids = new Set()
  return entries.map((entry, index) => {
    const where = `对比度例外第 ${index + 1} 条（${entry?.id ?? '无 id'}）`
    if (!entry || typeof entry !== 'object') throw new Error(`${where} 不是对象`)
    if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error(`${where} 缺少 id`)
    if (ids.has(entry.id)) throw new Error(`${where} id 重复`)
    ids.add(entry.id)
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 8) throw new Error(`${where} 必须写明理由`)
    if (!entry.text && !entry.element) throw new Error(`${where} 至少要用 text 或 element 限定命中范围`)
    if (entry.kind !== undefined && !['text', 'icon'].includes(entry.kind)) throw new Error(`${where} kind 只能是 text 或 icon`)
    if (entry.presets !== undefined && !Array.isArray(entry.presets)) throw new Error(`${where} presets 必须是数组`)
    if (entry.minRatio !== undefined && !(Number(entry.minRatio) > 1)) throw new Error(`${where} minRatio 必须大于 1`)
    const compile = (field) => {
      if (entry[field] === undefined) return null
      try { return new RegExp(entry[field], 'u') } catch (error) { throw new Error(`${where} ${field} 正则无效：${error.message}`) }
    }
    return { ...entry, matchers: { text: compile('text'), element: compile('element'), scene: compile('scene') } }
  })
}

function findContrastException(issue, exceptions, context) {
  return exceptions.find((entry) => {
    if (entry.kind && entry.kind !== issue.kind) return false
    if (entry.presets && !entry.presets.includes(context.themePreset ?? 'default')) return false
    if (entry.matchers.scene && !entry.matchers.scene.test(context.scene ?? '')) return false
    if (entry.matchers.text && !entry.matchers.text.test(issue.text ?? '')) return false
    if (entry.matchers.element && !entry.matchers.element.test(issue.element ?? '')) return false
    // 例外只放宽到登记的下限，再低仍然算违规（防止一条例外掩盖后续更严重的退化）。
    return entry.minRatio === undefined || issue.ratio >= Number(entry.minRatio)
  }) ?? null
}

/**
 * 纯计算部分：候选 + 只有背景的截图 → 违规、例外与统计。
 * @param {{ candidates: object[], viewport: { width: number, height: number }, skipped?: Record<string, number> }} collected
 */
function evaluateContrast(collected, bitmap, { exceptions = [], scene = '', themePreset = null } = {}) {
  const issues = []
  const exempted = []
  const skipped = { ...(collected.skipped ?? {}) }
  let checked = 0
  for (const candidate of collected.candidates) {
    const measured = measureCandidate(candidate, bitmap, collected.viewport)
    if (measured.skipped) {
      skipped[measured.skipped] = (skipped[measured.skipped] ?? 0) + 1
      continue
    }
    checked += 1
    const required = requiredContrast(candidate)
    if (measured.ratio >= required) continue
    const issue = {
      kind: candidate.kind,
      ratio: round2(measured.ratio),
      medianRatio: round2(measured.median),
      required,
      size: candidate.fontSize,
      weight: candidate.fontWeight,
      text: candidate.text,
      color: candidate.color,
      opacity: round2(candidate.opacity),
      background: formatRgb(measured.background),
      element: candidate.element,
      rect: Object.fromEntries(Object.entries(candidate.rect).map(([key, value]) => [key, Math.round(value)])),
    }
    const exception = findContrastException(issue, exceptions, { scene, themePreset })
    if (exception) exempted.push({ ...issue, exception: exception.id, reason: exception.reason })
    else issues.push(issue)
  }
  const dedupe = (items) => {
    const seen = new Set()
    return items.filter((item) => {
      const key = `${item.kind}|${item.element}|${item.color}|${item.text}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  return { issues: dedupe(issues), exempted: dedupe(exempted), stats: { candidates: collected.candidates.length, checked, skipped } }
}

/**
 * 渲染进程侧：收集候选。会被 Playwright 序列化，所有辅助函数必须写在函数体内。
 * 收集期间临时把 pointer-events 全部打开，命中测试才能看到真正盖在最上面的元素（含
 * pointer-events:none 的浮层）；注入与撤销在同一次同步执行里完成，不给悬停/鼠标事件留可乘之机。
 */
function collectContrastCandidates() {
  const hitTestStyle = document.createElement('style')
  hitTestStyle.textContent = '*, *::before, *::after { pointer-events: auto !important; }'
  document.head.appendChild(hitTestStyle)
  try {
    return collectWithHitTesting()
  } finally {
    hitTestStyle.remove()
  }

  function collectWithHitTesting() {
    const skipped = { hidden: 0, disabled: 0, occluded: 0, clipped: 0 }
    const candidates = []
    const classText = (element) => (typeof element.className === 'string' ? element.className
      : (element.className && typeof element.className.baseVal === 'string' ? element.className.baseVal : ''))
    const label = (element) => {
      const classes = classText(element).trim().replace(/\s+/g, '.').slice(0, 110)
      const id = element.id ? `#${element.id}` : ''
      const name = element.getAttribute('aria-label') || element.getAttribute('title') || ''
      return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}${name ? `[${name.slice(0, 32)}]` : ''}`
    }
    const describe = (element) => {
      const parent = element.parentElement
      return parent && parent !== document.body ? `${label(parent)} > ${label(element)}` : label(element)
    }
    const isRendered = (element, allowSelfAriaHidden) => {
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
        if (Number.parseFloat(style.opacity) <= 0.01) return false
        if (node.getAttribute('aria-hidden') === 'true' && !(allowSelfAriaHidden && node === element)) return false
      }
      return true
    }
    const opacityOf = (element) => {
      let product = 1
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        product *= Number.parseFloat(getComputedStyle(node).opacity) || 0
      }
      return product
    }
    const isDisabled = (element) => Boolean(element.closest('[disabled], [aria-disabled="true"], [inert]'))
      || Boolean(element.closest('fieldset')?.disabled)
    const intersect = (a, b) => {
      const x = Math.max(a.x, b.x)
      const y = Math.max(a.y, b.y)
      const right = Math.min(a.x + a.width, b.x + b.width)
      const bottom = Math.min(a.y + a.height, b.y + b.height)
      return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
    }
    const visibleRect = (element, rect) => {
      let current = intersect(rect, { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
      for (let node = element.parentElement; node && current && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
        const box = node.getBoundingClientRect()
        current = intersect(current, { x: box.x, y: box.y, width: box.width, height: box.height })
      }
      return current
    }
    // 透明的定位容器（toast 层、整块可点的覆盖按钮）不算遮挡；第一个真正画了东西的非相关元素才算。
    const paints = (element) => {
      if (['IMG', 'VIDEO', 'CANVAS', 'IFRAME'].includes(element.tagName) || element instanceof SVGElement) return true
      const style = getComputedStyle(element)
      const background = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)
      const alpha = background ? Number.parseFloat(background[1].replaceAll('/', ' ').split(/[\s,]+/).filter(Boolean)[3] ?? '1') : 0
      return alpha > 0.05 || (style.backdropFilter && style.backdropFilter !== 'none') || style.backgroundImage !== 'none'
    }
    const occluded = (element, rect) => {
      for (const hit of document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) {
        if (hit === element || element.contains(hit) || hit.contains(element)) return false
        if (paints(hit)) return true
      }
      return false
    }
    const accept = (element, kind, rawRect, extra) => {
      if (!rawRect || rawRect.width < 2 || rawRect.height < 2) { skipped.clipped += 1; return }
      const rect = visibleRect(element, rawRect)
      if (!rect || rect.width < 2 || rect.height < 2) { skipped.clipped += 1; return }
      if (isDisabled(element)) { skipped.disabled += 1; return }
      if (occluded(element, rect)) { skipped.occluded += 1; return }
      const style = getComputedStyle(element)
      candidates.push({
        kind,
        rect,
        color: extra.color ?? style.color,
        opacity: opacityOf(element),
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        text: (extra.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 42),
        element: describe(element),
      })
    }
    const unionRect = (rects) => {
      const list = Array.from(rects).filter((rect) => rect.width > 0 && rect.height > 0)
      if (list.length === 0) return null
      const x = Math.min(...list.map((rect) => rect.left))
      const y = Math.min(...list.map((rect) => rect.top))
      const right = Math.max(...list.map((rect) => rect.right))
      const bottom = Math.max(...list.map((rect) => rect.bottom))
      return { x, y, width: right - x, height: bottom - y }
    }

    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (element.closest('svg') || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(element.tagName)) continue
      const textNodes = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
      if (textNodes.length > 0) {
        if (!isRendered(element, false)) { skipped.hidden += 1; continue }
        const range = document.createRange()
        const rects = textNodes.flatMap((node) => { range.selectNodeContents(node); return Array.from(range.getClientRects()) })
        accept(element, 'text', unionRect(rects), { text: textNodes.map((node) => node.textContent).join(' ') })
      }
      if ((element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')
        && !['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image'].includes(element.type)) {
        if (!isRendered(element, false)) { skipped.hidden += 1; continue }
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        const padLeft = Number.parseFloat(style.paddingLeft) || 0
        const padRight = Number.parseFloat(style.paddingRight) || 0
        const lineHeight = Math.min(box.height, (Number.parseFloat(style.fontSize) || 13) * 1.4)
        const content = { x: box.x + padLeft, y: box.y + (box.height - lineHeight) / 2, width: box.width - padLeft - padRight, height: lineHeight }
        if (element.value) accept(element, 'text', content, { text: element.value })
        else if (element.placeholder) {
          accept(element, 'text', content, { text: element.placeholder, color: getComputedStyle(element, '::placeholder').color })
        }
      }
    }
    for (const icon of Array.from(document.querySelectorAll('svg.lucide'))) {
      if (!isRendered(icon, true)) { skipped.hidden += 1; continue }
      const style = getComputedStyle(icon)
      const stroke = style.stroke && style.stroke !== 'none' ? style.stroke : style.fill
      const box = icon.getBoundingClientRect()
      const strokeOpacity = Number.parseFloat(style.strokeOpacity)
      const host = icon.closest('button, a, [role="button"], [aria-label], [title]')
      const name = host ? (host.getAttribute('aria-label') || host.getAttribute('title') || host.textContent || '') : ''
      accept(icon, 'icon', { x: box.x, y: box.y, width: box.width, height: box.height }, {
        color: stroke,
        text: `${(classText(icon).match(/lucide-([\w-]+)/) || [])[1] || 'icon'}${name.trim() ? ` · ${name.trim()}` : ''}`,
      })
      if (Number.isFinite(strokeOpacity) && strokeOpacity < 1) candidates.at(-1).opacity *= strokeOpacity
    }
    return { candidates, skipped, viewport: { width: window.innerWidth, height: window.innerHeight } }
  }
}

async function injectStyle(page, id, css) {
  await page.evaluate(({ id, css }) => {
    let style = document.getElementById(id)
    if (!style) {
      style = document.createElement('style')
      style.id = id
      document.head.appendChild(style)
    }
    style.textContent = css
  }, { id, css })
}

async function removeStyle(page, id) {
  await page.evaluate((id) => document.getElementById(id)?.remove(), id)
}

async function nextFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/**
 * 对当前页面状态做一次对比度审计。capture(page) 返回 PNG 字节（复用巡检的正式截屏通道）。
 * 无论成功失败都撤掉注入的样式，保证后续场景看到的是原样界面。
 */
async function auditPageContrast(page, capture, options = {}) {
  const sharp = require('sharp')
  const collected = await page.evaluate(collectContrastCandidates)
  let bytes
  try {
    await injectStyle(page, HIDE_FOREGROUND_STYLE_ID, HIDE_FOREGROUND_CSS)
    await nextFrames(page)
    bytes = await capture(page)
  } finally {
    // 先只保留“禁用过渡”，颜色复原后再撤掉：否则 transition-colors 会让文字从透明渐显 120–180ms，
    // 场景随后的截图或像素比对会看到半透明文字。
    await injectStyle(page, HIDE_FOREGROUND_STYLE_ID, NO_TRANSITION_CSS).catch(() => undefined)
    await nextFrames(page).catch(() => undefined)
    await removeStyle(page, HIDE_FOREGROUND_STYLE_ID).catch(() => undefined)
  }
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return evaluateContrast(collected, { data, width: info.width, height: info.height, channels: info.channels }, options)
}

module.exports = {
  CONTRAST_ICON_MIN,
  CONTRAST_LARGE_MIN,
  CONTRAST_TEXT_MIN,
  DEFAULT_EXCEPTIONS_FILE,
  HIDE_FOREGROUND_CSS,
  auditPageContrast,
  collectContrastCandidates,
  compositeOver,
  contrastRatio,
  evaluateContrast,
  findContrastException,
  loadContrastExceptions,
  parseCssColor,
  percentile,
  relativeLuminance,
  requiredContrast,
  sampleBackground,
  validateContrastExceptions,
}
