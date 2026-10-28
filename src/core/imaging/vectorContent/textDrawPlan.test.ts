import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLACK_HEX, WHITE_HEX } from '../../theme/colorTokens'
import { paintText, rasterizeText } from '../../../services/vectorContent/textRaster'
import { paintVectorAppearance } from '../../../services/vectorContent/appearance'
import { rasterizeVectorContent } from '../../../services/vectorContent/raster'
import { layoutRichText } from './richText'
import { defaultTextStyle, layoutText, scaleTextStyle, textAlignmentAnchor, type TextStyle } from './text'
import { layoutCodeText as materialTextLayout } from '../../videoEdit/codeMaterial/textLayout'
import type { RichTextContent } from './contracts'
import { createTextDrawPlan, legacyTextPlanGlyphs, TextDrawPlanError, type TextDrawConstraints, type TextPlanMeasure } from './textDrawPlan'
import { layoutCodeText, type CodeTextMeasureRequest, type CodeTextLayout } from './codeTextLayout'
import { canvasTextPlanMeasure, paintTextDrawPlan } from './textDrawPlanCanvas'
import { createTextCanvasRecorder, fixtureTextMetrics, textDrawGolden } from './textDrawPlanCanvas.testSupport'

const frame = { width: 640, height: 360 }
const measure: TextPlanMeasure = (text, font, state) => fixtureTextMetrics(text, font, state.fontKerning, state.direction, state.textBaseline)
const base = (): TextStyle => ({ ...defaultTextStyle(360), fontSize: 32 })
afterEach(() => { vi.unstubAllGlobals() })
function frozen(key: string, value: unknown): void {
  expectSameDrawing(value, textDrawGolden[key])
}

function adaptedCode(request: CodeTextMeasureRequest, fontPlacement: 'em' | 'font' = 'em', measurement: TextPlanMeasure = measure): CodeTextLayout {
  const style = { ...defaultTextStyle(720), fontFamily: request.fontFamily, fontWeight: request.fontWeight, fontStyle: request.fontStyle as TextStyle['fontStyle'], fontSize: request.fontSize, tracking: request.letterSpacing / request.fontSize * 1000, leading: request.fontSize * request.lineHeight, align: 'left' as const, verticalAlign: 'top' as const }
  const plan = createTextDrawPlan(request.text, style, {
    wrap: request.wrap ? 'word' : 'none', wrapWidth: request.wrap && request.maxWidth ? request.maxWidth : undefined,
    maxWidth: request.maxWidth || undefined, maxLines: request.maxLines || undefined, trim: true, minimumWidth: 'zero',
    baseline: 'alphabetic', alphabeticPlacement: fontPlacement, fontKerning: 'auto', letterSpacing: request.letterSpacing, truncate: false,
    fit: { minFontSize: 1, maxFontSize: request.fontSize, algorithm: 'continuous', iterations: 12, trigger: 'maxLines' },
  }, measurement)
  if (plan.fit.error) throw new TextDrawPlanError(plan.fit.error.code, plan.fit.error.message)
  return { width: plan.contentSize.width, height: plan.contentSize.height, lines: plan.lines.map(line => line.text), lineWidths: plan.lines.map(line => line.width), baselineOffset: plan.lines[0].alphabeticBaseline, fontSize: plan.style.fontSize, font: plan.groups[0]?.font ?? `normal 400 ${plan.style.fontSize}px sans-serif`, glyphs: legacyTextPlanGlyphs(plan, measurement) }
}

