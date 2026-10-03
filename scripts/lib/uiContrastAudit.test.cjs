const assert = require('node:assert/strict')
const test = require('node:test')
const {
  DEFAULT_EXCEPTIONS_FILE,
  contrastRatio,
  evaluateContrast,
  loadContrastExceptions,
  parseCssColor,
  requiredContrast,
  sampleBackground,
  validateContrastExceptions,
} = require('./uiContrastAudit.cjs')

/** 生成 RGB raw 位图；paint(x, y) 返回 [r, g, b]。 */
function bitmap(width, height, paint) {
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 3)
  }
  return { data, width, height, channels: 3 }
}

const candidate = (overrides = {}) => ({
  kind: 'text',
  rect: { x: 10, y: 10, width: 40, height: 12 },
  color: 'rgb(237, 238, 240)',
  opacity: 1,
  fontSize: 13,
  fontWeight: 400,
  text: '正文',
  element: 'span.text-text1',
  ...overrides,
})
const viewport = { width: 100, height: 50 }

test('解析 Chromium 计算出的颜色写法', () => {
  assert.deepEqual(parseCssColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 })
  assert.deepEqual(parseCssColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 })
  assert.deepEqual(parseCssColor('rgb(10 20 30 / 40%)'), { r: 10, g: 20, b: 30, a: 0.4 })
  assert.deepEqual(parseCssColor('color(srgb 1 0.5 0 / 0.25)'), { r: 255, g: 127.5, b: 0, a: 0.25 })
  assert.deepEqual(parseCssColor('transparent'), { r: 0, g: 0, b: 0, a: 0 })
  assert.equal(parseCssColor('oklch(0.5 0.1 200)'), null)
})

test('WCAG 对比度与门槛：正文 4.5、大字与图标 3', () => {
  assert.equal(Math.round(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) * 100) / 100, 21)
  assert.equal(Math.round(contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 }) * 100) / 100, 4.54)
  assert.equal(requiredContrast({ kind: 'text', fontSize: 13, fontWeight: 400 }), 4.5)
  assert.equal(requiredContrast({ kind: 'text', fontSize: 24, fontWeight: 400 }), 3)
  assert.equal(requiredContrast({ kind: 'text', fontSize: 18.66, fontWeight: 700 }), 3)
  assert.equal(requiredContrast({ kind: 'text', fontSize: 20, fontWeight: 600 }), 4.5, '600 不算粗体大字')
  assert.equal(requiredContrast({ kind: 'icon', fontSize: 13, fontWeight: 400 }), 3)
})

test('前景按 alpha 与祖先 opacity 合成到真实背景像素后判定', () => {
  const dark = bitmap(100, 50, () => [20, 21, 23])
  const result = evaluateContrast({ candidates: [
    candidate(),
    candidate({ color: 'rgba(255, 255, 255, 0.3)', text: '半透明白字', element: 'span.a' }),
    candidate({ opacity: 0.35, text: '整体淡出', element: 'span.b' }),
  ], viewport }, dark)
  assert.equal(result.stats.checked, 3)
  assert.deepEqual(result.issues.map((issue) => issue.text), ['半透明白字', '整体淡出'])
  const translucent = result.issues[0]
  // 0.3 白叠在 (20,21,23) 上 ≈ (90,91,92)，与背景对比约 2.9:1。
  assert.ok(translucent.ratio > 2.5 && translucent.ratio < 3.2, String(translucent.ratio))
  assert.equal(translucent.background, 'rgb(20, 21, 23)')
})

test('压在渐变或图片上的前景按最差 10% 背景判定，不被平均值掩盖', () => {
  // 左 70% 深色、右 30% 白：白色图标在右端几乎不可见。
  const gradient = bitmap(100, 50, (x) => (x < 70 ? [16, 16, 16] : [250, 250, 250]))
  const result = evaluateContrast({ candidates: [
    candidate({ kind: 'icon', color: 'rgb(255, 255, 255)', rect: { x: 0, y: 0, width: 100, height: 50 }, text: 'sun', element: 'svg.lucide' }),
  ], viewport }, gradient)
  assert.equal(result.issues.length, 1)
  assert.ok(result.issues[0].ratio < 1.1)
  assert.ok(result.issues[0].medianRatio > 15, '中位数仍然很高，只有分位判定能抓到')
})

test('截图按实际像素密度映射 CSS 坐标（2x 截图、只取候选区域）', () => {
  const doubled = bitmap(200, 100, (x) => (x < 100 ? [255, 255, 255] : [10, 10, 10]))
  assert.equal(sampleBackground(doubled, { x: 60, y: 10, width: 30, height: 10 }, viewport).every((pixel) => pixel.r === 10), true)
  const result = evaluateContrast({ candidates: [
    candidate({ rect: { x: 60, y: 10, width: 30, height: 10 } }),
    candidate({ rect: { x: 5, y: 10, width: 30, height: 10 }, text: '白底白字', element: 'span.c' }),
  ], viewport }, doubled)
  assert.deepEqual(result.issues.map((issue) => issue.text), ['白底白字'])
})

test('只吸收截图 8 位量化的一级误差：4.49 视为达标，4.40 仍是违规', () => {
  // 深海 text3 #7F8D99 压 selected #1A262F 为 4.53；截图读成 (26,39,47) 时约 4.49。
  const quantized = bitmap(100, 50, () => [26, 39, 47])
  const pass = evaluateContrast({ candidates: [candidate({ color: 'rgb(127, 141, 153)' })], viewport }, quantized)
  assert.equal(pass.issues.length, 0)
  const lighter = bitmap(100, 50, () => [33, 41, 51])
  const fail = evaluateContrast({ candidates: [candidate({ color: 'rgb(127, 141, 153)' })], viewport }, lighter)
  assert.equal(fail.issues.length, 1)
})

