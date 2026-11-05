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
