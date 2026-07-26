/**
 * 在真实渲染的 DOM 上跑规范审计。
 * 静态 grep 查不到的东西只有这里能查：实际叠了几层表面、真实对比度、
 * 同属性叠类的最终计算值、元素实际对齐。
 */
const path = require('node:path')
const fs = require('node:fs')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const OUT_DIR = process.argv[2] || path.join(ROOT, '.ui-audit')

const AUDIT = () => {
  const out = { surfaceStacks: [], lowContrast: [], oversizedRadius: [], shadowOutsideOverlay: [], notes: [] }

  const parseRgb = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '')
    if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const over = (fg, bg) => {
    const a = fg.a
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
  }
  const effectiveBg = (el) => {
    let node = el
    let acc = null
    while (node && node !== document.documentElement) {
      const c = parseRgb(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c
        if (acc.a >= 0.999) return acc
      }
      node = node.parentElement
    }
    return acc || { r: 10, g: 10, b: 10, a: 1 }
  }
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }
  const label = (el) => {
    const cls = (el.className || '').toString().slice(0, 90)
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} .${cls}`
  }

  const all = Array.from(document.querySelectorAll('body *'))
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'
    })

  // ① 表面叠层：一条祖先链上有几个元素同时具备「可见边框 + 非透明背景」
  const isSurface = (el) => {
    const st = getComputedStyle(el)
    const bw = parseFloat(st.borderTopWidth) || 0
    const bc = parseRgb(st.borderTopColor)
    const bg = parseRgb(st.backgroundColor)
    return bw > 0 && bc && bc.a > 0.05 && bg && bg.a > 0.05
  }
  for (const el of all) {
    if (!isSurface(el)) continue
    let depth = 0
    const chain = []
    let node = el
    while (node && node !== document.body) {
      if (isSurface(node)) { depth += 1; chain.push(label(node)) }
      node = node.parentElement
    }
    if (depth >= 3) out.surfaceStacks.push({ depth, chain: chain.slice(0, 4) })
  }

  // ② 文字对比度（WCAG AA 正文 4.5，大字 3.0）
  for (const el of all) {
    const txt = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!txt) continue
    const st = getComputedStyle(el)
    const fg = parseRgb(st.color)
    if (!fg || fg.a < 0.05) continue
    const bg = effectiveBg(el)
    const c = contrast(over(fg, bg), bg)
    const size = parseFloat(st.fontSize)
    const bold = parseInt(st.fontWeight, 10) >= 700
    const need = size >= 24 || (size >= 18.66 && bold) ? 3.0 : 4.5
    if (c < need) {
      out.lowContrast.push({
        ratio: Math.round(c * 100) / 100, need, size,
        text: (el.textContent || '').trim().slice(0, 34),
        color: st.color, el: label(el),
      })
    }
  }

  // ③ 内层圆角大于外层
  for (const el of all) {
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
    if (r <= 0) continue
    const p = el.parentElement
    if (!p) continue
    const pr = parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0
    const po = getComputedStyle(p).overflow
    if (pr > 0 && r > pr + 1 && po !== 'visible') {
      out.oversizedRadius.push({ child: r, parent: pr, el: label(el) })
    }
  }

  // ④ 阴影用在非浮层：有 box-shadow 但既非 fixed/absolute 也不在 portal 里
  for (const el of all) {
    const st = getComputedStyle(el)
    // Tailwind 的 ring 也是用 box-shadow 实现的，焦点环不是装饰阴影，必须放过
    if (st.boxShadow === 'none' || st.boxShadow.includes('inset')) continue
    if (/rgba?\([^)]*\)\s+0px\s+0px\s+0px\s+0px/.test(st.boxShadow)) continue
    if (['fixed', 'absolute'].includes(st.position)) continue
    let node = el, floating = false
    while (node && node !== document.body) {
      const p = getComputedStyle(node).position
      if (p === 'fixed' || p === 'absolute') { floating = true; break }
      node = node.parentElement
    }
    if (!floating) out.shadowOutsideOverlay.push({ el: label(el), shadow: st.boxShadow.slice(0, 60) })
  }

  const dedupe = (arr, key) => {
    const seen = new Set()
    return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true })
  }
  out.surfaceStacks = dedupe(out.surfaceStacks, (x) => x.chain.join('|')).slice(0, 12)
  out.lowContrast = dedupe(out.lowContrast, (x) => x.el + x.color).slice(0, 20)
  out.oversizedRadius = dedupe(out.oversizedRadius, (x) => x.el).slice(0, 12)
  out.shadowOutsideOverlay = dedupe(out.shadowOutsideOverlay, (x) => x.el).slice(0, 12)
  out.notes.push(`扫描元素数 ${all.length}`)
  return out
}

async function run(page, name, results) {
  const r = await page.evaluate(AUDIT)
  results[name] = r
  console.log(`\n===== ${name} =====  (${r.notes[0]})`)
  const show = (title, arr, fmt) => {
    console.log(`  ${title}: ${arr.length}`)
    arr.slice(0, 8).forEach((x) => console.log('    ' + fmt(x)))
  }
  show('表面叠 3 层以上', r.surfaceStacks, (x) => `depth=${x.depth}  ${x.chain[0]}`)
  show('对比度不足', r.lowContrast, (x) => `${x.ratio}:1 (需${x.need}) ${x.size}px "${x.text}" ${x.color}`)
  show('内层圆角>外层', r.oversizedRadius, (x) => `${x.child}>${x.parent}  ${x.el}`)
  show('非浮层用阴影', r.shadowOutsideOverlay, (x) => `${x.el}`)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const app = await launchElectronApp({ mainEntry: MAIN_ENTRY, cwd: ROOT, isolateUserData: true })
  const { page } = app
  const results = {}
  try {
    await waitForApp(page)
    await page.waitForTimeout(1500)
    await run(page, '生成工作区', results)

    await page.locator('[aria-label*="设置"], [title*="设置"]').first().click({ timeout: 5000 })
    await page.waitForTimeout(1000)
    await run(page, '设置弹窗', results)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    try {
      await page.getByRole('button', { name: /画布/ }).first().click({ timeout: 4000 })
      await page.waitForTimeout(2000)
      await run(page, '画布工作区', results)
    } catch (e) { console.log('skip 画布:', String(e).slice(0, 80)) }

    fs.writeFileSync(path.join(OUT_DIR, 'audit.json'), JSON.stringify(results, null, 2))
  } finally {
    await app.close()
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