test('取样四边内收，压在文字盒最外一圈的选中环/描边不算背景', () => {
  // 候选盒 10..50 × 10..22，外圈 1px 是高亮描边，内部是深底。
  const ringed = bitmap(100, 50, (x, y) => (x === 10 || x === 49 || y === 10 || y === 21 ? [106, 155, 254] : [20, 20, 20]))
  const result = evaluateContrast({ candidates: [candidate()], viewport }, ringed)
  assert.equal(result.issues.length, 0)
})

test('透明前景与截图外的候选计入跳过统计，不判也不报', () => {
  const dark = bitmap(100, 50, () => [20, 20, 20])
  const result = evaluateContrast({ candidates: [
    candidate({ color: 'rgba(0, 0, 0, 0)' }),
    candidate({ rect: { x: 200, y: 10, width: 10, height: 10 } }),
    candidate({ color: 'oklch(0.5 0.1 200)' }),
  ], viewport, skipped: { occluded: 2 } }, dark)
  assert.equal(result.stats.checked, 0)
  assert.deepEqual(result.stats.skipped, { occluded: 2, transparentForeground: 1, outsideCapture: 1, unparsedColor: 1 })
})

test('登记的例外按场景/预设/文字/元素命中，且只放宽到登记下限', () => {
  const light = bitmap(100, 50, () => [245, 245, 245])
  const exceptions = validateContrastExceptions([
    { id: 'brand-mark', reason: '品牌字标按品牌色呈现，不承载需要阅读的信息', element: 'data-brand', minRatio: 2 },
    { id: 'paper-only', reason: '只在纸白预设下登记的媒体时间码例外', text: '^00:', presets: ['paper'], scene: '剪辑' },
  ])
  const collected = { candidates: [
    candidate({ color: 'rgb(170, 170, 170)', element: 'span[data-brand]', text: '痕迹' }),
    candidate({ color: 'rgb(235, 235, 235)', element: 'span[data-brand]', text: '痕迹淡' }),
    candidate({ color: 'rgb(170, 170, 170)', element: 'span.time', text: '00:01' }),
  ], viewport }
  const paper = evaluateContrast(collected, light, { exceptions, scene: '剪辑-时间线', themePreset: 'paper' })
  assert.deepEqual(paper.exempted.map((item) => item.exception), ['brand-mark', 'paper-only'])
  assert.deepEqual(paper.issues.map((issue) => issue.text), ['痕迹淡'], '低于登记下限仍是违规')
  const graphite = evaluateContrast(collected, light, { exceptions, scene: '剪辑-时间线', themePreset: 'graphite' })
  assert.deepEqual(graphite.issues.map((issue) => issue.text), ['痕迹淡', '00:01'])
  const otherScene = evaluateContrast(collected, light, { exceptions, scene: '设置-外观', themePreset: 'paper' })
  assert.deepEqual(otherScene.issues.map((issue) => issue.text), ['痕迹淡', '00:01'])
})

test('maxOpacity 只豁免被有意整体淡化的状态，正常显示的同一元素仍按门槛判', () => {
  const dark = bitmap(100, 50, () => [70, 70, 70])
  const exceptions = validateContrastExceptions([
    { id: 'hidden-track', reason: '隐藏轨上的片段整体半透明表达“不参与输出”', element: 'clip-label', maxOpacity: 0.5, minRatio: 1.5 },
  ])
  const collected = { candidates: [
    candidate({ color: 'rgb(255, 255, 255)', opacity: 0.5, element: 'span.clip-label', text: '隐藏轨' }),
    candidate({ color: 'rgb(150, 150, 150)', opacity: 1, element: 'span.clip-label', text: '正常轨' }),
  ], viewport }
  const result = evaluateContrast(collected, dark, { exceptions })
  assert.deepEqual(result.exempted.map((item) => item.text), ['隐藏轨'])
  assert.deepEqual(result.issues.map((item) => item.text), ['正常轨'])
  assert.throws(() => validateContrastExceptions([{ id: 'x', reason: '这是一条足够长的理由', text: 'x', maxOpacity: 1 }]), /maxOpacity/)
})

test('例外登记必须有理由、匹配条件、合法正则与唯一 id', () => {
  const base = { id: 'a', reason: '装饰性纹理上的水印，用户不读取', text: 'x' }
  assert.throws(() => validateContrastExceptions([{ ...base, reason: '' }]), /必须写明理由/)
  assert.throws(() => validateContrastExceptions([{ id: 'a', reason: base.reason }]), /至少要用 text 或 element/)
  assert.throws(() => validateContrastExceptions([{ ...base, element: '(' }]), /element 正则无效/)
  assert.throws(() => validateContrastExceptions([base, base]), /id 重复/)
  assert.throws(() => validateContrastExceptions([{ ...base, kind: 'border' }]), /kind 只能是/)
  assert.throws(() => validateContrastExceptions([{ ...base, minRatio: 0.5 }]), /minRatio/)
})

test('仓库内的例外登记文件可以加载且每条都合法', () => {
  assert.doesNotThrow(() => loadContrastExceptions(DEFAULT_EXCEPTIONS_FILE))
})
