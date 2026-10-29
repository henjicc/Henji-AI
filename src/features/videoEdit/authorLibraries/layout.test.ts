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
import { recordAuthorCanvas, replayAuthorCanvas } from '../engine/videoEditAuthorCanvasRecorder'
import { observeTextLayouts, textRectCorners, type TextRasterProvider } from '../../../core/videoEdit/textDrawObservation'
import { videoEditTextOverflowFacts } from '../../../core/videoEdit/textOverflowReview'

beforeAll(async () => { await ready })
afterEach(() => { vi.unstubAllGlobals() })

const fixtureCanvas = (): ReturnType<typeof createTextCanvasRecorder> => {
  const recorder = createTextCanvasRecorder()
  vi.stubGlobal('OffscreenCanvas', recorder.Canvas)
  vi.stubGlobal('ImageBitmap', recorder.Bitmap)
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
  context.drawImage(canvas.transferToImageBitmap(), bounds.x, bounds.y, canvas.width, canvas.height)
  expect(actual.snapshot()).toEqual(expected.snapshot())
})

it('同一布局只栅格化一次，平移与透明度变化复用位图，缩放和颜色空间分别复用各自档位', () => {
  const { Canvas } = fixtureCanvas(), transfer = vi.spyOn(Canvas.prototype, 'transferToImageBitmap'), contexts = vi.spyOn(Canvas.prototype, 'getContext')
  const target = new Canvas(640, 360).getContext(), draw = vi.fn(); target.drawImage = draw
  const layout = layoutText('缓存标题', { fontSize: 20 })
  drawText(target, layout); target.translate(10, 20); target.globalAlpha = .5; drawText(target, layout)
  expect(transfer).toHaveBeenCalledOnce()
  expect(draw.mock.calls[1][0]).toBe(draw.mock.calls[0][0])
  const bitmap = draw.mock.calls[0][0] as ImageBitmap, closeFirst = vi.spyOn(bitmap, 'close')
  target.scale(2, 2); drawText(target, layout)
  const doubled = draw.mock.calls[2][0] as ImageBitmap
  expect(closeFirst).not.toHaveBeenCalled()
  expect(doubled.width).toBe(bitmap.width * 2); expect(doubled.height).toBe(bitmap.height * 2)
  expect(draw.mock.calls[2].slice(1)).toEqual(draw.mock.calls[0].slice(1))
  target.scale(.75, .75); drawText(target, layout)
  expect(draw.mock.calls[3][0]).toBe(doubled)
  target.scale(2, 2); drawText(target, layout)
  const quadrupled = draw.mock.calls[4][0] as ImageBitmap
  expect(quadrupled.width).toBe(bitmap.width * 4)
  target.scale(10, 10); drawText(target, layout)
  expect(draw.mock.calls[5][0]).toBe(quadrupled)
  ;(target as OffscreenCanvasRenderingContext2D & TextRasterProvider).getContextAttributes = () => ({ colorSpace: 'display-p3' })
  drawText(target, layout); drawText(target, layout)
  expect(draw.mock.calls[6][0]).not.toBe(quadrupled)
  expect(draw.mock.calls[7][0]).toBe(draw.mock.calls[6][0])
  expect(contexts).toHaveBeenCalledWith('2d', { colorSpace: 'display-p3' })
  expect(transfer).toHaveBeenCalledTimes(4)
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
  const boxes = layoutBoxes({ id: 'root', style: { width: '100%', height: '100%', padding: 10, gap: 8, alignItems: 'center' }, children: [{ id: 'a', style: { width: 40, height: 20 } }, { id: 'b', style: { flexGrow: 1, height: 60, flexDirection: 'column', gap: 4, padding: 5 }, children: [{ id: 'c', style: { height: 10 } }, { id: 'd', style: { flexGrow: 1 } }] }] }, { width: 200, height: 100 })
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

it('根未声明尺寸时按内容收缩，显式百分比根才铺满画幅', () => {
  fixtureCanvas()
  const children = [{ id: 'child', style: { width: 80, height: 30 } }]
  const natural = layoutBoxes({ id: 'root', style: { padding: 10 }, children }, { width: 640, height: 360 })
  expect(natural.root).toMatchObject({ width: 100, height: 50 })
  const full = layoutBoxes({ id: 'root', style: { width: '100%', height: '100%', padding: 10 }, children }, { width: 640, height: 360 })
  expect(full.root).toMatchObject({ width: 640, height: 360 })
})

it('maxLines 测量仅占实际显示高度，最终布局仍报告完整行数和遗漏', () => {
  fixtureCanvas()
  const boxes = layoutBoxes({ id: 'card', style: { width: 60, padding: 5, flexDirection: 'column' }, children: [{ id: 'title', text: { content: '中文标题中文标题', style: { fontSize: 20 }, options: { maxLines: 1 } } }] }, { width: 300, height: 300 })
  const title = boxes.title.text!
  expect(title.totalLines).toBeGreaterThan(1)
  expect(title.lines).toHaveLength(1)
  expect(title.truncated).toBe(true)
  expect(title.omittedRanges.length).toBeGreaterThan(0)
  expect(boxes.title.height).toBeCloseTo(title.visibleContentSize.height)
  expect(boxes.card.height).toBeCloseTo(boxes.title.height + 10)
})

it('flex 的中间测量布局不进入待绘制集合，最终布局与实际绘制一一对应', () => {
  const { Canvas } = fixtureCanvas(), observed = new Set<string>()
  const boxes = observeTextLayouts(id => observed.add(id), () => layoutBoxes({ id: 'card', style: { width: 75, padding: 8 }, children: [{ id: 'title', text: { content: '中文标题中文标题', style: { fontSize: 20 }, options: { maxLines: 1 } } }] }, { width: 300, height: 200 }))
  const context = new Canvas(300, 200).getContext(); context.reset = vi.fn()
  const recording = recordAuthorCanvas({ width: 300, height: 200 }, context, [1, 0, 0, 1, 0, 0], ctx => drawText(ctx, boxes.title.text!))
  expect([...observed]).toEqual(recording.textDraws.map(draw => draw.layoutId))
})

it.each([false, true])('基线由首行字母基线提供，大小字号与嵌套容器对齐：nested=%s', nested => {
  fixtureCanvas()
  const value: FlexNode = { id: 'value', text: { content: '98.6', style: { fontSize: 80 } } }
  const boxes = layoutBoxes({ id: 'row', style: { alignItems: 'baseline', padding: 7, gap: 12 }, children: [
    { id: 'label', text: { content: '准确率\n说明', style: { fontSize: 20 } } },
    nested ? { id: 'valueBox', style: { padding: 4 }, children: [value] } : value,
    { id: 'unit', text: { content: '%', style: { fontSize: 32, leading: 55 } } },
  ] }, { width: 640, height: 360 })
  const baseline = (id: string) => boxes[id].contentBox.y + boxes[id].text!.lines[0].alphabeticBaseline
  expect(baseline('label')).toBeCloseTo(baseline('value'), 4)
  expect(baseline('unit')).toBeCloseTo(baseline('value'), 4)
  expect(Object.keys(boxes).length).toBe(nested ? 5 : 4)
})

it('alignSelf baseline 与受限换行、maxLines 共用最终基线，观察集合只有最终布局', () => {
  fixtureCanvas()
  const observed = new Set<string>()
  const boxes = observeTextLayouts(id => observed.add(id), () => layoutBoxes({ id: 'row', style: { width: 220, alignItems: 'start', gap: 10 }, children: [
    { id: 'label', style: { width: 60, alignSelf: 'baseline' }, text: { content: '很长的标签文字', style: { fontSize: 20 }, options: { maxLines: 1 } } },
    { id: 'value', style: { alignSelf: 'baseline' }, text: { content: '98.6', style: { fontSize: 60 } } },
  ] }, { width: 640, height: 360 }))
  expect(boxes.label.text!.truncated).toBe(true)
  expect(boxes.label.text!.lines).toHaveLength(1)
  expect(boxes.label.contentBox.y + boxes.label.text!.lines[0].alphabeticBaseline).toBeCloseTo(boxes.value.contentBox.y + boxes.value.text!.lines[0].alphabeticBaseline, 4)
  expect(observed.size).toBe(2)
})

it.each([-30, 30])('基线偏移 %s 越过行框时，参考节点不改变文字高度或反馈移动基线', baselineShift => {
  fixtureCanvas()
  const boxes = layoutBoxes({ id: 'row', style: { alignItems: 'baseline' }, children: [
    { id: 'label', text: { content: 'A', style: { fontSize: 20, baselineShift } } },
    { id: 'value', text: { content: 'B', style: { fontSize: 80 } } },
  ] }, { width: 640, height: 360 })
  expect(boxes.label.height).toBeCloseTo(boxes.label.text!.visibleContentSize.height, 4)
  expect(boxes.label.contentBox.y + boxes.label.text!.lines[0].alphabeticBaseline).toBeCloseTo(boxes.value.contentBox.y + boxes.value.text!.lines[0].alphabeticBaseline, 4)
})

it('只有实际 drawText 才向录制通道送事实，并关联当次矩阵、矩形 clip、未知路径及空绘制截断', () => {
  const { Canvas } = fixtureCanvas()
  const measure = new Canvas(1, 1).getContext()
  measure.reset = () => {}
  const layout = layoutText('标题\n第2行', { fontSize: 20 }, { maxLines: 1, maxWidth: 100 })
  const run = (draw: (ctx: OffscreenCanvasRenderingContext2D) => void) => recordAuthorCanvas({ width: 500, height: 300 }, measure, [2, 0, 0, 2, 6, 8], draw)
  expect(run(() => { layoutText('未绘制', {}, { maxWidth: 1 }) }).textDraws).toEqual([])
  const recorded = run(ctx => {
    ctx.save(); ctx.translate(10, 20); ctx.beginPath(); ctx.rect(0, 0, 30, 40); ctx.clip(); drawText(ctx, layout); ctx.restore()
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI); ctx.clip(); drawText(ctx, layout); ctx.restore()
    drawText(ctx, layoutText('全部被截断', { fontSize: 20 }, { maxHeight: 0 }))
  })
  expect(recorded.textDraws).toHaveLength(3)
  expect(recorded.textDraws[0]).toMatchObject({ matrix: [1, 0, 0, 1, 10, 20], actualLines: 1, totalLines: 2, truncated: true, uncovered: [] })
  expect(recorded.textDraws[0].clips.at(-1)).toEqual([[10, 20], [40, 20], [40, 60], [10, 60]])
  expect(recorded.textDraws[1].uncovered).toContain('任意 Canvas clip')
  expect(recorded.textDraws[2]).toMatchObject({ actualLines: 0, truncated: true, uncovered: [] })
  const hidden = run(ctx => drawText(ctx, layoutText('只画阴影', { fill: { enabled: false } }))).textDraws[0]
  expect(hidden.bodyCoverage).toBe('none')
  expect(hidden.uncovered.length).toBeGreaterThan(0)
  expect(run(ctx => { ctx.clearRect(0, 0, 500, 300); drawText(ctx, layout) }).textDraws[0].retained).not.toBe(false)
  expect(run(ctx => { drawText(ctx, layout); ctx.clearRect(0, 0, 500, 300) }).textDraws[0].retained).toBe(false)
})

it('内容等价的每帧排版复用冻结对象，LRU 淘汰关闭位图但录制仍能恢复原规格', () => {
  const { Canvas } = fixtureCanvas(), transfer = vi.spyOn(Canvas.prototype, 'transferToImageBitmap')
  const target = new Canvas(640, 360).getContext(), draw = vi.fn(); target.drawImage = draw
  const layout = layoutText('每帧排版', { fontSize: 20 }, { maxWidth: 100 })
  drawText(target, layout)
  const image = draw.mock.calls[0][0] as ImageBitmap, close = vi.spyOn(image, 'close').mockImplementation(() => { Object.defineProperty(image, 'width', { value: 0 }); Object.defineProperty(image, 'height', { value: 0 }) })
  target.reset = vi.fn()
  const recording = recordAuthorCanvas({ width: 640, height: 360 }, target, [1, 0, 0, 1, 0, 0], ctx => drawText(ctx, layout))
  expect(layoutText('每帧排版', { fontSize: 20 }, { maxWidth: 100 })).toBe(layout)
  drawText(target, layoutText('每帧排版', { fontSize: 20 }, { maxWidth: 100 }))
  expect(transfer).toHaveBeenCalledOnce()
  expect(Object.isFrozen(layout)).toBe(true); expect(Object.isFrozen(layout.graphemes[0].style.fill)).toBe(true)
  expect(() => Object.assign(layout.box, { width: 0 })).toThrow()
  for (let i = 0; i < 140; i++) layoutText(`淘汰${i}`, { fontSize: 20 })
  expect(close).toHaveBeenCalledOnce()
  expect(layoutText('每帧排版', { fontSize: 20 }, { maxWidth: 100 })).not.toBe(layout)
  replayAuthorCanvas(recording, target, () => { throw new Error('没有素材') })
  expect(transfer).toHaveBeenCalledTimes(2)
  expect(draw.mock.calls.at(-1)![0]).not.toBe(image)
  expect(recording.textDraws[0]).toMatchObject({ sourceText: '每帧排版' })
})
it('字体加载、添加和替换会使同样内容重新排版', () => {
  fixtureCanvas()
  const listeners = new Map<string, () => void>(), faces = new Set<object>()
  vi.stubGlobal('fonts', { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: () => {}, forEach: (callback: (face: object) => void) => faces.forEach(callback) })
  const first = layoutText('字体变化', { fontSize: 20 })
  expect(layoutText('字体变化', { fontSize: 20 })).toBe(first)
  listeners.get('loadingdone')!()
  const loaded = layoutText('字体变化', { fontSize: 20 }); expect(loaded).not.toBe(first)
  faces.add({ status: 'loaded', family: '替换字体', style: 'normal', weight: '400', stretch: 'normal' })
  expect(layoutText('字体变化', { fontSize: 20 })).not.toBe(loaded)
})
it('超大文字按边长和面积降档，仍以原逻辑尺寸绘制', () => {
  const { Canvas } = fixtureCanvas(), context = new Canvas(100, 100).getContext(), draw = vi.fn(); context.drawImage = draw
  context.scale(4, 4)
  drawText(context, layoutText('超大文字'.repeat(600), { fontSize: 100 }, { wrap: 'none' }))
  const bitmap = draw.mock.calls[0][0] as ImageBitmap
  expect(Math.max(bitmap.width, bitmap.height)).toBeLessThanOrEqual(8192)
  expect(bitmap.width * bitmap.height).toBeLessThanOrEqual(32 * 1024 * 1024)
  expect(draw.mock.calls[0][3]).toBeGreaterThan(bitmap.width)
})
it('字素揭示绘制整段布局，保留被截断行的约束与遗漏', () => {
  const { Canvas } = fixtureCanvas(), context = new Canvas(640, 360).getContext()
  const layout = layoutText('第一行\n第二行', { fontSize: 20 }, { maxLines: 1, forceGraphemes: true })
  context.reset = vi.fn()
  const record = (count: number) => recordAuthorCanvas({ width: 640, height: 360 }, context, [1, 0, 0, 1, 0, 0], ctx => drawText(ctx, layout, { graphemes: count }))
  const partial = record(1).textDraws[0], complete = record(layout.graphemes.length).textDraws[0]
  expect(partial).toMatchObject({ sourceText: '第一行\n第二行', actualLines: 1, totalLines: 2, revealComplete: false, truncated: true })
  expect(complete).toMatchObject({ revealComplete: true, omittedRanges: [expect.objectContaining({ reason: 'maxLines' })] })
  expect(complete.layoutId).toBe(partial.layoutId)
})

it.each([{ text: '悬AV', options: { maxWidth: 1, wrap: 'none' as const }, kind: 'text_overflow' }, { text: '悬AV\n遗漏', options: { maxLines: 1 }, kind: 'text_truncated' }])('逐字图集跨帧和重放复用，全部可见后报告 $kind', ({ text, options, kind }) => {
  const fixture = fixtureCanvas(), { Canvas } = fixture, transfer = vi.spyOn(Canvas.prototype, 'transferToImageBitmap')
  const ctx = new Canvas(640, 360).getContext(); ctx.reset = vi.fn()
  const draw = vi.fn(); ctx.drawImage = draw
  const samples = []
  for (let frame = 0; frame < 20; frame++) {
    const layout = layoutText(text, { fontSize: 20, fauxItalic: true, tracking: -200, underline: true, background: { enabled: true, color: BLACK_HEX, opacity: .6, padding: 4, radius: 3 }, strokes: [{ color: BLACK_HEX, width: 2, position: 'outside' }] }, options)
    const recording = recordAuthorCanvas({ width: 640, height: 360 }, ctx, [1, 0, 0, 1, 0, 0], target => drawText(target, layout, { graphemes: (_g, i) => ({ opacity: frame >= 5 || i === 0 ? .5 : 0, x: frame / 10, y: i, rotate: frame / 100 }) }))
    expect(recording.textDraws).toHaveLength(1)
    const fact = recording.textDraws[0]
    expect(fact.revealComplete).toBe(frame >= 5)
    samples.push({ frame, drawIndex: 0, draw: fact, inkQuad: [], effectiveClips: [], frameClips: [], opacity: 1 })
    replayAuthorCanvas(recording, ctx, () => { throw new Error('没有素材') })
  }
  expect(transfer).toHaveBeenCalledOnce()
  expect(new Set(draw.mock.calls.map(args => args[0])).size).toBe(1)
  const records = videoEditTextOverflowFacts(samples, 30, { sequenceId: 's', path: [], subjectId: 'c', elementPath: ['title'] })
  expect(records.map(row => row.kind)).toEqual([kind])
  expect(records[0].timeline).toEqual({ from: 5, to: 20 })
  // 每个文字表面只有一个字素簇，斜体和负字距也无法把邻字的像素带入图集格子。
  const surfaces = fixture.snapshot() as Array<{ operations: Array<{ op: string; args: unknown[] }> }>
  const texts = surfaces.map(surface => surface.operations.filter(op => op.op === 'fillText').map(op => op.args[0])).filter(values => values.length)
  expect(texts.every(values => values.length === 1 && ['悬', 'A', 'V'].includes(String(values[0])))).toBe(true)
})

it('同帧底稿、字素揭示和两档分辨率共存，超过四档才关闭最久未使用的位图', () => {
  const { Canvas } = fixtureCanvas(), transfer = vi.spyOn(Canvas.prototype, 'transferToImageBitmap')
  const ctx = new Canvas(100, 100).getContext(), images: ImageBitmap[] = []
  ctx.drawImage = image => { images.push(image as ImageBitmap) }
  const layout = layoutText('缓存', { fontSize: 20 })
  const paint = () => {
    for (const scale of [1, 2]) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawText(ctx, layout); drawText(ctx, layout, { graphemes: (_g, i) => ({ opacity: .5, y: i }) })
    }
  }
  paint(); const first = images[0], close = vi.spyOn(first, 'close'); paint()
  // 1× 与 2× 的逐字动画共用最低 2× 图集，静态位图仍各自按实际档位缓存。
  expect(transfer).toHaveBeenCalledTimes(3); expect(close).not.toHaveBeenCalled()
  ctx.setTransform(4, 0, 0, 4, 0, 0); drawText(ctx, layout)
  expect(close).not.toHaveBeenCalled()
  drawText(ctx, layout, { graphemes: () => ({ opacity: .5 }) })
  expect(close).toHaveBeenCalledOnce(); expect(transfer).toHaveBeenCalledTimes(5)
})

