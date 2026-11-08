import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import * as hb from '../../../../../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import { TextShaper } from './harfbuzz'
import { TextFontSession } from './fontPolicy'
import { createShapedTextPlan } from './textPlan'
import { textStyleSchema } from '../text'

const file = ['C:/Windows/Fonts/calibri.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(existsSync)
const close: Array<() => void> = []
afterEach(() => close.splice(0).forEach(call => call()))
async function setup() {
  if (!file) throw new Error('此真实字体测试需要 Calibri、DejaVuSans 或 Arial')
  const data = readFileSync(file), bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const shaper = new TextShaper(hb), fonts = new TextFontSession('win32', async () => ({ bytes }))
  close.push(() => shaper.dispose(), () => fonts.close()); await fonts.prepare()
  return { shaper, fonts, source: { bytes, hash: createHash('sha256').update(data).digest('hex') } }
}

it('作者计划的整簇位置、字形推进、fit 与原文范围来自同一 HB 几何', async () => {
  const { shaper, fonts, source } = await setup(), style = textStyleSchema.parse({ fontSize: 40, align: 'left' })
  const plan = createShapedTextPlan(shaper, fonts, 'ffi AV', style, { ligatures: true })
  expect(plan.contentSize.width).toBeCloseTo(shaper.shape(source, 'ffi AV', { size: 40, ligatures: true, script: 'Latn', features: { kern: 1 } }).width)
  expect(plan.graphemes[1].owner).toBe(0)
  expect(plan.graphemes[1].x).toBe(plan.graphemes[0].x)
  expect(plan.clusters[0].owner).toBe(0)
  expect(plan.inkBounds!.width).toBeGreaterThan(0)
  const fit = createShapedTextPlan(shaper, fonts, 'Very long title', style, { wrap: 'none', maxWidth: 100, fit: { minFontSize: 10 }, anchor: { x: 200, y: 100, horizontal: .5, vertical: .5 } })
  expect(fit.fit.applied).toBe(true); expect(fit.fit.failed).toBe(false)
  expect(fit.contentSize.width).toBeLessThanOrEqual(100 + 1 / 64)
  expect(fit.box.x + fit.box.width / 2).toBe(200)
  const truncated = createShapedTextPlan(shaper, fonts, 'a\r\nb\nc', style, { maxLines: 1 })
  expect(truncated.lines).toHaveLength(1)
  expect(truncated.totalLines).toBe(3)
  expect(truncated.omittedRanges.map(range => [range.start, range.end])).toEqual([[3, 5], [5, 6]])
})

it('富文本绘制样式不拆形，大小写展开仍由原字素拥有，行高与截断反映实际行', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40, align: 'left', verticalAlign: 'top' })
  const content = { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ align: 'left' as const, direction: 'ltr' as const, spaceBefore: 0, spaceAfter: 0, runs: [{ text: 'aß', style: { ...style, allCaps: true } }, { text: ' AV', style }] }] }
  const plan = createShapedTextPlan(shaper, fonts, content, style)
  expect(plan.graphemes.map(g => g.text)).toEqual(['a', 'ß', ' ', 'A', 'V'])
  expect(plan.graphemes[1].displayText).toBe('SS')
  expect(plan.clusters.filter(cluster => cluster.owner === 1)).toHaveLength(1)
  expect(plan.graphemes.every(g => plan.groups[g.group].graphemes.includes(plan.graphemes.indexOf(g)))).toBe(true)
  expect(createShapedTextPlan(shaper, fonts, content, style, { maxHeight: 0 }).lines).toHaveLength(0)
})


it('只给 maxWidth 和 fit 时按单行缩字号，富文本行高取实际 run', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40 })
  const plan = createShapedTextPlan(shaper, fonts, 'Very long title', style, { maxWidth: 100, fit: { minFontSize: 10 } })
  expect(plan.lines).toHaveLength(1); expect(plan.fit.applied).toBe(true)
  const small = textStyleSchema.parse({ fontSize: 12, leading: 15, verticalAlign: 'top' })
  const rich = { box: { x: 0, y: 0, width: 200, height: 100 }, paragraphs: [{ align: 'left' as const, direction: 'ltr' as const, spaceBefore: 0, spaceAfter: 0, runs: [{ text: 'a\n\nb', style: small }] }] }
  const result = createShapedTextPlan(shaper, fonts, rich, textStyleSchema.parse({}), { maxHeight: 45 })
  expect(result.lines.map(line => line.height)).toEqual([15, 15, 15]); expect(result.lines[0].height).toBe(15); expect(result.lines[0].y).toBe(0)
  for (const text of ['', '\n', 'a\n']) {
    const content = { ...rich, paragraphs: [{ ...rich.paragraphs[0], runs: [{ text, style: small }] }] }
    const blank = createShapedTextPlan(shaper, fonts, content, textStyleSchema.parse({}))
    expect(blank.lines.every(line => line.height === 15)).toBe(true)
  }
})