describe('审查回归与作者适配边界', () => {
  it('构建后字体加载不影响字素、纹理边界、绘制与序列化，也不再量字', () => {
    let calls = 0, fontLoaded = false
    const text = 'AV office 中文标题'.repeat(150)
    const plan = createTextDrawPlan(text, base(), {}, (text, font, state) => {
      calls++
      const metrics = fixtureTextMetrics(text, font, state.fontKerning, state.direction, state.textBaseline)
      return { ...metrics, width: metrics.width * (fontLoaded ? 2 : 1) }
    })
    const expected = structuredClone(createTextDrawPlan(text, base(), {}, measure))
    const before = calls
    fontLoaded = true
    record(context => paintTextDrawPlan(context, plan, frame, paintVectorAppearance))
    const ids = plan.groups[0].graphemes
    expect(ids).toHaveLength(plan.graphemes.length)
    expect(ids.at(-1)).toBe(plan.graphemes.length - 1)
    expect(plan.rasterBounds).toEqual(expected.rasterBounds)
    expect(structuredClone(plan)).toEqual(expected)
    expect(plan.graphemes).toBe(plan.graphemes)
    expect(calls).toBe(before)
  })
  it('富文本栅格在绘出一个 run 后取消，不再绘制后续 run', () => {
    const controller = new AbortController(), reason = new Error('取消文字绘制')
    const recorder = createTextCanvasRecorder()
    let painted = 0
    vi.stubGlobal('OffscreenCanvas', class extends recorder.Canvas {
      constructor(width: number, height: number) {
        super(width, height)
        const context = this.getContext(), fillText = context.fillText.bind(context)
        context.fillText = (...args: Parameters<typeof context.fillText>) => {
          fillText(...args)
          painted++
          controller.abort(reason)
        }
      }
    })
    const content: RichTextContent = { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ runs: [{ text: 'A', style: base() }, { text: 'B', style: { ...base(), fontSize: 24 } }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }
    expect(() => rasterizeVectorContent({ type: 'text', content }, { x: 0, y: 0, width: 320, height: 180, scale: 1 }, { sourceVersion: 'fixture', time: { kind: 'static' }, referenceGrid: frame, quality: 'final', signal: controller.signal })).toThrow(reason)
    expect(painted).toBe(1)
  })
  it('作者适配链用错误码传递非法度量、字距和 fit 失败', () => {
    const request: CodeTextMeasureRequest = { text: 'ABC', fontFamily: 'sans-serif', fontWeight: 400, fontStyle: 'normal', fontSize: 32, letterSpacing: 0, lineHeight: 1.2, maxWidth: 0, wrap: false, maxLines: 0 }
    for (const layout of [layoutCodeText, materialTextLayout]) {
      expect(() => layout(request, () => NaN, { alphabeticPlacement: 'em' })).toThrow(expect.objectContaining({ code: 'CONTEXT', message: '字体度量无效。' }))
      expect(() => layout({ ...request, letterSpacing: -100 }, () => 1, { alphabeticPlacement: 'em' })).toThrow(expect.objectContaining({ code: 'BUDGET', message: 'letterSpacing 使文字宽度小于零，请减小负字距。' }))
      expect(() => layout({ ...request, maxLines: 1, maxWidth: 1 }, () => 100, { alphabeticPlacement: 'em' })).toThrow(expect.objectContaining({ code: 'BUDGET' }))
    }
  })
  it.each([false, true])('截断后的自动盒、基线与背景跟随可见行，富文本=%s', rich => {
    const style = { ...base(), background: { ...base().background, enabled: true, padding: 0 } }
    const input = rich ? { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ runs: [{ text: 'A\nB\nC\nD', style }], align: 'center' as const, direction: 'ltr' as const, spaceBefore: 0, spaceAfter: 0 }] } : 'A\nB\nC\nD'
    for (const limit of [{ maxLines: 1 }, { maxHeight: 45 }]) {
      const plan = createTextDrawPlan(input, style, { ...limit, anchor: { x: 0, y: 0, horizontal: .5, vertical: .5 } }, measure)
      expect(plan.box).toMatchObject({ y: -20, height: 40 })
      expect(plan.contentTop).toBe(-20)
      expect(plan.lines[0]).toMatchObject({ y: -20, middleBaseline: 0 })
      expect(plan.batches.every(batch => batch.layout.height === 40 && batch.layout.top === -20)).toBe(true)
      expect(plan.contentSize.height).toBe(160)
      const rectangles: unknown[][] = []
      record(context => {
        context.roundRect = (...args) => { rectangles.push(args) }
        paintTextDrawPlan(context, plan, frame, paintVectorAppearance)
      })
      expect(rectangles).toContainEqual([plan.batches[0].layout.left, -20, plan.batches[0].layout.width, 40, 0])
    }
    const fixed = createTextDrawPlan(input, style, { maxLines: 1, box: { height: 200 } }, measure)
    expect(fixed.box.height).toBe(200)
  })
  it('trim 记录遗漏而不冒充截断；未触发的 fit 不改变字号或报告失败', () => {
    const plan = createTextDrawPlan('  一二三四五六  ', base(), { trim: true, maxWidth: 50, fit: { minFontSize: 1, maxFontSize: 64, trigger: 'maxLines' } }, measure)
    expect(plan.fit).toEqual({ applied: false, failed: false, fontSize: 32, scale: 1 })
    expect(plan.truncated).toBe(false)
    expect(plan.omittedRanges.every(range => range.reason === 'trim')).toBe(true)
    expect(plan.overflow.full.width).toBe(true)
  })
  it.each([200, 2000, 8000])('点文本 %s 字不为估计位置量所有前缀', length => {
    let calls = 0, measuredCharacters = 0
    const text = 'abcdefgh'.repeat(length / 8)
    const plan = createTextDrawPlan(text, base(), {}, (value, font, state) => { calls++; measuredCharacters += value.length; return measure(value, font, state) })
    expect(plan.groups).toHaveLength(1)
    expect(plan.graphemes).toHaveLength(length)
    expect(calls).toBeLessThan(length * 4 + 100)
    expect(measuredCharacters).toBeLessThan(length * 32 + 512)
  })
  it('fit 候选不构建字素或基线，选中字号只完成一次完整计划', () => {
    const baselineFonts = new Set<string>()
    const plan = createTextDrawPlan('一二三四五六七八九十'.repeat(5), { ...base(), fontSize: 96 }, { wrapWidth: 300, maxWidth: 300, maxHeight: 120, maxLines: 3, fit: { minFontSize: 8 } }, (value, font, state) => {
      if (value === 'Hg汉') baselineFonts.add(font)
      return measure(value, font, state)
    })
    expect(plan.fit.failed).toBe(false)
    expect(baselineFonts.size).toBe(1)
    expect([...baselineFonts][0]).toContain(`${plan.style.fontSize}px`)
  })
  it('换行宽度、fit 宽度、放置盒和锚点各自独立', () => {
    const text = '一二三四五六'
    const noFit = createTextDrawPlan(text, base(), { maxWidth: 100 }, measure)
    expect(noFit.lines).toHaveLength(1)
    expect(noFit.overflow.full.width).toBe(true)
    const fitted = createTextDrawPlan(text, base(), { maxWidth: 100, fit: { minFontSize: 8 } }, measure)
    expect(fitted.style.fontSize).toBe(16)
    expect(fitted.lines).toHaveLength(1)
    const wrapped = createTextDrawPlan(text, base(), { wrapWidth: 100, box: { width: 200, height: 150 }, anchor: { x: 100, y: 75, horizontal: .5, vertical: .5 } }, measure)
    expect(wrapped.lines).toHaveLength(2)
    expect(wrapped.box).toEqual({ x: 0, y: 0, width: 200, height: 150 })
    expect(createTextDrawPlan('AB', base(), { maxHeight: 200 }, measure).box.height).toBe(40)
    for (const height of [10, 100]) {
      const plan = createTextDrawPlan('A', base(), { box: { height }, maxHeight: 50, fit: { minFontSize: 1 } }, measure)
      expect(plan.fit.failed).toBe(false)
      expect(plan.overflow.full.height).toBe(false)
      expect(plan.truncated).toBe(false)
      expect(plan.lines.map(line => line.text)).toEqual(['A'])
    }
  })
  it('截断与高度超限分别报告，遗漏可按 paragraph/run 读回', () => {
    const style = { ...base(), verticalAlign: 'top' as const }
    const content: RichTextContent = { box: { x: 0, y: 0, width: 100, height: 0 }, paragraphs: [{ runs: [{ text: '一二三四五六', style }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }, { runs: [{ text: '下一段', style }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }
    const plan = createTextDrawPlan(content, style, { maxHeight: 45 }, measure)
    expect(plan.overflow.full.height).toBe(true)
    expect(plan.overflow.visible.height).toBe(false)
    expect(plan.lines).toHaveLength(1)
    expect(plan.truncated).toBe(true)
    expect(plan.omittedRanges.map(source => content.paragraphs[source.paragraph].runs[source.run].text.slice(source.runStart, source.runEnd))).toEqual(['四五六', '下一段'])
    expect(plan.omittedRanges.every(source => source.reason === 'maxHeight')).toBe(true)
    const emptyLine = createTextDrawPlan('A\n\nB', style, { maxHeight: 45 }, measure)
    expect(emptyLine.omittedRanges).toContainEqual({ start: 2, end: 2, paragraph: 0, run: 0, runStart: 2, runEnd: 2, reason: 'maxHeight' })
  })
  it('middle 与 alphabetic 换算保持画面基线，空行也带正确的偏移', () => {
    const style = { ...base(), tracking: 10, baselineShift: 10 }
    const plan = createTextDrawPlan('A\n\nB', style, {}, measure)
    expect(plan.lines.map(line => line.middleBaseline)).toEqual([10, 50, 90])
    for (const group of plan.groups) {
      expect(group.baselineKind).toBe('middle')
      expect(group.alphabeticBaseline - group.middleBaseline).toBeCloseTo(9.6)
      expect(group.baselineConversion).toBe('measured')
    }
    const alpha = createTextDrawPlan('AB', base(), { baseline: 'alphabetic' }, measure)
    expect(alpha.groups[0].baselineKind).toBe('alphabetic')
    expect(alpha.groups[0].baseline).toBeCloseTo(29.6)
    expect(alpha.groups[0].middleBaseline).toBeCloseTo(20)
  })
  it('inherit 按首个强方向字符定位，混排不伪造位置；强制字素布局可供动画', () => {
    const rtl = createTextDrawPlan('...مرحبا', base(), {}, measure)
    const positions = rtl.graphemes.map(glyph => glyph.x!)
    expect(positions[0]).toBeGreaterThan(positions.at(-1)!)
    const mixed = createTextDrawPlan('Aمرحبا', base(), {}, measure)
    expect(mixed.graphemes.every(glyph => glyph.x === null && glyph.positionKind === 'unavailable')).toBe(true)
    const animated = createTextDrawPlan('مرحبا', base(), { forceGraphemes: true }, measure)
    expect(animated.groups).toHaveLength(animated.graphemes.length)
    expect(animated.graphemes.every(glyph => glyph.positionKind === 'individual')).toBe(true)
    expect(animated.groups[0].x).toBeGreaterThan(animated.groups.at(-1)!.x)
    for (const forceGraphemes of [false, true]) for (const text of ['ABC', '123', '١٢٣']) {
      const latin = createTextDrawPlan(text, base(), { direction: 'rtl', forceGraphemes }, measure)
      expect(latin.graphemes[0].x).toBeLessThan(latin.graphemes[1].x!)
      expect(latin.graphemes[1].x).toBeLessThan(latin.graphemes[2].x!)
    }
    expect(() => createTextDrawPlan('Aمرحبا', base(), { forceGraphemes: true }, measure)).toThrow('双向混排')
  })
  it('Unicode R/AL 识别叙利亚文、它拿字母、希伯来扩展，AN 数字串保持内部字序', () => {
    for (const text of ['ܫܠܡܐ', 'ދިވެހި', '\uFB1D\uFB2A\uFB2B']) {
      const plan = createTextDrawPlan(text, base(), {}, measure)
      expect(plan.graphemes[0].x).toBeGreaterThan(plan.graphemes.at(-1)!.x!)
      expect(plan.graphemes.every(glyph => glyph.positionKind === 'native-estimate')).toBe(true)
    }
    for (const forceGraphemes of [false, true]) {
      const plan = createTextDrawPlan('مرحبا ١٢٣', base(), { forceGraphemes }, measure)
      expect(plan.graphemes.every(glyph => glyph.x !== null)).toBe(true)
      const digits = plan.graphemes.slice(-3)
      expect(digits[0].x).toBeLessThan(digits[1].x!)
      expect(digits[1].x).toBeLessThan(digits[2].x!)
      expect(digits[2].x).toBeLessThan(plan.graphemes[0].x!)
    }
    for (const [text, direction] of [['...ABC', 'rtl'], ['١٢٣ ٤٥٦', 'ltr'], ['١٢٣ ٤٥٦', 'rtl'], ['مرحبا ١٢٣،٤٥٦', 'inherit']] as const) {
      const plan = createTextDrawPlan(text, base(), { direction }, measure)
      expect(plan.graphemes.every(glyph => glyph.x === null && glyph.positionKind === 'unavailable')).toBe(true)
      expect(() => createTextDrawPlan(text, base(), { direction, forceGraphemes: true }, measure)).toThrowError(expect.objectContaining({ code: 'BUDGET' }))
    }
  })
  it('alphabetic 仿斜体的墨迹按实际绘制基线剪切', () => {
    const plan = createTextDrawPlan('A', { ...base(), fauxItalic: true }, { baseline: 'alphabetic' }, measure)
    const group = plan.groups[0]
    const metrics = fixtureTextMetrics(group.text, group.font, 'normal', 'inherit', 'alphabetic')
    const top = -metrics.actualBoundingBoxAscent!, bottom = metrics.actualBoundingBoxDescent!
    const left = -metrics.actualBoundingBoxLeft!, right = metrics.actualBoundingBoxRight!
    expect(group.inkBounds!.x).toBeCloseTo(group.x + Math.min(left - .2 * top, left - .2 * bottom))
    expect(group.inkBounds!.width).toBeCloseTo(Math.max(right - .2 * top, right - .2 * bottom) - Math.min(left - .2 * top, left - .2 * bottom))
  })
  it('大于字号的左右悬出和上下墨迹与旧纹理分配一致', () => {
    const style = { ...base(), fauxItalic: true, boxWidth: .1 }
    const recorder = createTextCanvasRecorder()
    vi.stubGlobal('OffscreenCanvas', recorder.Canvas)
    const old = rasterizeText({ text: '悬AV', textStyle: style }, frame, 2)
    const expected = { x: old.x, y: old.y, width: old.width, height: old.height, drawing: recorder.snapshot() }
    frozen('raster-overhang', expected)
    const plan = createTextDrawPlan('悬AV', style, toolOptions(style), measure)
    expect(plan.rasterBounds).toEqual({ x: old.x, y: old.y, width: old.width, height: old.height })
    expect(plan.inkBounds!.height).toBeGreaterThan(style.fontSize * 3)
    const actual = record(context => {
      context.scale(2, 2)
      paintTextDrawPlan(context, plan, { width: old.width, height: old.height, resolution: 2, x: -old.x, y: -old.y }, paintVectorAppearance)
    }, old.width * 2, old.height * 2)
    expectSameDrawing(actual, recorder.snapshot())
  })
  const codeBase: CodeTextMeasureRequest = { text: ' AV office 中文  hello world ', fontFamily: 'sans-serif', fontWeight: 400, fontStyle: 'normal', fontSize: 32, letterSpacing: 0, lineHeight: 1.3, maxWidth: 140, wrap: true, maxLines: 0 }
  it.each([{ fontWeight: 450.5 }, { fontStyle: 'custom-font-style' }, { fontFamily: 'A'.repeat(600) }])('旧作者已接受的字体参数不会被缩放时的 schema 收窄：%j', patch => {
    const request = { ...codeBase, ...patch, maxLines: 1 }
    expectSameDrawing(adaptedCode(request), layoutCodeText(request, (text, font) => fixtureTextMetrics(text, font, 'auto').width, { alphabeticPlacement: 'em' }))
  })
  it('非法度量、负字距和 fit 失败保留旧错误码，适配器无需匹配文案', () => {
    const check = (request: CodeTextMeasureRequest, measurement: TextPlanMeasure, code: 'BUDGET' | 'CONTEXT'): void => {
      expect(() => adaptedCode(request, 'em', measurement)).toThrowError(expect.objectContaining({ code }))
      expect(() => layoutCodeText(request, (text, font) => { const value = measurement(text, font, { fontKerning: 'auto', direction: 'inherit', textBaseline: 'alphabetic', textAlign: 'left' }); return typeof value === 'number' ? value : value.width }, { alphabeticPlacement: 'em' })).toThrowError(expect.objectContaining({ code }))
    }
    check(codeBase, () => NaN, 'CONTEXT')
    check({ ...codeBase, text: 'AB', wrap: false, letterSpacing: -1000 }, measure, 'BUDGET')
    check({ ...codeBase, text: '中文', maxWidth: .1, maxLines: 1 }, measure, 'BUDGET')
  })
  it.each([
    {}, { wrap: false }, { maxLines: 2 }, { maxLines: 1, wrap: false }, { letterSpacing: 2, maxLines: 2 },
    { letterSpacing: -.5, maxLines: 2 }, { text: '  \n  ', maxWidth: 0 }, { text: 'AV\nTo', wrap: false, fontSize: 48, lineHeight: 1.1 },
  ])('共享计划适配旧作者 DTO：%j', patch => {
    const request = { ...codeBase, ...patch }
    const old = layoutCodeText(request, (text, font) => fixtureTextMetrics(text, font, 'auto').width, { alphabeticPlacement: 'em' })
    frozen(`code:legacy-author:${JSON.stringify(patch)}`, old)
    expectSameDrawing(adaptedCode(request), old)
  })
  it('旧作者 1px 失败、仅 maxWidth 不自动 fit，以及字体基线修正', () => {
    const tiny = { ...codeBase, text: '中文', maxWidth: .1, maxLines: 1 }
    expect(() => layoutCodeText(tiny, (text, font) => fixtureTextMetrics(text, font).width, { alphabeticPlacement: 'em' })).toThrow()
    expect(() => adaptedCode(tiny)).toThrow()
    const request = { ...codeBase, wrap: false, maxLines: 0 }
    expect(adaptedCode(request).fontSize).toBe(32)
    const expected = layoutCodeText(request, (text, font) => fixtureTextMetrics(text, font).width, { alphabeticPlacement: 'em' })
    const metrics = fixtureTextMetrics('Hg汉', expected.font, 'auto', 'inherit', 'alphabetic')
    expected.baselineOffset = (expected.fontSize * request.lineHeight - metrics.fontBoundingBoxAscent! - metrics.fontBoundingBoxDescent!) / 2 + metrics.fontBoundingBoxAscent!
    frozen('code-font-baseline', expected)
    expectSameDrawing(adaptedCode(request, 'font'), expected)
    for (const layout of [layoutCodeText, materialTextLayout]) {
      expectSameDrawing(layout(request, measure, { alphabeticPlacement: 'font' }), expected)
      expectSameDrawing(layout(request, measure, { alphabeticPlacement: 'em' }), adaptedCode(request))
    }
  })
  it('作者固定像素字距不受文字工具 tracking 表单范围限制', () => {
    const request = { ...codeBase, text: 'AB', letterSpacing: 1000, wrap: false }
    expectSameDrawing(adaptedCode(request), layoutCodeText(request, (text, font) => fixtureTextMetrics(text, font, 'auto').width, { alphabeticPlacement: 'em' }))
  })
})

function toolOptions(style: TextStyle): TextDrawConstraints {
  return { frame, anchor: textAlignmentAnchor(style) }
}
function record(draw: (context: OffscreenCanvasRenderingContext2D) => void, width = frame.width, height = frame.height): unknown {
  const recorder = createTextCanvasRecorder()
  vi.stubGlobal('OffscreenCanvas', recorder.Canvas)
  const context = new recorder.Canvas(width, height).getContext()
  draw(context)
  return recorder.snapshot()
}
function expectSameDrawing(actual: unknown, expected: unknown): void {
  let maxError = 0
  const compare = (a: unknown, b: unknown): void => {
    if (typeof a === 'number' && typeof b === 'number') { maxError = Math.max(maxError, Math.abs(a - b)); return }
    if (Array.isArray(a) && Array.isArray(b)) { expect(a.length).toBe(b.length); a.forEach((item, i) => compare(item, b[i])); return }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      expect(Object.keys(a)).toEqual(Object.keys(b))
      for (const key of Object.keys(a)) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      return
    }
    expect(a).toEqual(b)
  }
  compare(actual, expected)
  // 锚点平移改变浮点加法结合顺序；仅容许双精度舍入误差，非数值指令和 Canvas 状态仍逐项严格相同。
  expect(maxError).toBeLessThanOrEqual(1e-10)
}
function comparePaint(name: string, text: string, patch: Partial<TextStyle>): void {
  const style = { ...base(), ...patch }
  const expected = record(context => paintText(context, { text, textStyle: style }, frame.width, frame.height))
  frozen(`paint:${name}:${JSON.stringify(patch)}`, expected)
  const actual = record(context => {
    const plan = createTextDrawPlan(text, style, toolOptions(style), canvasTextPlanMeasure(context))
    paintTextDrawPlan(context, plan, { ...frame, x: frame.width / 2, y: frame.height / 2 }, paintVectorAppearance)
  })
  expectSameDrawing(actual, expected)
}

describe('文字计划与现有覆盖、外观指令一致', () => {
  it.each(['left', 'center', 'right', 'justify', 'justify-center', 'justify-right', 'justify-all'] as const)('%s 对齐保留中英混排、字素换行、段尾和空白', align => {
    comparePaint('alignment', ' AV中 To 文 \r\n尾行 \n', { align, boxWidth: .23, boxHeight: .7 })
  })
  it('无空格中文两端对齐分配字间距，末行策略与显式换行一致', () => {
    const style = { ...base(), align: 'justify' as const, boxWidth: .18 }
    comparePaint('cjk-justify', '中文排版测试\n无空格汉字', { align: 'justify', boxWidth: .18 })
    const plan = createTextDrawPlan('中文排版测试', style, toolOptions(style), measure)
    expectSameDrawing(plan.graphemes.slice(0, 3).map(item => item.x), [0, 41.6, 83.2])
    expect(plan.groups.slice(0, 3).every(group => !group.indivisible)).toBe(true)
  })
  it.each([
    { tracking: -160, kerning: 'auto' as const, tsume: 0 },
    { tracking: 130, kerning: 80, tsume: 30 },
    { tracking: 0, kerning: 0, tsume: 0 },
    { smallCaps: true, superscript: true, baselineShift: 17, underline: true },
    { allCaps: true, subscript: true, leading: 60 },
    { fauxBold: true, fauxItalic: true, baselineShift: -24 },
  ])('字符处理与原绘制一致：%j', patch => {
    comparePaint('characters', 'AV To ffi中文aB\n👨‍👩‍👧‍👦e\u0301ß', { ...patch, boxWidth: .3 })
  })
  it('多层内外居中描边、阴影、仿粗斜体和背景复用同一遮罩合成器', () => {
    const style = base()
    Object.assign(style, { fauxBold: true, fauxItalic: true, underline: true })
    style.strokes = [
      { enabled: true, color: BLACK_HEX, width: 4, position: 'inside' },
      { enabled: true, color: WHITE_HEX, width: 7, position: 'outside' },
      { enabled: true, color: BLACK_HEX, width: 3, position: 'center' },
    ]
    style.shadows = [
      { enabled: true, color: BLACK_HEX, opacity: .3, angle: 30, distance: 12, size: 3, blur: 4 },
      { enabled: true, color: WHITE_HEX, opacity: .8, angle: 180, distance: 8, size: 0, blur: 2 },
      { enabled: false, color: BLACK_HEX, opacity: 1, angle: 0, distance: 40, size: 30, blur: 50 },
    ]
    style.background = { enabled: true, color: BLACK_HEX, opacity: .4, padding: 10, radius: 8 }
    const patch = { fauxBold: true, fauxItalic: true, underline: true, strokes: style.strokes, shadows: style.shadows, background: style.background }
    comparePaint('appearance', '描边 AV\n第二行', patch)
    comparePaint('appearance-outline', '空心影', { ...patch, fill: { ...style.fill, enabled: false } })
  })
  it.each([1, 2])('rasterizeText 的纹理位置、尺寸、局部绘制和 %s 倍分辨率相同', resolution => {
    const style = { ...base(), align: 'justify-all' as const, boxWidth: .14, boxHeight: .2, baselineShift: 80, tracking: -120, fauxItalic: true, fauxBold: true }
    style.strokes = [{ enabled: true, color: BLACK_HEX, width: 8, position: 'outside' }]
    style.shadows = [{ enabled: true, color: BLACK_HEX, opacity: .7, angle: 180, distance: 15, size: 6, blur: 3 }]
    const text = 'AV中文\n长段落To'
    const oldRecorder = createTextCanvasRecorder()
    vi.stubGlobal('OffscreenCanvas', oldRecorder.Canvas)
    const old = rasterizeText({ text, textStyle: style }, frame, resolution)
    frozen(`raster:${resolution}`, { x: old.x, y: old.y, width: old.width, height: old.height, drawing: oldRecorder.snapshot() })
    const plan = createTextDrawPlan(text, style, toolOptions(style), measure)
    expect(plan.rasterBounds).toEqual({ x: old.x, y: old.y, width: old.width, height: old.height })
    const nextRecorder = createTextCanvasRecorder()
    vi.stubGlobal('OffscreenCanvas', nextRecorder.Canvas)
    const canvas = new nextRecorder.Canvas(old.width * resolution, old.height * resolution)
    const context = canvas.getContext()
    if (resolution !== 1) context.scale(resolution, resolution)
    paintTextDrawPlan(context, plan, { width: old.width, height: old.height, resolution, x: -old.x, y: -old.y }, paintVectorAppearance)
    expectSameDrawing(nextRecorder.snapshot(), oldRecorder.snapshot())
  })
  it('右对齐与小数推进在画幅中心平移后取整，保留纹理透明留白尺寸', () => {
    const recorder = createTextCanvasRecorder()
    vi.stubGlobal('OffscreenCanvas', recorder.Canvas)
    const raster = rasterizeText({ text: 'AV To', textStyle: { ...base(), align: 'right', boxWidth: .05, tracking: 50 } }, frame)
    // 画幅中心平移后的 101px 包含透明边距；提前化简平移会让 ceil 得到 100px。
    expect({ x: raster.x, y: raster.y, width: raster.width, height: raster.height }).toEqual({ x: -66, y: -114, width: 101, height: 228 })
  })
})

describe('完整内容、fit、截断与动画映射', () => {
  it('截断不改变可见行的段落身份，两端对齐与完整计划相同', () => {
    const style = { ...base(), align: 'justify-center' as const }
    const text = '一二三四五六七八九'
    const constraints = { wrapWidth: 100, box: { width: 100 }, maxWidth: 100, maxLines: 2 }
    const plan = createTextDrawPlan(text, style, constraints, measure)
    const full = createTextDrawPlan(text, style, { ...constraints, truncate: false }, measure)
    expect(plan.truncated).toBe(true)
    expect(plan.overflow.full.lines).toBe(true)
    expect(plan.overflow.visible.lines).toBe(false)
    expect(plan.totalLines).toBe(3)
    expect(plan.graphemes.filter(glyph => glyph.line === 1)).toEqual(full.graphemes.filter(glyph => glyph.line === 1))
    expect(plan.graphemes.filter(glyph => glyph.line === 1).at(-1)?.x).toBe(68)
    expect(plan.omittedRanges.map(range => text.slice(range.start, range.end)).join('')).toBe('七八九')
  })
  it('fit 对完整内容搜索最大网格字号，同时缩放行距、基线和外观；不修改输入', () => {
    const style = { ...base(), fontSize: 48, leading: 60, baselineShift: 8 }
    style.strokes = [{ enabled: true, color: BLACK_HEX, width: 6, position: 'outside' }]
    style.shadows = [{ enabled: true, color: BLACK_HEX, opacity: .5, angle: 45, distance: 8, size: 4, blur: 2 }]
    const original = structuredClone(style), text = '一二三四五六七八'
    const options = { wrapWidth: 160, box: { width: 160, height: 90 }, anchor: { x: 0, y: 0, horizontal: .5, vertical: .5 }, maxWidth: 160, maxHeight: 90, maxLines: 2, fit: { minFontSize: 12, maxFontSize: 48, step: 2 } }
    const plan = createTextDrawPlan(text, style, options, measure)
    expect(plan.style.fontSize).toBe(36)
    expect(plan.style).toEqual(scaleTextStyle(style, .75))
    expect(plan.fit.failed).toBe(false)
    expect(plan.truncated).toBe(false)
    expect(plan.graphemes.map(item => item.text).join('')).toBe(text)
    expect(style).toEqual(original)
    const tooLarge = createTextDrawPlan(text, scaleTextStyle(style, 38 / 48), { wrapWidth: 160, maxWidth: 160, maxHeight: 90, maxLines: 2 }, measure)
    expect(tooLarge.overflow.full.height).toBe(true)
    const legacyStyle = { ...plan.style, boxWidth: options.maxWidth / frame.width, boxHeight: options.maxHeight / frame.height }
    const expected = record(context => paintText(context, { text, textStyle: legacyStyle }, frame.width, frame.height))
    frozen('fit-scaled', expected)
    const actual = record(context => paintTextDrawPlan(context, plan, { ...frame, x: frame.width / 2, y: frame.height / 2 }, paintVectorAppearance))
    expectSameDrawing(actual, expected)
  })
  it('最小字号仍失败时保留原文、完整行数、溢出与显式截断状态', () => {
    const plan = createTextDrawPlan('中文完整内容', base(), { wrapWidth: 8, maxWidth: 8, maxHeight: 8, maxLines: 1, fit: { minFontSize: 20 } }, measure)
    expect(plan.fit).toMatchObject({ applied: true, failed: true, fontSize: 20 })
    expect(plan.overflow.full).toEqual({ width: true, height: true, lines: true })
    expect(plan.sourceText).toBe('中文完整内容')
    expect(plan.omittedRanges.map(range => plan.sourceText.slice(range.start, range.end)).join('')).toBe('中文完整内容')
    const uncut = createTextDrawPlan('中文完整内容', base(), { wrapWidth: 8, maxWidth: 8, maxHeight: 8, truncate: false, fit: { minFontSize: 20 } }, measure)
    expect(uncut.graphemes).toHaveLength(6)
    expect(uncut.truncated).toBe(false)
  })
  it('组合字素、UTF-16 原文范围、首尾空白和整段连字绘制组不会丢失', () => {
    const text = ' e\u0301👨‍👩‍👧‍👦 ffi لا ß '
    const plan = createTextDrawPlan(text, { ...base(), allCaps: true }, {}, measure)
    expect(plan.graphemes.map(item => text.slice(item.source.start, item.source.end))).toEqual(plan.graphemes.map(item => item.text))
    expect(plan.graphemes.map(item => item.text).join('')).toBe(text)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({ text: text.toLocaleUpperCase(), indivisible: true })
    expect(plan.graphemes.every(item => item.positionKind === 'unavailable' && item.x === null)).toBe(true)
    const custom = createTextDrawPlan(text, { ...base(), tracking: 50 }, {}, measure)
    expect(custom.groups).toHaveLength(custom.graphemes.length)
    expect(custom.groups.every(item => !item.indivisible)).toBe(true)
  })
  it('有度量时报告墨迹，只有推进宽度时明确标记估计；阴影不伪装成正文溢出', () => {
    const style = base()
    style.shadows = [{ enabled: true, color: BLACK_HEX, opacity: 1, angle: 0, distance: 100, size: 20, blur: 10 }]
    const plan = createTextDrawPlan('A', style, { maxWidth: 50 }, measure)
    expect(plan.boundsKind).toBe('measured')
    expect(plan.appearanceBounds!.width).toBeGreaterThan(plan.inkBounds!.width + 100)
    expect(plan.overflow.full.width).toBe(false)
    expect(createTextDrawPlan('A', style, {}, () => 20).boundsKind).toBe('estimated')
    expect(createTextDrawPlan('   ', base(), {}, measure).inkBounds).toBeNull()
  })
  it('点文本只限制行数时不把自动收窄的可见盒当作宽度约束', () => {
    const plan = createTextDrawPlan('A\nABCDE', base(), { maxLines: 1 }, measure)
    expect(plan.overflow.full).toEqual({ width: false, height: false, lines: true })
    expect(plan.contentSize.width).toBeGreaterThan(plan.visibleContentSize.width)
  })
  it('Canvas 消费计划不再量字，复用计划不受量字上下文状态影响', () => {
    const plan = createTextDrawPlan('AV中文', { ...base(), fauxItalic: true, underline: true }, {}, measure)
    const copy = structuredClone(plan)
    record(context => {
      context.measureText = () => { throw new Error('绘制时不应量字。') }
      paintTextDrawPlan(context, plan, frame, paintVectorAppearance)
      paintTextDrawPlan(context, plan, frame, paintVectorAppearance)
    })
    expect(plan).toEqual(copy)
  })
  it('长段落的字素范围与整体绘制组完整，缓存淘汰不改变推进结果', () => {
    const text = 'abcdefgh'.repeat(1000)
    const plan = createTextDrawPlan(text, { ...base(), align: 'left' }, {}, value => value.length * 2)
    expect(plan.graphemes).toHaveLength(text.length)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].text).toBe(text)
    expect(plan.graphemes.at(-1)).toMatchObject({ source: { start: text.length - 1, end: text.length }, x: (text.length - 1) * 2, advance: 2 })
  })
  it.each([NaN, Infinity, -1])('非法量字推进 %s 不会进入换行和 fit 搜索', width => {
    expect(() => createTextDrawPlan('文字', base(), { fit: { minFontSize: 10 } }, () => width)).toThrow('度量')
  })
  it.each([{ maxLines: 0 }, { maxWidth: NaN }, { maxHeight: -1 }, { fit: { minFontSize: 10, maxFontSize: 9 } }, { fit: { minFontSize: 1, step: 0 } }] satisfies TextDrawConstraints[])('无效约束拒绝进入搜索：%j', constraints => {
    expect(() => createTextDrawPlan('文字', base(), constraints, measure)).toThrow()
  })
})

