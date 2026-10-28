import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createTextCanvasRecorder } from '../../../core/imaging/vectorContent/textDrawPlanCanvas.testSupport'
import { layoutBoxes, ready, type FlexNode, type FlexStyle } from './flex'
import { layoutText, type TextOptions, type TextStyleInput } from './text'

let advance = 7.1
beforeAll(async () => {
  const { Canvas } = createTextCanvasRecorder()
  vi.stubGlobal('OffscreenCanvas', class extends Canvas {
    constructor(width: number, height: number) {
      super(width, height)
      this.getContext().measureText = text => {
        const width = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length * advance
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 3 } as TextMetrics
      }
    }
  })
  await ready
})
afterAll(() => { vi.unstubAllGlobals() })
afterEach(() => { advance = 7.1 })

it.each(['abc', '标题文字'])('float32 向下舍入的自然宽度与显式宽度均保留完整文字：%s', content => {
  const text = { content, style: { fontSize: 10, align: 'left' as const } }
  const natural = layoutText(content, text.style)
  expect(Math.fround(natural.contentSize.width)).toBeLessThan(natural.contentSize.width)
  for (const style of [{}, { width: natural.contentSize.width }, { width: natural.contentSize.width, height: natural.contentSize.height }]) {
    const boxes = layoutBoxes({ id: 'root', style: { flexDirection: 'column', alignItems: 'start' }, children: [{ id: 'title', style, text }] }, { width: 300, height: 300 })
    expect(boxes.title.text?.lines.map(line => line.text)).toEqual([content])
    expect(boxes.title.text).toMatchObject({ truncated: false, omittedRanges: [] })
    expect(boxes.title.text?.contentSize).toEqual(natural.contentSize)
  }
})

it.each([12.7, 13.1])('float32 向下舍入的自然高度与显式高度均保留末行：%s', leading => {
  const text = { content: 'ab\ncd\nef', style: { fontSize: 10, leading } }
  const natural = layoutText(text.content, text.style)
  expect(Math.fround(natural.contentSize.height)).toBeLessThan(natural.contentSize.height)
  for (const style of [{}, { width: natural.contentSize.width, height: natural.contentSize.height }]) {
    const boxes = layoutBoxes({ id: 'root', style: { flexDirection: 'column', alignItems: 'start' }, children: [{ id: 'title', style, text }] }, { width: 300, height: 300 })
    expect(boxes.title.text?.lines.map(line => line.text)).toEqual(['ab', 'cd', 'ef'])
    expect(boxes.title.text).toMatchObject({ truncated: false, omittedRanges: [] })
  }
})

it.each([16, 100, 1000])('扣除 padding=%s 的消减误差不会丢字或丢行', padding => {
  for (const content of ['abcd', 'ab\ncd\nef']) {
    const text = { content, style: { fontSize: 10, leading: 13.1 } }
    const natural = layoutText(content, text.style)
    for (const style of [{ padding }, { padding, width: natural.contentSize.width + padding * 2 }, { padding, width: natural.contentSize.width + padding * 2, height: natural.contentSize.height + padding * 2 }]) {
      const boxes = layoutBoxes({ id: 'root', style: { flexDirection: 'column', alignItems: 'start' }, children: [{ id: 'title', style, text }] }, { width: 3000, height: 3000 })
      expect(boxes.title.text?.lines.map(line => line.text)).toEqual(content.split('\n'))
      expect(boxes.title.text).toMatchObject({ truncated: false, omittedRanges: [] })
    }
  }
})

it('容差不吞掉实际宽高限制，宽度缩小时仍换行，高度不足时仍截断', () => {
  const text = { content: 'abc', style: { fontSize: 10, leading: 12.7 } }
  const boxes = layoutBoxes({ id: 'root', children: [{ id: 'title', style: { width: 21.29, height: 12.69 }, text }] }, { width: 300, height: 300 })
  expect(boxes.title.text).toMatchObject({ totalLines: 2, truncated: true, lines: [] })
})

it('固定种子两千次嵌套小数 padding/margin/gap 布局不发生精度换行或截断', () => {
  let seed = 0x6e6a6936
  const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const range = (min: number, max: number): number => min + random() * (max - min)
  const pad = (): number => random() < .3 ? 0 : range(0, 64)
  const failures: unknown[] = []
  let mismatches = 0
  for (let index = 0; index < 2000; index++) {
    advance = range(3, 40)
    const count = 1 + Math.floor(random() * 30)
    const content = 'x'.repeat(count) + (random() < .6 ? '\n' + 'y'.repeat(1 + Math.floor(random() * count)) : '')
    const fontSize = range(12, 120), leading = random() < .5 ? range(12, 160) : 0
    let tree: FlexNode = { id: 'title', style: { padding: { top: pad(), right: pad(), bottom: pad(), left: pad() }, margin: { left: pad(), top: pad() } }, text: { content, style: { fontSize, leading } } }
    const depth = 1 + Math.floor(random() * 4)
    for (let level = 0; level < depth; level++) tree = { id: `container${level}`, style: { alignItems: 'start', flexDirection: random() < .5 ? 'row' : 'column', padding: pad(), gap: pad() }, children: [{ id: `sibling${level}`, style: { width: range(0, 200), height: range(0, 200) } }, tree] }
    const result = layoutBoxes({ id: 'root', style: { alignItems: 'start' }, children: [tree] }, { width: 3840, height: 2160 }).title
    if (result.text?.lines.map(line => line.text).join('\n') !== content || result.text.truncated) {
      mismatches++
      if (failures.length < 3) failures.push({ index, advance, content, tree, result })
    }
  }
  expect(mismatches, JSON.stringify(failures)).toBe(0)
}, 180000)