it('RTL 必需连字按逻辑原文簇归属，推进不借用视觉邻居', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40 })
  const result = createShapedTextPlan(shaper, fonts, 'سلام', style, { direction: 'rtl' })
  expect(result.graphemes[2].owner).toBe(result.graphemes[1].owner)
  expect(result.graphemes[2].advance).toBe(0)
  expect(result.graphemes.reduce((sum, g) => sum + g.advance, 0)).toBeCloseTo(result.lines[0].width)
})

it('只给 maxWidth 也按它折行', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40, align: 'left' })
  const plan = createShapedTextPlan(shaper, fonts, 'the quick brown fox jumps over the lazy dog', style, { maxWidth: 300, maxLines: 3 })
  expect(plan.lines.length).toBeGreaterThan(1)
  for (const line of plan.lines) expect(line.width).toBeLessThanOrEqual(300)
})

it('软连字符段落不会因提前收手的测量而超栏', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40, align: 'left' })
  const plan = createShapedTextPlan(shaper, fonts, 'abc 2024 super\u00adcali\u00adfragi\u00adlistic\u00adexpi\u00adali\u00addocious\u00adsuper\u00adcali\u00adfragi', style, { maxWidth: 400 })
  for (const line of plan.lines) expect(line.width).toBeLessThanOrEqual(400)
})

it('从右到左段落折行后，行尾空白悬挂在栏外，字不越过盒子右边', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40, align: 'right' })
  const plan = createShapedTextPlan(shaper, fonts, 'שלום עולם שלום עולם שלום עולם שלום', style, { maxWidth: 200, box: { width: 200 } })
  expect(plan.lines.length).toBeGreaterThan(1)
  expect(plan.inkBounds!.x + plan.inkBounds!.width).toBeLessThanOrEqual(201)
})

it('混排段落按自身自然宽度再排一次不折行，两端对齐的余量全部用完', async () => {
  const { shaper, fonts } = await setup(), left = textStyleSchema.parse({ fontSize: 40, align: 'left' })
  const natural = createShapedTextPlan(shaper, fonts, 'א1中', left).contentSize.width
  const again = createShapedTextPlan(shaper, fonts, 'א1中', left, { maxWidth: natural, maxLines: 1 })
  expect(again.truncated).toBe(false)
  const justified = createShapedTextPlan(shaper, fonts, 'abc אבג def ghi jkl mno pqr stu vwx', textStyleSchema.parse({ fontSize: 40, align: 'justify-all' }), { maxWidth: 300, box: { width: 300 } })
  const row = justified.clusters.filter(cluster => cluster.baseline === justified.clusters[0].baseline && cluster.inkBounds)
  expect(Math.max(...row.map(cluster => cluster.x + cluster.advance))).toBeCloseTo(justified.lines[0].x + justified.lines[0].width, 0)
})

it('竖排：行内方向是高，第一列在最右边，拉丁字母转 90 度', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40, leading: 60, align: 'left', verticalAlign: 'top' })
  const plan = createShapedTextPlan(shaper, fonts, 'abcdefgh ijklmnop', style, { writingMode: 'vertical', box: { width: 300, height: 200 } })
  expect(plan.vertical).toBe(true)
  expect(plan.lines.length).toBeGreaterThan(1)
  expect(plan.lines[0].x).toBeGreaterThan(plan.lines[1].x)
  for (const line of plan.lines) { expect(line.height).toBeLessThanOrEqual(200); expect(line.x + line.width).toBeLessThanOrEqual(300) }
  expect(plan.clusters.every(cluster => cluster.rotate === Math.PI / 2)).toBe(true)
  expect(plan.inkBounds!.y).toBeGreaterThanOrEqual(0)
  expect(plan.inkBounds!.y + plan.inkBounds!.height).toBeLessThanOrEqual(201)
})

