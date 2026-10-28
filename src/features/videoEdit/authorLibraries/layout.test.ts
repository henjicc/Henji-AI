import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createTextCanvasRecorder, fixtureTextMetrics } from '../../../core/imaging/vectorContent/textDrawPlanCanvas.testSupport'
import { createTextDrawPlan } from '../../../core/imaging/vectorContent/textDrawPlan'
import { textStyleSchema } from '../../../core/imaging/vectorContent/text'
import { BLACK_HEX } from '../../../core/theme/colorTokens'
import { paintTextDrawPlan } from '../../../core/imaging/vectorContent/textDrawPlanCanvas'
import { paintVectorAppearance } from '../../../services/vectorContent/appearance'
import { runAuthorDeterministic } from '../engine/videoEditAuthorDeterminism'
import { drawText, layoutText, type RichTextContent } from './text'
import { layoutBoxes, ready, type FlexNode } from './flex'

beforeAll(async () => { await ready })
afterEach(() => { vi.unstubAllGlobals() })

const fixtureCanvas = (): ReturnType<typeof createTextCanvasRecorder> => {
  const recorder = createTextCanvasRecorder()
  vi.stubGlobal('OffscreenCanvas', recorder.Canvas)
  return recorder
}

it('同一文字样式与共享计划逐项一致，字素使用推进位置，并保留截断与溢出事实', () => {
  fixtureCanvas()
  const style = textStyleSchema.parse({ fontSize: 32, align: 'left', tracking: 20 })
  const options = { maxWidth: 140, maxLines: 2, wrap: 'grapheme' as const }
  const plan = createTextDrawPlan('AV office 中文标题与第三行', style, { ...options, wrapWidth: 140 }, (text, font, state) => fixtureTextMetrics(text, font, state.fontKerning, state.direction, state.textBaseline))
  const { batches: _batches, rasterBounds: _rasterBounds, ...expected } = plan
  expect(layoutText('AV office 中文标题与第三行', style, options)).toEqual(expected)
  expect(expected.truncated).toBe(true)
  expect(expected.overflow.full.lines).toBe(true)
  expect(expected.omittedRanges.length).toBeGreaterThan(0)
  expect(expected.graphemes[1].x! - expected.graphemes[0].x!).toBe(expected.graphemes[0].advance)
})

it('绘制复用共享计划与 appearance，包含内外描边、阴影和局部纹理留白', () => {
  const style = textStyleSchema.parse({ fontSize: 30, fauxItalic: true, strokes: [{ color: BLACK_HEX, width: 3, position: 'outside' }, { color: BLACK_HEX, width: 2, position: 'inside' }], shadows: [{ color: BLACK_HEX, opacity: .5, angle: 20, distance: 5, size: 2, blur: 4 }] })
  const actual = fixtureCanvas()
  const target = new actual.Canvas(640, 360).getContext()
  drawText(target, layoutText('AV 标题', style))
  const expected = fixtureCanvas()
  const context = new expected.Canvas(640, 360).getContext()
  const plan = createTextDrawPlan('AV 标题', style, {}, (text, font, state) => fixtureTextMetrics(text, font, state.fontKerning, state.direction, state.textBaseline))
  const bounds = plan.rasterBounds
  const canvas = new expected.Canvas(Math.ceil(bounds.width), Math.ceil(bounds.height))
  paintTextDrawPlan(canvas.getContext(), plan, { width: canvas.width, height: canvas.height, x: -bounds.x, y: -bounds.y }, paintVectorAppearance)
  context.drawImage(canvas as unknown as OffscreenCanvas, bounds.x, bounds.y)
  expect(actual.snapshot()).toEqual(expected.snapshot())
})