describe('富文本沿用现有段落定位与逐样式段外观顺序', () => {
  it('富文本 ROI 宿主的缩放、原点、背景和外观合成与冻结入口一致', () => {
    vi.stubGlobal('ImageData', class {
      data: Uint8ClampedArray
      constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4) }
    })
    const first = { ...base(), background: { ...base().background, enabled: true } }
    const second = { ...base(), fontSize: 24, tracking: 60, fauxItalic: true, underline: true, strokes: [{ enabled: true, color: BLACK_HEX, width: 3, position: 'outside' as const }] }
    const content: RichTextContent = { box: { x: 12, y: 18, width: 130, height: 140 }, paragraphs: [{ runs: [{ text: 'AV中文 ', style: first }, { text: 'aB中文', style: second }], align: 'justify-all', direction: 'ltr', spaceBefore: 4, spaceAfter: 6 }] }
    const actual = record(() => {
      const result = rasterizeVectorContent({ type: 'text', content }, { x: 40, y: 30, width: 320, height: 180, scale: 2 }, { sourceVersion: 'fixture', time: { kind: 'static' }, referenceGrid: frame, quality: 'final' })
      expect([result.width, result.height]).toEqual([320, 180])
    })
    frozen('rich-roi-host', actual)
  })
  it('富文本显式换行、放置盒与锚点互不覆盖，并保留 trim 的 run 来源', () => {
    const style = { ...base(), verticalAlign: 'top' as const }
    const content: RichTextContent = { box: { x: 12, y: 18, width: 64, height: 0 }, paragraphs: [{ runs: [{ text: '一二三四', style }], align: 'center', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }
    const normal = createTextDrawPlan(content, style, {}, measure)
    expect(normal.lines.map(line => line.text)).toEqual(['一二', '三四'])
    const widened = createTextDrawPlan(content, style, { box: { width: 128 }, anchor: { x: 100, y: 200, horizontal: .5, vertical: 0 } }, measure)
    expect(widened.lines.map(line => line.text)).toEqual(['一二', '三四'])
    expect(widened.box).toMatchObject({ x: 36, y: 200, width: 128 })
    expect(widened.groups[0].x).toBe(68)
    expect(createTextDrawPlan(content, style, { wrap: 'none' }, measure).lines.map(line => line.text)).toEqual(['一二三四'])
    expect(createTextDrawPlan(content, style, { wrapWidth: 32 }, measure).lines.map(line => line.text)).toEqual(['一', '二', '三', '四'])
    const words: RichTextContent = { ...content, box: { ...content.box, width: 160 }, paragraphs: [{ ...content.paragraphs[0], runs: [{ text: '  one ', style }, { text: 'two three  ', style }] }] }
    const trimmed = createTextDrawPlan(words, style, { wrap: 'word', trim: true }, measure)
    expect(trimmed.lines.map(line => line.text)).toEqual(['one two', 'three'])
    expect(trimmed.omittedRanges.every(range => range.reason === 'trim')).toBe(true)
    expect(trimmed.graphemes.map(glyph => glyph.sources.map(range => words.paragraphs[range.paragraph].runs[range.run].text.slice(range.runStart, range.runEnd)).join('')).join('')).toBe('one twothree')
  })
  it('外层 fit 基准样式的 kerning 不得改变富文本 run 的换行', () => {
    const style = base()
    const content: RichTextContent = { box: { x: 0, y: 0, width: 36, height: 0 }, paragraphs: [{ runs: [{ text: 'AV', style }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }
    const automatic = createTextDrawPlan(content, style, {}, measure)
    const manualBase = createTextDrawPlan(content, { ...style, kerning: 0 }, {}, measure)
    expect(manualBase.lines.map(line => line.text)).toEqual(['AV'])
    expect(manualBase.lines).toEqual(automatic.lines)
    expect(manualBase.groups).toEqual(automatic.groups)
  })
  it('富文本自动框不受外层比例框影响；fit 只消费富文本框与显式限制', () => {
    const style = base()
    const content: RichTextContent = { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ runs: [{ text: 'ABCDE', style }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }
    const constraints = { frame, fit: { minFontSize: 10 } }
    const plainBase = createTextDrawPlan(content, style, constraints, measure)
    const boxedBase = createTextDrawPlan(content, { ...style, boxWidth: .1, boxHeight: .01 }, constraints, measure)
    expect(boxedBase.fit).toEqual(plainBase.fit)
    expect(boxedBase.fit.fontSize).toBe(32)
    expect(boxedBase.overflow.full).toEqual({ width: false, height: false, lines: false })
    expect(boxedBase.groups).toEqual(plainBase.groups)
    const fitted = createTextDrawPlan(content, style, { ...constraints, maxWidth: 65, maxLines: 1 }, measure)
    expect(fitted.fit.fontSize).toBe(21)
    expect(fitted.fit.failed).toBe(false)
  })
  it('同样式跨 run 的组合字素返回多段可读回来源，保留一个绘制组', () => {
    const style = base()
    const content: RichTextContent = { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ runs: [{ text: 'e', style }, { text: '\u0301', style }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }
    const plan = createTextDrawPlan(content, style, {}, measure)
    expect(plan.graphemes).toHaveLength(1)
    const glyph = plan.graphemes[0]
    expect(glyph.text).toBe('e\u0301')
    expect(glyph.sources.map(source => [source.run, source.runStart, source.runEnd])).toEqual([[0, 0, 1], [1, 0, 1]])
    expect(glyph.sources.map(source => content.paragraphs[source.paragraph].runs[source.run].text.slice(source.runStart, source.runEnd)).join('')).toBe(glyph.text)
    expect(plan.groups[0].indivisible).toBe(true)
  })
  it('不同字号、段落间距、RTL、空段落、两端对齐与原富文本绘制入口一致', () => {
    const first = base(), second = { ...base(), fontSize: 24, tracking: 60, fauxItalic: true, underline: true }
    second.strokes = [{ enabled: true, color: BLACK_HEX, width: 3, position: 'outside' }]
    const content: RichTextContent = {
      box: { x: 12, y: 18, width: 130, height: 240 },
      paragraphs: [
        { runs: [{ text: 'AV中文 ', style: first }, { text: 'aB中文', style: second }], align: 'justify-all', direction: 'ltr', spaceBefore: 4, spaceAfter: 6 },
        { runs: [{ text: '', style: first }], align: 'left', direction: 'auto', spaceBefore: 2, spaceAfter: 3 },
        { runs: [{ text: 'مرحبا', style: first }, { text: '世界', style: second }], align: 'right', direction: 'rtl', spaceBefore: 1, spaceAfter: 5 },
      ],
    }
    const original = structuredClone(content)
    const rich = layoutRichText(content, (text, font) => fixtureTextMetrics(text, font).width, { sourceVersion: 'fixture', time: { kind: 'static' }, referenceGrid: frame, quality: 'final' })
    const expected = record(context => {
      for (const run of rich.runs) {
        context.direction = run.direction === 'auto' ? 'inherit' : run.direction
        const style = { ...run.style, leading: run.lineHeight, align: 'left' as const, verticalAlign: 'top' as const, boxWidth: 0, boxHeight: 0 }
        const plan = createTextDrawPlan(run.text, style, { wrap: 'none', minimumWidth: 'zero', box: { width: run.width || undefined, height: run.lineHeight }, anchor: { x: run.x, y: run.y, horizontal: 0, vertical: 0 }, direction: context.direction }, canvasTextPlanMeasure(context))
        paintTextDrawPlan(context, plan, frame, paintVectorAppearance)
      }
    })
    const plan = createTextDrawPlan(content, first, {}, measure)
    const actual = record(context => paintTextDrawPlan(context, plan, frame, paintVectorAppearance))
    frozen('rich', expected)
    expectSameDrawing(actual, expected)
    expect(content).toEqual(original)
    for (const glyph of plan.graphemes) {
      expect(glyph.sources.map(source => content.paragraphs[source.paragraph].runs[source.run].text.slice(source.runStart, source.runEnd)).join('')).toBe(glyph.text)
      expect(plan.sourceText.slice(glyph.source.start, glyph.source.end)).toBe(glyph.text)
    }
  })
  it('纯文本换行直接复用文字工具内核，无按词换行和 trim 分支', () => {
    const style = { ...base(), boxWidth: .2 }
    const plan = createTextDrawPlan('  hello 世界\n尾行 ', style, toolOptions(style), measure)
    const old = layoutText({ text: plan.sourceText, textStyle: style }, frame, (text, font) => fixtureTextMetrics(text, font).width)
    expect(plan.lines.map(line => line.text)).toEqual(old.lines)
  })
})