it('分栏：排满一栏接着下一栏，没给高度时各栏自动等高，放不下时报告被截断', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 30, leading: 40, align: 'left', verticalAlign: 'top' })
  const text = 'the quick brown fox jumps over the lazy dog '.repeat(8)
  const balanced = createShapedTextPlan(shaper, fonts, text, style, { maxWidth: 900, columns: { count: 3, gap: 30 } })
  const lefts = [...new Set(balanced.lines.map(line => Math.round(line.x)))]
  expect(lefts).toHaveLength(3)
  const counts = lefts.map(left => balanced.lines.filter(line => Math.round(line.x) === left).length)
  // 栏高取放得下全文的最小整行数，前面的栏排满，最后一栏收尾；每栏差几行随字体宽度变化
  expect(Math.max(...counts)).toBe(Math.ceil(balanced.lines.length / 3))
  expect(balanced.truncated).toBe(false)
  const small = createShapedTextPlan(shaper, fonts, text, style, { box: { width: 900, height: 80 }, columns: { count: 2, gap: 30 } })
  expect(small.truncated).toBe(true)
  expect(small.omittedRanges.length).toBeGreaterThan(0)
})

it('绕排：矩形把行切成两段，椭圆按弧线退让，字都不压到区域上', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 24, leading: 30, align: 'left', verticalAlign: 'top' })
  const text = 'wrap the words around the shape in the middle of this box '.repeat(10)
  for (const shape of ['rect', 'ellipse'] as const) {
    const exclusion = { x: 200, y: 60, width: 200, height: 120, shape }
    const plan = createShapedTextPlan(shaper, fonts, text, style, { box: { width: 600, height: 400 }, exclusions: [exclusion] })
    for (const cluster of plan.clusters) if (cluster.inkBounds) {
      const { x, y, width, height } = cluster.inkBounds
      const insideX = x + width > exclusion.x + 2 && x < exclusion.x + exclusion.width - 2, insideY = y + height > exclusion.y + exclusion.height / 2 - 4 && y < exclusion.y + exclusion.height / 2 + 4
      expect(insideX && insideY).toBe(false)
    }
    const middle = plan.lines.filter(line => line.y + line.height > 100 && line.y < 140)
    expect(middle.some(line => line.x >= 400)).toBe(true)
  }
})

it('列表：标记不进原文，序号按层级计数，折行悬挂在标记之后', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 24, leading: 30, align: 'left', verticalAlign: 'top' })
  const run = (text: string) => [{ text, style }]
  const paragraph = (text: string, list: object) => ({ runs: run(text), align: 'left' as const, direction: 'auto' as const, spaceBefore: 0, spaceAfter: 0, list })
  const plan = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 300, height: 0 }, paragraphs: [paragraph('first item that is long enough to wrap onto the next line', { type: 'decimal' }), paragraph('second', { type: 'decimal' }), paragraph('nested', { type: 'decimal', level: 1 }), paragraph('third', { type: 'decimal' })] }, style, {})
  const markers = plan.graphemes.filter(g => g.source.start === g.source.end).map(g => g.displayText).join('')
  expect(markers).toBe('1.2.1.3.')
  expect(plan.sourceText.includes('1.')).toBe(false)
  expect(plan.lines[1].x).toBe(plan.lines[0].x)
  expect(plan.lines[0].x).toBeCloseTo(48)
})

it('混大字号的行按 CSS 行盒算高度和基线', async () => {
  const { shaper, fonts } = await setup(), base = textStyleSchema.parse({ fontSize: 20, leading: 30, align: 'left', verticalAlign: 'top' }), large = textStyleSchema.parse({ fontSize: 40, leading: 30, align: 'left', verticalAlign: 'top' })
  const paragraph = (text: string, styled: typeof base) => ({ runs: [{ text, style: styled }], align: 'left' as const, direction: 'auto' as const, spaceBefore: 0, spaceAfter: 0 })
  const plain = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [paragraph('abc', base)] }, base, {})
  const mixed = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ ...paragraph('abc', base), runs: [{ text: 'abc', style: base }, { text: 'DEF', style: large }] }] }, base, {})
  expect(plain.lines[0].height).toBeCloseTo(30)
  expect(mixed.lines[0].height).toBeGreaterThan(30)
})