it.each([
  { width: 20, height: 100, padding: { left: 10, right: 10 } },
  { width: 100, height: 20, padding: { top: 10, bottom: 10 } },
  { width: 20, height: 20, padding: 10 },
])('零内容框使用实际限制，不借用文字入口的不限宽约定：%j', style => {
  const result = layoutBoxes({ id: 'root', children: [{ id: 'title', style, text: { content: 'abc', style: { fontSize: 10 } } }] }, { width: 300, height: 300 }).title
  if (result.contentBox.width === 0) expect(result.text?.overflow.full.width).toBe(true)
  if (result.contentBox.height === 0) expect(result.text).toMatchObject({ truncated: true, lines: [], overflow: { full: { height: true } } })
})

it.each<TextOptions>([{ maxWidth: 0 }, { wrapWidth: 0 }, { box: { width: 0 } }])('作者零宽约定为不限宽：%j', options => {
  expect(layoutText('abc', { fontSize: 10 }, options)).toEqual(layoutText('abc', { fontSize: 10 }))
})

it.each([
  [{ flexDirection: 'horizontal' }, 'row、column'],
  [{ alignSelf: 'baseline' }, '可用值'],
  [{ position: 'absolute' }, '未知字段：position'],
  [{ gap: -5 }, '有限非负数'],
  [{ width: 'abc' }, '非负百分比'],
  [{ width: '-10%' }, '非负百分比'],
  [{ flexGrow: Infinity }, '有限非负数'],
  [{ flexShrink: NaN }, '有限非负数'],
  [{ padding: { left: -1 } }, '有限非负数'],
  [{ margin: { horizontal: 2 } }, 'top、right、bottom、left'],
  [{ unknown: 1 }, '可用字段'],
])('JS 作者非法样式可获得中文修复提示：%j', (style, message) => {
  expect(() => layoutBoxes({ id: 'root', style: style as unknown as FlexStyle }, { width: 100, height: 100 })).toThrow(message as string)
})

it('常见 CSS 对齐写法遵循 flex-end 与 space-between 语义，负 margin 合法', () => {
  const boxes = layoutBoxes({ id: 'root', style: { justifyContent: 'flex-end', alignItems: 'flex-end' }, children: [{ id: 'child', style: { width: 20, height: 10, margin: -2 } }] }, { width: 100, height: 50 })
  expect(boxes.child).toMatchObject({ x: 82, y: 42 })
  const spaced = layoutBoxes({ id: 'root', style: { justifyContent: 'space-between' }, children: [{ id: 'a', style: { width: 20 } }, { id: 'b', style: { width: 20 } }] }, { width: 100, height: 50 })
  expect(spaced.b.x).toBe(80)
})

it('固定宽高的文字节点也在 Yoga 计算前校验文字样式，布局方向不静默回落', () => {
  expect(() => layoutBoxes({ id: 'root', children: [{ id: 'text', style: { width: 100, height: 100 }, text: { content: 'abc', style: { fontSize: 'large' } as unknown as TextStyleInput } }] }, { width: 100, height: 100 })).toThrow('文字样式.fontSize')
  expect(() => layoutBoxes({ id: 'root' }, { width: 100, height: 100, direction: 'down' as 'ltr' })).toThrow('可用值：ltr、rtl')
})

it.each([
  [{ id: 'root', child: [] }, '未知字段：child'],
  [{ id: 'root', styles: {} }, '可用字段：id、style、children、text'],
  [{ id: 123 }, '布局节点.id：类型不正确，需要字符串'],
  [{ id: 'root', text: { content: 'x', options: { maxWidht: 10 } } }, '可用字段：maxWidth'],
  [{ id: 'root', text: { content: 'x', options: { wrap: 'words' } } }, '可用值：grapheme、word、none'],
  [{ id: 'root', text: { content: 'x', option: {} } }, '可用字段：content、style、options'],
])('JS 节点与文字选项不静默接受拼写或类型错误：%j', (tree, message) => {
  expect(() => layoutBoxes(tree as unknown as FlexNode, { width: 100, height: 100 })).toThrow(message as string)
})

it('文字独立入口也校验选项，避免节点入口与独立入口语义分歧', () => {
  expect(() => layoutText('abc', {}, { maxWidht: 10 } as TextOptions)).toThrow('未知字段：maxWidht')
  expect(() => layoutText('abc', {}, { wrap: 'words' } as unknown as TextOptions)).toThrow('可用值：grapheme、word、none')
})