it('落定图集以独立字素实际墨迹恢复裁切复核，运动期间仍说明未覆盖', () => {
  const { Canvas } = fixtureCanvas(), context = new Canvas(100, 100).getContext()
  context.reset = vi.fn()
  const layout = layoutText('AVf', { fontSize: 20, fauxItalic: true }, { anchor: { x: 85.3, y: 20.2, horizontal: 0, vertical: 0 } })
  const record = (moving: boolean) => recordAuthorCanvas({ width: 100, height: 100 }, context, [1, 0, 0, 1, 0, 0], ctx => drawText(ctx, layout, { graphemes: () => moving ? { x: .1 } : {} }))
  const motion = record(true).textDraws[0], settled = record(false).textDraws[0]
  expect(motion.animatedGraphemes).toBe(true)
  expect(settled.animatedGraphemes).toBeUndefined()
  expect(settled.uncovered).not.toContain('独立字素动画的墨迹裁切')
  expect(settled.inkBounds).not.toEqual(layout.inkBounds)
  const samples = Array.from({ length: 20 }, (_, frame) => ({ frame, drawIndex: 0, draw: settled, inkQuad: textRectCorners(settled.inkBounds!), effectiveClips: [], frameClips: [textRectCorners({ x: 0, y: 0, width: 100, height: 100 })], opacity: 1 }))
  expect(videoEditTextOverflowFacts(samples, 30, { sequenceId: 's', path: [], subjectId: 'title', elementPath: ['title'] }).map(record => record.kind)).toEqual(['text_clipped'])
})

it('支持字体事件的宿主只读代次，增删和加载通知才失效', () => {
  fixtureCanvas()
  const listeners = new Map<string, () => void>(), fonts = new Set<object>()
  const forEach = vi.spyOn(fonts, 'forEach')
  Object.assign(fonts, { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: () => {} })
  vi.stubGlobal('fonts', fonts)
  const run = () => layoutText('事件字体', { fontSize: 20 })
  const first = run(); expect(run()).toBe(first)
  const face = {}; fonts.add(face); const added = run(); expect(added).not.toBe(first)
  expect(run()).toBe(added); fonts.delete(face); const removed = run(); expect(removed).not.toBe(added)
  listeners.get('loadingerror')!(); expect(run()).not.toBe(removed)
  expect(forEach).not.toHaveBeenCalled()
})