it('分栏比一个字还窄也能排完，不会卡死', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 60, verticalAlign: 'top', align: 'left' })
  const plan = createShapedTextPlan(shaper, fonts, 'one two three', style, { maxWidth: 280, columns: { count: 3 } })
  expect(plan.truncated).toBe(false)
  expect(plan.graphemes.length).toBe(13)
})

it('绕排默认居中对齐时字也不压到区域上', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 20, leading: 30, align: 'left' })
  const plan = createShapedTextPlan(shaper, fonts, 'word '.repeat(200), style, { box: { width: 400, height: 900 }, exclusions: [{ x: 0, y: 150, width: 400, height: 40 }] })
  expect(plan.lines.length).toBeGreaterThan(5)
  for (const line of plan.lines) expect(line.y + line.height <= 150 + 1e-6 || line.y >= 190 - 1e-6).toBe(true)
})

const list = (text: string, style: ReturnType<typeof textStyleSchema.parse>, options: Record<string, unknown>) => ({ runs: [{ text, style }], align: 'left' as const, direction: 'auto' as const, spaceBefore: 0, spaceAfter: 0, list: options })

it('列表编号：换类型重新数，写新的 start 重新数，每项写同一个 start 仍然往下数', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 20, verticalAlign: 'top', align: 'left' })
  const markerTexts = (items: Array<Record<string, unknown>>) => {
    const plan = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 600, height: 0 }, paragraphs: items.map(item => list('x', style, item)) }, style, {})
    return plan.groups.filter(group => plan.graphemes[group.graphemes[0]]?.source.start === plan.graphemes[group.graphemes[0]]?.source.end).map(group => group.text).join('')
  }
  expect(markerTexts([{ type: 'decimal' }, { type: 'decimal' }, { type: 'alpha' }])).toBe('1.2.a.')
  expect(markerTexts([{ type: 'decimal' }, { type: 'decimal' }, { type: 'decimal', start: 1 }])).toBe('1.2.1.')
  expect(markerTexts([{ type: 'decimal', start: 0 }, { type: 'decimal', start: 0 }, { type: 'decimal', start: 0 }])).toBe('0.1.2.')
})

it('列表标记贴着正文起点，不跟随文字对齐；从右到左的段落标记和缩进都在右边', async () => {
  const { shaper, fonts } = await setup()
  const place = (align: 'left' | 'center', direction: 'auto' | 'rtl') => {
    const style = textStyleSchema.parse({ fontSize: 100, verticalAlign: 'top', align })
    const paragraph = { ...list('abc', style, { type: 'bullet' }), align: direction === 'rtl' ? 'right' as const : 'left' as const, direction }
    const plan = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 1000, height: 0 }, paragraphs: [paragraph] }, style, {})
    const marker = plan.groups.find(group => { const g = plan.graphemes[group.graphemes[0]]; return g.source.start === g.source.end })!.inkBounds!
    return { marker, line: plan.lines[0] }
  }
  const left = place('left', 'auto'), center = place('center', 'auto')
  expect(center.marker.x).toBeCloseTo(left.marker.x)
  expect(left.marker.x + left.marker.width).toBeLessThan(left.line.x)
  const rtl = place('left', 'rtl')
  expect(rtl.line.x + rtl.line.width).toBeLessThan(1000 - 100)
  expect(rtl.marker.x).toBeGreaterThanOrEqual(rtl.line.x + rtl.line.width)
})

it('可见尺寸算上缩进，自适应宽度按它量才不会多折一行', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 40, verticalAlign: 'top', align: 'left' })
  const plain = createShapedTextPlan(shaper, fonts, 'abc def', style, {})
  const paragraph = { runs: [{ text: 'abc def', style }], align: 'left' as const, direction: 'auto' as const, spaceBefore: 0, spaceAfter: 0, indent: 100 }
  const indented = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [paragraph] }, style, {})
  expect(indented.visibleContentSize.width).toBeCloseTo(plain.visibleContentSize.width + 100)
})

it('空段落也走缩进和绕排，不会跑到盒子外面', async () => {
  const { shaper, fonts } = await setup(), style = textStyleSchema.parse({ fontSize: 20, verticalAlign: 'top', align: 'left' })
  const plan = createShapedTextPlan(shaper, fonts, { box: { x: 0, y: 0, width: 600, height: 0 }, paragraphs: [list('', style, { type: 'bullet' })] }, style, {})
  const marker = plan.groups[0].inkBounds!
  expect(marker.x).toBeGreaterThanOrEqual(0)
})
