import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as hb from '../../../../../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import { TextShaper, type FontSource } from './harfbuzz'
import { ShapedParagraph, graphemeEnds, layoutUnits } from './paragraph'
import { PunctuationPlanner } from './punctuation'
import { layoutShapedTable } from './table'
import { TextFontSession } from './fontPolicy'
import { lineGraphemeGeometry, selectedClusterPoses } from './graphemeGeometry'
import { prepareShapingRuns } from './runs'
import { textStyleSchema } from '../text'
import { createShapedTextPlan } from './textPlan'

const file = [process.env.HENJI_TEXT_TEST_FONT, 'C:/Windows/Fonts/calibri.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].find((path): path is string => !!path && existsSync(path))
const loadFont = (path: string): FontSource => {
  const data = readFileSync(path)
  return { bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, hash: createHash('sha256').update(data).digest('hex') }
}
// 字体字节属于本机许可，不将 Windows 字体复制到仓库。
describe.skipIf(!file)('纯 CPU HarfBuzz + Pretext（实验 2/8）', () => {
  const source = file ? loadFont(file) : undefined!
  const options = { size: 40, autospace: false, language: 'en', script: 'Latn' }
  const shapers: TextShaper[] = []
  const create = (): TextShaper => { const shaper = new TextShaper(hb); shapers.push(shaper); return shaper }
  afterEach(() => { shapers.splice(0).forEach(shaper => shaper.dispose()); vi.restoreAllMocks() })

  it('有基底轮廓的彩色 emoji 整簇交给系统绘制，仍保留 HarfBuzz 的度量与断行', async () => {
    const fonts = new TextFontSession('win32', async () => ({ bytes: source.bytes }))
    await fonts.prepare()
    const shaper = create(), outline = vi.spyOn(shaper, 'outlineShape').mockReturnValue({ identity: 'color-base', svg: 'M0 0L100 0L100 100Z' })
    const color = vi.spyOn(shaper, 'isColorGlyph').mockReturnValue(false)
    try {
      const plain = createShapedTextPlan(shaper, fonts, '❤️', textStyleSchema.parse({}), {})
      expect(plain.clusters[0].emoji).toBeUndefined()
      expect(outline).toHaveBeenCalled()
      color.mockReturnValue(true)
      const colored = createShapedTextPlan(shaper, fonts, '❤️', textStyleSchema.parse({}), {})
      expect(colored.clusters[0].emoji).toBe('❤️')
      expect(colored.lines).toEqual(plain.lines)
      expect(colored.graphemes).toEqual(plain.graphemes)
    } finally { fonts.close() }
  })

  it('跨会话按内容与轴共享不可变字体，最后一个使用者关闭才释放并允许重建', () => {
    const scales = vi.spyOn(hb.Font.prototype, 'setScale'), axes = vi.spyOn(hb.Font.prototype, 'setVariations')
    const first = create(), second = create(), copy = { ...source, bytes: source.bytes.slice(0) }
    const expected = first.shape(source, 'AV中文', options)
    expect(second.shape(copy, 'AV中文', options)).toEqual(expected)
    second.shape(copy, 'AV', { ...options, size: 80, features: { kern: 0 } })
    expect(scales).toHaveBeenCalledTimes(1)
    expect(axes).toHaveBeenCalledTimes(1)
    first.shape({ ...source, variations: { wght: 700, wdth: 100 } }, 'AV', options)
    second.shape(copy, 'AV', { ...options, axes: { wdth: 100, wght: 700 } })
    expect(scales).toHaveBeenCalledTimes(2)
    const nativeFonts = scales.mock.instances as unknown as hb.Font[]
    const face = nativeFonts[0].face
    first.dispose(); first.dispose()
    nativeFonts.forEach(font => expect(font.ptr).toBeGreaterThan(0))
    expect(face.ptr).toBeGreaterThan(0)
    expect(second.shape(copy, 'AV中文', options)).toEqual(expected)
    second.dispose()
    nativeFonts.forEach(font => expect(() => font.ptr).toThrow('disposed'))
    expect(() => face.ptr).toThrow('disposed')
    expect(create().shape(source, 'AV中文', options)).toEqual(expected)
    expect(scales).toHaveBeenCalledTimes(3)
  })

  it('字距只加在整簇之间，tsume 不改轮廓偏移；软连字符仅在实际断行时替换', () => {
    const shaper = create(), text = 'ffi AV', shape = shaper.shape(source, text, { ...options, ligatures: true })
    const spaced = new ShapedParagraph(shaper, source, text, { ...options, ligatures: true, tsume: 20, letterSpacing: 3 })
    const line = spaced.layout().lines[0]
    expect(line.width).toBeCloseTo(shape.width * .8 + (new Set(shape.glyphs.map(g => g.cluster)).size - 1) * 3)
    expect(line.glyphs.map(g => [g.id, g.xOffset, g.yOffset])).toEqual(shape.glyphs.map(g => [g.id, g.xOffset, g.yOffset]))
    const word = 'ab\u00adcd', joined = new ShapedParagraph(shaper, source, word, options).layout()
    expect(joined.lines[0].width).toBeCloseTo(shaper.shape(source, word, options).width)
    const preferred = shaper.shape(source, '\u2010', options)
    const hyphen = preferred.glyphs.every(glyph => glyph.id) ? preferred : shaper.shape(source, '-', options)
    const beforeHyphen = shaper.shape(source, 'ab', options), width = beforeHyphen.width + hyphen.width
    const split = new ShapedParagraph(shaper, source, word, { ...options, maxWidth: Math.ceil(width * 64) / 64 }).layout()
    expect(split.lines[0].contentEnd).toBe(3)
    expect(split.lines[0].width).toBeCloseTo(width)
    expect(split.lines[0].glyphs.map(g => g.id)).toEqual([...beforeHyphen.glyphs, ...hyphen.glyphs].map(g => g.id))
    expect(split.lines[1].start).toBe(3)
    for (const input of ['abcd', 'ab\u00adcd', 'אבג']) {
      const direction = input === 'אבג' ? 'rtl' : 'ltr'
      const natural = new ShapedParagraph(shaper, source, input, { ...options, direction }).layout().width
      const actual = new ShapedParagraph(shaper, source, input, { ...options, direction, letterSpacing: 3 }).layout().width
      expect(actual - natural).toBeCloseTo(input === 'אבג' ? 6 : 9)
    }
  })

  it('字体轮廓复用不依赖字号与帧，字体和轴变化分离身份，关闭后拒绝使用', () => {
      const shaper = create(), glyph = shaper.shape(source, 'A', options).glyphs[0].id
      const path = shaper.outlineShape(source, glyph)
      expect(shaper.outlineShape(source, glyph)).toBe(path)
      expect(shaper.outlineShape(source, glyph, { wght: 700 })).not.toBe(path)
      expect(shaper.outlineShape({ ...source, hash: 'another-font-content' }, glyph)).not.toBe(path)
      shaper.dispose()
      expect(() => shaper.outlineShape(source, glyph)).toThrow('会话已经关闭')
  })

  it('自动折行在尾空白前显示独立连字符，段尾与硬换行保持软连字符隐藏', () => {
    const shaper = create(), hyphen = shaper.shape(source, '\u2010', options)
    const visibleHyphen = hyphen.glyphs.every(glyph => glyph.id) ? hyphen : shaper.shape(source, '-', options)
    const a = shaper.shape(source, 'A', options).width, aa = shaper.shape(source, 'AA', options).width
    for (const width of [aa + visibleHyphen.width + .25, a + visibleHyphen.width + .25]) {
      const layout = new ShapedParagraph(shaper, source, 'AA\u00ad B', { ...options, maxWidth: width }).layout()
      const line = layout.lines.find(line => line.start <= 2 && line.contentEnd > 2)!
      const glyph = line.glyphs.find(glyph => glyph.cluster === 2)!
      expect(glyph.id).toBe(visibleHyphen.glyphs[0].id)
      expect(shaper.outline(source, glyph.id)).not.toBe('')
      expect(line.width).toBeCloseTo(shaper.shape(source, 'AA'.slice(line.start), options).width + visibleHyphen.width)
    }
    for (const text of ['AA\u00ad ', 'AA\u00ad \nB', 'AA\u00ad B']) {
      const line = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: 500 }).layout().lines[0]
      expect(line.glyphs.find(glyph => glyph.cluster === 2)?.advance).toBe(0)
    }
  })

  it('绘制样式不切断字偶距，多字号与书写系统 run 保留段落上下文和原文映射', async () => {
    const shaper = create(), fonts = new TextFontSession('win32', async () => ({ bytes: source.bytes }))
    await fonts.prepare()
    const style = textStyleSchema.parse({ fontSize: 40 })
    const colorOnly = { ...style, fill: { ...style.fill, enabled: false } }
    const same = prepareShapingRuns(shaper, fonts, 'AV', [{ start: 0, end: 1, style }, { start: 1, end: 2, style: colorOnly }], options)
    expect(same.runs).toHaveLength(1)
    const paragraph = new ShapedParagraph(shaper, source, same.text, options, same.runs)
    expect(paragraph.initial.width).toBe(shaper.shape(source, 'AV', options).width)
    const content = 'aß\r\n文B'
    const mapped = prepareShapingRuns(shaper, fonts, content, [{ start: 0, end: 2, style: { ...style, smallCaps: true, superscript: true } }, { start: 2, end: content.length, style }], options)
    expect(mapped.text).toBe('ASS\n文B')
    expect(mapped.graphemes[1]).toMatchObject({ start: 1, end: 3, sourceStart: 1, sourceEnd: 2, baselineShift: -14 })
    expect(mapped.graphemes[2]).toMatchObject({ start: 3, end: 4, sourceStart: 2, sourceEnd: 4 })
    expect(mapped.runs[0].options.size).toBe(40 * .75 * .65)
    expect(mapped.runs.slice(-2).map(run => run.options.script)).toEqual(['Hani', 'Latn'])
    const spy = vi.spyOn(shaper, 'shape')
    const mixed = new ShapedParagraph(shaper, source, mapped.text, options, mapped.runs, mapped.graphemes.map(grapheme => grapheme.end))
    expect(spy.mock.calls.some(call => call[1] === mapped.text && call[3] === 4 && call[4] === 5)).toBe(true)
    expect(mixed.layout().lines).toHaveLength(2)
    expect(mixed.initial.glyphs.some(glyph => glyph.run !== undefined)).toBe(true)
    expect(() => mixed.range(1, 2)).toThrow('完整字素')
    const kana = 'カレー ｶﾚｰ'
    const japanese = prepareShapingRuns(shaper, fonts, kana, [{ start: 0, end: kana.length, style }], { size: 40 })
    expect(japanese.runs).toHaveLength(1)
    expect(japanese.runs[0].options.script).toBe('Kana')
    fonts.close()
  })

  it('多字体安全切片与 unsafe 行边恢复均使用对应字体，不能跨 run 拼错字形', () => {
    const shaper = create(), text = 'AVATAR hello', second = { ...source, hash: `${source.hash}:second-face` }
    const runs = [{ start: 0, end: 7, source, options }, { start: 7, end: text.length, source: second, options: { ...options, size: 60 } }]
    const paragraph = new ShapedParagraph(shaper, source, text, options, runs)
    const at = paragraph.initial.glyphs.find(glyph => glyph.cluster > 0 && glyph.cluster < 7 && (glyph.flags & 1))!.cluster
    const shape = paragraph.range(at, text.length)
    expect(shape.glyphs.filter(glyph => glyph.run === 0).map(glyph => glyph.id)).toEqual(shaper.shape(source, text.slice(at), options, 0, 7 - at).glyphs.map(glyph => glyph.id))
    expect(shape.glyphs.filter(glyph => glyph.run === 1).map(glyph => glyph.id)).toEqual(shaper.shape(second, text.slice(at), runs[1].options, 7 - at).glyphs.map(glyph => glyph.id))
    expect(() => new ShapedParagraph(shaper, source, text, options, [{ ...runs[0], end: 3 }, runs[1]])).toThrow('连续覆盖')
    const originalShape = shaper.shape.bind(shaper)
    vi.spyOn(shaper, 'shape').mockImplementation((font, value, shapeOptions, start, end) => {
      const shaped = originalShape(font, value, shapeOptions, start, end)
      return font === second && value === ' ' ? { ...shaped, glyphs: shaped.glyphs.map(glyph => ({ ...glyph, id: 123 })) } : shaped
    })
    const tab = new ShapedParagraph(shaper, source, 'A\tB', options, [{ ...runs[0], end: 1 }, { ...runs[1], start: 1, end: 3 }]).range(0, 3)
    expect(tab.glyphs.find(glyph => glyph.cluster === 1)).toMatchObject({ run: 1, id: 123 })
  })

  it('整段保留字偶距，断到 unsafe cluster 时两侧均恢复独立行整形', () => {
    const shaper = create(), spy = vi.spyOn(shaper, 'shape')
    const paragraph = new ShapedParagraph(shaper, source, 'AVATAR', options)
    const initial = paragraph.initial
    const unsafe = initial.glyphs.find(glyph => glyph.cluster > 0 && (glyph.flags & 1))
    expect(unsafe).toBeDefined()
    const at = unsafe!.cluster
    spy.mockClear()
    const left = paragraph.range(0, at), right = paragraph.range(at, 6)
    expect(spy.mock.calls.some(call => call[1] === 'AVATAR'.slice(at))).toBe(true)
    expect(left.width).toBe(shaper.shape(source, 'AVATAR'.slice(0, at), options).width)
    expect(right.width).toBe(shaper.shape(source, 'AVATAR'.slice(at), options).width)
    const plain = shaper.shape(source, 'AVATAR', { ...options, features: { kern: 0 } })
    expect(initial.width).toBeLessThan(plain.width)
  })
  it('安全切片不重复整形、字体轮廓在 Node 中可读、释放幂等并禁止释放后访问', () => {
    const shaper = create(), paragraph = new ShapedParagraph(shaper, source, 'hello world', options)
    const spy = vi.spyOn(shaper, 'shape')
    const result = paragraph.range(0, 5)
    expect(result.glyphs.length).toBeGreaterThan(0)
    expect(spy.mock.calls.filter(call => call[1] === 'hello world')).toHaveLength(0)
    expect(shaper.outline(source, result.glyphs[0].id)).toContain('M')
    shaper.dispose(); shaper.dispose()
    expect(() => shaper.shape(source, 'x', options)).toThrow('关闭')
    const blob = new hb.Blob(source.bytes)
    blob.dispose(); blob.dispose()
    expect(() => new hb.Face(blob)).toThrow('disposed')
  })
  it('默认关闭可选连字，打开后只保留一份簇几何，forceGraphemes 无影响', () => {
    const shaper = create()
    const plain = new ShapedParagraph(shaper, source, 'office ffi', options).layout()
    const ligatures = new ShapedParagraph(shaper, source, 'office ffi', { ...options, ligatures: true }).layout()
    expect(ligatures.lines[0].glyphs.length).toBeLessThan(plain.lines[0].glyphs.length)
    expect(new ShapedParagraph(shaper, source, 'office ffi', { ...options, ligatures: true, forceGraphemes: true }).layout()).toEqual(ligatures)
    expect(Object.isFrozen(ligatures.lines[0].glyphs)).toBe(true)
    const geometry = lineGraphemeGeometry(ligatures.text, ligatures.lines[0])
    const shared = geometry.find(grapheme => grapheme.index !== grapheme.owner)!
    expect(shared).toBeDefined()
    expect(selectedClusterPoses(geometry, [shared.index]).size).toBe(0)
    expect(selectedClusterPoses(geometry, [shared.owner]).size).toBe(1)
    const poses = selectedClusterPoses(geometry, grapheme => ({ x: grapheme.index * 10 }))
    expect(poses.get(shared.owner)?.x).toBe(shared.owner * 10)
  })
  it('Arabic 的不安全行边不读取行外连接上下文，字素索引仍指原文', () => {
    const shaper = create(), text = 'سلام', arabic = { ...options, script: 'Arab', direction: 'rtl' as const }
    const paragraph = new ShapedParagraph(shaper, source, text, arabic)
    expect(paragraph.initial.glyphs.some(glyph => glyph.flags & 1)).toBe(true)
    const left = paragraph.range(0, 2), right = paragraph.range(2, 4)
    expect(left.glyphs.map(glyph => glyph.id)).toEqual(shaper.shape(source, text.slice(0, 2), arabic).glyphs.map(glyph => glyph.id))
    expect(right.glyphs.map(glyph => glyph.id)).toEqual(shaper.shape(source, text.slice(2), arabic).glyphs.map(glyph => glyph.id))
    expect(right.glyphs.every(glyph => glyph.cluster >= 2)).toBe(true)
  })
  it('行首重整形后中英间距仍存在，并在实际换行处回收', () => {
    const shaper = create(), text = 'A文B'
    const shaped = new ShapedParagraph(shaper, source, text, { ...options, autospace: true })
    const plain = new ShapedParagraph(shaper, source, text, options)
    expect(shaped.range(0, text.length).width - plain.range(0, text.length).width).toBe(options.size / 4)
    expect(shaped.range(1, text.length).width - plain.range(1, text.length).width).toBe(options.size / 8)
    expect(shaped.range(0, 1).width).toBe(plain.range(0, 1).width)
  })
  it('强制字素换行与正常单词换行不同，硬换行及空行可前进', () => {
    const shaper = create(), width = shaper.shape(source, 'hello wo', options).width
    const normal = new ShapedParagraph(shaper, source, 'hello world', { ...options, maxWidth: width }).layout()
    const anywhere = new ShapedParagraph(shaper, source, 'hello world', { ...options, maxWidth: width, wrap: 'grapheme' }).layout()
    expect(anywhere.lines[0].end).toBeGreaterThan(normal.lines[0].end)
    const hard = new ShapedParagraph(shaper, source, 'one\n\ntwo', options).layout()
    expect(hard.lines).toHaveLength(3)
    expect(hard.lines[1].width).toBe(0)
  })
  it('Pretext walker 按整段宽度换行，临界宽度不使用浮点 epsilon', () => {
    const shaper = create(), text = 'hello world'
    const width = shaper.shape(source, text, options).width
    const quantized = layoutUnits(width) / 64
    const at = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: quantized }).layout()
    const below = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: quantized - 1 / 64 }).layout()
    expect(at.lines).toHaveLength(1)
    expect(below.lines).toHaveLength(2)
    expect(below.lines[0].width).toBe(shaper.shape(source, 'hello', options).width)
    expect(below.lines[1].width).toBe(shaper.shape(source, 'world', options).width)
    expect(at.width).toBe(width)
  })
  it('紧急断行不能拆代理对、组合 mark 或 ZWJ 字素', () => {
    const shaper = create(), text = 'a\u0301👨‍👩‍👧‍👦XYZ'
    const layout = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: 1 }).layout()
    const boundaries = new Set([0, ...graphemeEnds(text)])
    expect(layout.lines.length).toBeGreaterThan(1)
    for (const line of layout.lines) { expect(boundaries.has(line.start)).toBe(true); expect(boundaries.has(line.end)).toBe(true) }
    expect(layout.overflow).toBe(true)
  })
  it('长词以增量字素宽度填满每行，不把累计前缀反复相加', () => {
    const shaper = create(), text = 'a'.repeat(100)
    const five = shaper.shape(source, 'aaaaa', options).width
    const layout = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: Math.ceil(five * 64) / 64 }).layout()
    expect(layout.lines).toHaveLength(20)
    expect(layout.lines.every(line => line.end - line.start === 5)).toBe(true)
    expect(layout.lines.every(line => Math.abs(line.width - five) <= 1 / 64)).toBe(true)
  })
  it('安全长段的候选宽只读前缀和，不为每个前缀构造字形数组', () => {
    const shaper = create(), paragraph = new ShapedParagraph(shaper, source, 'a'.repeat(1000), { ...options, maxWidth: 100 })
    const range = vi.spyOn(paragraph, 'range'), shape = vi.spyOn(shaper, 'shape')
    const layout = paragraph.layout()
    expect(range.mock.calls.length).toBe(layout.lines.length)
    expect(shape).not.toHaveBeenCalled()
    expect(layout.lines.reduce((sum, line) => sum + line.glyphs.length, 0)).toBe(1000)
  })
  it('pre-wrap 保留放得下的行尾空格，只悬挂溢出部分', () => {
    const shaper = create(), text = 'a '
    const wide = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: 100 })
    expect(wide.layout().width).toBe(wide.intrinsicWidths().max)
    expect(wide.layout().lines[0].contentEnd).toBe(2)
    const width = shaper.shape(source, 'a', options).width
    const narrow = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: Math.ceil(width * 64) / 64 }).layout()
    expect(Math.abs(narrow.width - width)).toBeLessThanOrEqual(1 / 64)
    const partialWidth = Math.ceil(width * 64) / 64 + 5
    const partial = new ShapedParagraph(shaper, source, 'a  ', { ...options, maxWidth: partialWidth }).layout()
    expect(partial.width).toBe(partialWidth)
    expect(partial.lines[0].glyphs.reduce((sum, glyph) => sum + glyph.advance, 0)).toBeGreaterThan(partial.width)
  })
  it('tab 的最终几何与 walker 共用八空格制表位，不绘制缺字方框', () => {
    const shaper = create(), space = shaper.shape(source, ' ', options)
    const b = shaper.shape(source, 'B', options)
    const paragraph = new ShapedParagraph(shaper, source, 'A\tB', options)
    const layout = paragraph.layout(), line = layout.lines[0]
    const stop = layoutUnits(space.width * 8) / 64
    expect(line.width).toBeCloseTo(stop + b.width)
    expect(line.glyphs.find(glyph => glyph.cluster === 1)?.id).toBe(space.glyphs[0].id)
    expect(line.glyphs.reduce((sum, glyph) => sum + glyph.advance, 0)).toBe(line.width)
    const large = { ...options, size: 60 }, small = { ...options, size: 16 }
    const mixed = new ShapedParagraph(shaper, source, 'A\tB', { ...options, maxWidth: 160 }, [{ start: 0, end: 1, source, options: large }, { start: 1, end: 3, source, options: small }]).layout()
    const before = shaper.shape(source, 'A', large).width, smallStop = layoutUnits(shaper.shape(source, ' ', small).width * 8) / 64
    expect(mixed.lines[0].width).toBeCloseTo((Math.floor(before / smallStop) + 1) * smallStop + shaper.shape(source, 'B', small).width)
  })
  it('断行机会必须保持修饰符与 ZWJ 完整字素，未分类书写系统交给 HarfBuzz 推断', async () => {
    const shaper = create(), text = '前a🏿👶‍🛑后', boundaries = new Set([0, ...graphemeEnds(text)])
    expect(graphemeEnds('a🏿👶‍🛑')).toEqual([3, 8])
    const paragraph = new ShapedParagraph(shaper, source, text, { ...options, maxWidth: 1 })
    expect(paragraph.analysis.starts.every(at => boundaries.has(at))).toBe(true)
    expect(paragraph.layout().lines.every(line => boundaries.has(line.start) && boundaries.has(line.end))).toBe(true)
    expect(() => paragraph.intrinsicWidths()).not.toThrow()
    const fonts = new TextFontSession('win32', async () => ({ bytes: source.bytes })); await fonts.prepare()
    const style = textStyleSchema.parse({ fontSize: 40 })
    const runs = prepareShapingRuns(shaper, fonts, 'ᬅ', [{ start: 0, end: 1, style }], { size: 40 })
    expect(runs.runs[0].options.script).toBe('Bali')
    expect(runs.graphemes[0].inferredScript).toBe(true)
    expect(() => new ShapedParagraph(shaper, source, runs.text, options, runs.runs).layout()).not.toThrow()
    const different = 'ᬅꦏꦺ', separated = prepareShapingRuns(shaper, fonts, different, [{ start: 0, end: different.length, style }], { size: 40 })
    expect(separated.runs.map(run => run.options.script)).toEqual(['Bali', 'Java'])
    const marks = new ShapedParagraph(shaper, source, 'A \u0308B', { ...options, maxWidth: 25 }).layout()
    expect(marks.lines.length).toBeGreaterThan(1)
    expect(new ShapedParagraph(shaper, source, ' \u0308B', options).intrinsicWidths().min).toBeGreaterThan(0)
    fonts.close()
  })
  it('整簇覆盖失败时保留可覆盖主体的脸并报告缺字', async () => {
    const shaper = create(), fonts = new TextFontSession('win32', async () => ({ bytes: source.bytes }))
    await fonts.prepare()
    const emoji = { ...source, hash: 'emoji-face' }, first = { ...source, hash: 'primary-face' }
    vi.spyOn(shaper, 'shape').mockImplementation((font, text) => ({ width: 20, glyphs: [...text].map((char, index) => ({ id: font === emoji && char !== '\u0308' ? 2 : 0, cluster: index, flags: 0, advance: 10, xOffset: 0, yOffset: 0 })) }))
    const chosen = fonts.choose({ identity: 'test', candidates: [{ family: 'primary', font: first }, { family: 'emoji', font: emoji }] }, '👶\u0308', shaper, options)
    expect(chosen).toEqual({ font: emoji, missing: true })
    const tab = fonts.choose({ identity: 'test', candidates: [{ family: 'primary', font: first }, { family: 'emoji', font: emoji }] }, '\t', shaper, options)
    expect(tab).toEqual({ font: first, missing: false })
    fonts.close()
  })
  it('制表位吸收之前的中英间距，最终几何不能多算一份间距', () => {
    const shaper = create(), text = 'A文\tB'
    const stop = layoutUnits(shaper.shape(source, ' ', options).width * 8)
    const preceding = shaper.shape(source, 'A文', options).width + options.size / 8
    const expected = (Math.floor(layoutUnits(preceding) / stop) + 1) * stop / 64 + shaper.shape(source, 'B', options).width
    const layout = new ShapedParagraph(shaper, source, text, { ...options, autospace: true, maxWidth: expected + 1 }).layout()
    expect(layout.lines).toHaveLength(1)
    expect(layout.width).toBeCloseTo(expected)
    expect(layout.overflow).toBe(false)
  })
  it('标点计划身份包含字节、轴、特性和连字选项，不污染字体无关规则', () => {
    const shaper = create(), planner = new PunctuationPlanner(shaper)
    const first = planner.plan(source, '（文本），', options)
    expect(planner.plan(source, '（文本），', options)).toBe(first)
    expect(planner.plan({ ...source, hash: source.hash + '-replacement' }, '（文本），', options).key).not.toBe(first.key)
    const calls = vi.spyOn(shaper, 'extents')
    const instance = planner.plan({ ...source, variations: { wght: 700 } }, '（文本），', options)
    expect(instance.key).not.toBe(first.key)
    expect(calls).toHaveBeenCalled()
    expect(planner.plan(source, '（文本），', { ...options, axes: { wght: 700 } }).key).not.toBe(first.key)
    expect(planner.plan(source, '（文本），', { ...options, features: { halt: 1 } }).key).not.toBe(first.key)
  })
  it('数字列实际 tnum 度量、列宽不足报告溢出、固定列不被压缩', () => {
    const shaper = create(), style = { ...options, features: { tnum: 1, pnum: 0 } }
    const digits = [...'0123456789'].map(char => shaper.shape(source, char, style).width)
    expect(new Set(digits).size).toBe(1)
    const input = { columns: [{ key: 'name', width: 160 }, { key: 'value', numeric: true }], rows: [{ name: 'Total', value: '1,234.50%' }, { name: 'Cost', value: '-99.00' }] }
    const table = layoutShapedTable(shaper, source, input, options, { width: 500, cellPadding: 8, columnGap: 4 })
    expect(table.diagnostics).toEqual([])
    expect(table.columns[0]).toBe(160)
    expect(table.columns.reduce((a, b) => a + b, 4)).toBe(500)
    expect(table.cells[1].textX + table.cells[1].text.width).toBeCloseTo(table.cells[3].textX + table.cells[3].text.width)
    const narrow = layoutShapedTable(shaper, source, input, options, { width: 100, cellPadding: 8 })
    expect(narrow.overflow).toBe(true)
    expect(narrow.columns[0]).toBe(160)
    expect(narrow.cells).toHaveLength(4)
  })
  it('轮廓软预算回收可重建条目，已交付轮廓仍可读取', () => {
    const shaper = create()
    const outline = vi.spyOn(shaper, 'outline').mockImplementation(() => 'M0 0' + ' '.repeat(1100000))
    const first = shaper.outlineShape(source, 1)
    shaper.outlineShape(source, 2); shaper.outlineShape(source, 3)
    const rebuilt = shaper.outlineShape(source, 1)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.svg).toBe(first.svg)
    expect(outline).toHaveBeenCalledTimes(4)
  })
  it('零声明准备默认集、链身份跨会话稳定且记录缺失候选', async () => {
    const reader = vi.fn(async (request: { family: string }) => request.family === 'Arial' ? { bytes: source.bytes } : undefined)
    const session = new TextFontSession('win32', reader), other = new TextFontSession('win32', reader)
    await Promise.all([session.prepare(), session.prepare(), other.prepare()])
    const chain = session.chain()
    expect(chain.identity).toBe(other.chain().identity)
    expect(chain.candidates.some(candidate => candidate.family === 'Segoe UI Emoji' && !candidate.font)).toBe(true)
    expect(session.choose(chain, 'a', create(), options).missing).toBe(false)
    const identity = chain.identity
    await session.prepare({ faces: [{ family: 'extra' }] })
    expect(session.chain().identity).toBe(identity)
    session.close(); other.close()
    expect(() => session.chain()).toThrow('关闭')
  })
  it.skipIf(!existsSync('C:/Windows/Fonts/seguisym.ttf'))('圈号选脸只由字素决定，同行汉字和其他声明文字不改变字体', async () => {
    const paths: Record<string, string> = { 'sans-serif': 'arial.ttf', Arial: 'arial.ttf', 'Segoe UI Symbol': 'seguisym.ttf', 'Noto Sans SC': 'NotoSansSC-VF.ttf', 'Microsoft YaHei': 'msyh.ttc' }
    const read = vi.fn(async (request: { family: string }) => {
      const file = paths[request.family]
      return file && existsSync(`C:/Windows/Fonts/${file}`) ? { bytes: loadFont(`C:/Windows/Fonts/${file}`).bytes } : undefined
    })
    const fonts = new TextFontSession('win32', read), shaper = create()
    try {
      await fonts.prepare({ text: ['2026'] })
      expect(read.mock.calls.some(([request]) => /YaHei|Noto|Emoji/.test(request.family))).toBe(false)
      const plain = await fonts.prepare({ text: ['2026 ①'] })
      const mixed = await fonts.prepare({ text: ['2026 ①年'] })
      const first = fonts.choose([...plain.values()][0], '①', shaper, options)
      const second = fonts.choose([...mixed.values()][0], '①', shaper, options)
      expect(first.missing).toBe(false)
      expect(second.font.hash).toBe(first.font.hash)
      expect(second.font.face).toBe(first.font.face)
    } finally { fonts.close() }
  })
  it.skipIf(!existsSync('C:/Windows/Fonts/seguiemj.ttf'))('肤色修饰符与变体选择符独立预热 emoji 脸，不依赖同模块其他 emoji', async () => {
    const emoji = loadFont('C:/Windows/Fonts/seguiemj.ttf')
    const fonts = new TextFontSession('win32', async request => ({ bytes: request.family === 'Segoe UI Emoji' ? emoji.bytes : source.bytes })), shaper = create()
    try {
      for (const text of ['a🏿', '1️']) {
        const alone = await fonts.prepare({ text: [text] })
        const mixed = await fonts.prepare({ text: [text + '👶‍🛑'] })
        const first = fonts.choose([...alone.values()][0], text, shaper, options)
        const second = fonts.choose([...mixed.values()][0], text, shaper, options)
        expect(first.font.hash).toBe(emoji.hash)
        expect(second.font.hash).toBe(first.font.hash)
        expect(first.missing).toBe(false)
      }
    } finally { fonts.close() }
  })
  it('按本次文字准备回退脚本，后续参数准备不能改变已交付的候选快照', async () => {
    const read = vi.fn(async () => ({ bytes: source.bytes })), fonts = new TextFontSession('win32', read)
    const latin = await fonts.prepare({ text: ['hello'] })
    expect(latin.values().next().value!.candidates.map(candidate => candidate.family)).not.toContain('Microsoft YaHei')
    const count = read.mock.calls.length
    const japanese = await fonts.prepare({ text: ['中文カナ🙂'] })
    expect(read.mock.calls.length).toBeGreaterThan(count)
    expect(japanese.values().next().value!.candidates.map(candidate => candidate.family)).toContain('Yu Gothic')
    expect(japanese.values().next().value!.identity).not.toBe(latin.values().next().value!.identity)
    expect(latin.values().next().value!.candidates.map(candidate => candidate.family)).not.toContain('Segoe UI Emoji')
    const marks = await fonts.prepare({ text: ['（）ー'] })
    expect(marks.values().next().value!.candidates.map(candidate => candidate.family)).toEqual(expect.arrayContaining(['Microsoft YaHei', 'Yu Gothic']))
    fonts.close()
  })
  it('取消一个等待不影响共享加载，会话关闭后迟到数据不能重新激活', async () => {
    let resolve!: (value: { bytes: ArrayBuffer }) => void
    const pending = new Promise<{ bytes: ArrayBuffer }>(done => { resolve = done })
    const session = new TextFontSession('win32', () => pending), abort = new AbortController()
    const cancelled = session.prepare({}, abort.signal), kept = session.prepare()
    abort.abort(new Error('cancelled'))
    await expect(cancelled).rejects.toThrow('cancelled')
    resolve({ bytes: source.bytes }); await kept
    expect(session.chain().candidates[0].font).toBeDefined()
    const late = new TextFontSession('win32', () => pending)
    const work = late.prepare(); late.close()
    await expect(work).rejects.toThrow('关闭')
    session.close()
  })
})