it('富文本校验保留共享 run 样式的连写身份，结果与文字工具共享计划一致', () => {
  fixtureCanvas()
  const style = textStyleSchema.parse({ fontSize: 20 })
  const content: RichTextContent = { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0, runs: [{ text: 'A', style }, { text: 'V', style }] }] }
  const plan = createTextDrawPlan(content, style, {}, (text, font, state) => fixtureTextMetrics(text, font, state.fontKerning, state.direction, state.textBaseline))
  const { batches: _batches, rasterBounds: _rasterBounds, ...expected } = plan
  expect(layoutText(content, style)).toEqual(expected)
  const invalid = { ...content, paragraphs: [{ ...content.paragraphs[0], runs: [{ text: 'x', style: { ...style, fontSize: 'large' } }] }] } as unknown as RichTextContent
  expect(() => layoutBoxes({ id: 'root', text: { content: invalid } }, { width: 100, height: 100 })).toThrow('富文本.paragraphs.0.runs.0.style.fontSize')
})

it('Yoga 行列、gap、padding 和对齐返回全树坐标', () => {
  const boxes = layoutBoxes({ id: 'root', style: { padding: 10, gap: 8, alignItems: 'center' }, children: [{ id: 'a', style: { width: 40, height: 20 } }, { id: 'b', style: { flexGrow: 1, height: 60, flexDirection: 'column', gap: 4, padding: 5 }, children: [{ id: 'c', style: { height: 10 } }, { id: 'd', style: { flexGrow: 1 } }] }] }, { width: 200, height: 100 })
  expect(boxes.a).toMatchObject({ x: 10, y: 40, width: 40, height: 20 })
  expect(boxes.b).toMatchObject({ x: 58, y: 20, width: 132, height: 60 })
  expect(boxes.c).toMatchObject({ x: 63, y: 25, width: 122, height: 10 })
  expect(boxes.d).toMatchObject({ x: 63, y: 39, width: 122, height: 36 })
})

it('文字节点按自然宽度/上限测量，并在 Exactly 不触发测量时仍按最终内容框排版', () => {
  fixtureCanvas()
  const text = { content: '中文标题中文标题', style: { fontSize: 20, align: 'left' as const } }
  const boxes = layoutBoxes({ id: 'root', style: { flexDirection: 'column', alignItems: 'start' }, children: [{ id: 'natural', text: { content: 'AV', style: text.style } }, { id: 'limited', style: { maxWidth: 60 }, text }, { id: 'exact', style: { width: 100, height: 70, padding: 10 }, text }] }, { width: 300, height: 300 })
  expect(boxes.natural.width).toBeCloseTo(21.6)
  expect(boxes.limited.width).toBe(60)
  expect(boxes.limited.text?.totalLines).toBe(3)
  expect(boxes.exact).toMatchObject({ width: 100, height: 70, contentBox: { width: 80, height: 50 } })
  expect(boxes.exact.text?.lines.map(line => line.text)).toEqual(['中文标题', '中文标题'])
})

it('作者确定性包装内重复排版逐位相同，失败释放后仍能继续计算', () => {
  fixtureCanvas()
  const tree: FlexNode = { id: 'root', style: { gap: 3.25, padding: 7.5 }, children: Array.from({ length: 50 }, (_, index) => ({ id: String(index), style: { flexGrow: 1 }, text: { content: `AV ${index}`, style: { fontSize: 12 } } })) }
  const run = (): string => runAuthorDeterministic('draw', .5, () => JSON.stringify(layoutBoxes(tree, { width: 1920, height: 1080 }), (_key, value: unknown) => typeof value === 'number' ? Buffer.from(new Float64Array([value]).buffer).toString('hex') : value))
  const expected = run()
  for (let index = 0; index < 20; index++) expect(run()).toBe(expected)
  expect(() => layoutBoxes({ id: 'x', children: [{ id: 'x' }] }, { width: 100, height: 100 })).toThrow('id 重复')
  expect(run()).toBe(expected)
})

it('零内容框保留遗漏与超框事实', () => {
  fixtureCanvas()
  const text = { content: '中文标题', style: { fontSize: 20 } }
  const collapsed = layoutBoxes({ id: 'root', children: [{ id: 'title', style: { width: 20, height: 20, padding: 10 }, text }] }, { width: 100, height: 100 })
  expect(collapsed.title.contentBox).toMatchObject({ width: 0, height: 0 })
  expect(collapsed.title.text).toMatchObject({ truncated: true, lines: [], overflow: { full: { width: true, height: true } } })
})
