import { describe, expect, it } from 'vitest'
import { defaultTextStyle, layoutRichText, rectanglePath, ellipsePath, arrowPath, flattenVectorPath, rasterizeVectorCoverage, transformVectorPath, richTextContentSchema, vectorPathContentSchema, type RichTextContent, type VectorEvaluationContext } from './index'

const evaluation: VectorEvaluationContext = { sourceVersion: 'sample-1', time: { kind: 'frame', ticks: 120, timeBase: [1, 30], frameId: 'frame-120' }, referenceGrid: { width: 100, height: 100 }, quality: 'final' }
const measure = (text: string): number => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length * 10
const text = (): RichTextContent => ({ box: { x: 5, y: 6, width: 30, height: 0 }, paragraphs: [{ runs: [{ text: '中👨‍👩‍👧‍👦文', style: defaultTextStyle(150) }, { text: '标题', style: { ...defaultTextStyle(150), fontWeight: 700 } }], align: 'center', direction: 'auto', spaceBefore: 2, spaceAfter: 4 }] })

describe('共享文字与矢量内容内核', () => {
  it('不同字形片段换行保持字体、组合字素与段落间距，不改写作品', () => {
    const content = text(), original = structuredClone(content)
    const layout = layoutRichText(content, measure, evaluation)
    expect(layout.runs.map(run => run.text)).toEqual(['中👨‍👩‍👧‍👦文', '标题'])
    expect(layout.runs.map(run => [run.x, run.y, run.width])).toEqual([[5, 8, 30], [10, 20.5, 20]])
    expect(layout.runs[1].style.fontWeight).toBe(700)
    expect(content).toEqual(original)
  })
  it('文字框高度及垂直对齐按整体段落移动，逻辑尺寸不会裁掉原文', () => {
    const content = text();content.box.height = 100
    const initial = layoutRichText(content,measure,evaluation)
    const contentHeight = 2 * 12.5 + 2 + 4
    expect(initial.runs[0].y).toBe(8 + (100-contentHeight)/2)
    for(const paragraph of content.paragraphs)for(const run of paragraph.runs)run.style.verticalAlign='bottom'
    expect(layoutRichText(content,measure,evaluation).runs[0].y).toBe(8 + 100-contentHeight)
    expect(initial.height).toBe(100)
  })
  it('空段落保留行高，两端对齐按整词排版，RTL 保留原文字内容', () => {
    const content = text(); content.box.width = 70
    content.paragraphs = [{ ...content.paragraphs[0], align: 'justify-all', runs: [{ text: 'AB CD', style: defaultTextStyle(150) }] }, { ...content.paragraphs[0], runs: [{ text: '', style: defaultTextStyle(150) }] }, { ...content.paragraphs[0], direction: 'rtl', runs: [{ text: 'مرحبا', style: defaultTextStyle(150) }, { text: '世界', style: defaultTextStyle(150) }] }]
    const layout = layoutRichText(content, measure, evaluation)
    expect(layout.runs.slice(0, 3).map(run => [run.text, run.x])).toEqual([['AB', 5], [' ', 25], ['CD', 55]])
    expect(layout.runs.at(-1)?.direction).toBe('rtl')
    expect(layout.height).toBeGreaterThan(37)
  })
  it('允许 8K 以上逻辑字号和任意数量片段，拒绝非有限几何、无起点路径和陌生字段', () => {
    const content = text(); content.paragraphs[0].runs[0].style.fontSize = 12000
    expect(richTextContentSchema.safeParse(content).success).toBe(true)
    expect(richTextContentSchema.safeParse({ ...content, bytes: [0, 1] }).success).toBe(false)
    expect(vectorPathContentSchema.safeParse({ operands: [{ operation: 'replace', path: { fillRule: 'nonzero', commands: [{ kind: 'line', x: 0, y: 1 }] } }], paint: defaultTextStyle(150) }).success).toBe(false)
    const path = rectanglePath(0, 0, 4, 4); path.commands[0] = { kind: 'move', x: Infinity, y: 0 }
    expect(vectorPathContentSchema.safeParse({ operands: [{ operation: 'replace', path }], paint: { fill: { enabled: true, color: defaultTextStyle(150).fill.color }, strokes: [], shadows: [] } }).success).toBe(false)
  })
  it('布尔组合与非零/奇偶绕向支持孔洞，分块覆盖与单块一致', () => {
    const operands = [{ operation: 'replace' as const, path: rectanglePath(0, 0, 12, 12) }, { operation: 'subtract' as const, path: ellipsePath(3, 3, 6, 6) }]
    const whole = rasterizeVectorCoverage(operands, { x: 0, y: 0, width: 12, height: 12 })
    expect(whole[0]).toBe(1); expect(whole[6 * 12 + 6]).toBe(0)
    expect([...whole].some(value => value > 0 && value < 1)).toBe(true)
    const tile = rasterizeVectorCoverage(operands, { x: 5, y: 2, width: 4, height: 8 })
    for (let y = 0; y < 8; y++) expect([...tile.subarray(y * 4, y * 4 + 4)]).toEqual([...whole.subarray((y + 2) * 12 + 5, (y + 2) * 12 + 9)])
    const compound = { ...rectanglePath(0, 0, 12, 12), commands: [...rectanglePath(0, 0, 12, 12).commands, ...rectanglePath(3, 3, 6, 6).commands] }
    expect(rasterizeVectorCoverage([{ operation: 'replace', path: compound }], { x: 5, y: 5, width: 1, height: 1 })[0]).toBe(1)
    expect(rasterizeVectorCoverage([{ operation: 'replace', path: { ...compound, fillRule: 'evenodd' } }], { x: 5, y: 5, width: 1, height: 1 })[0]).toBe(0)
  })
  it('曲线控制柄随宿主仿射变换，取消不会交付部分覆盖', () => {
    const path = arrowPath({ x: 10, y: 20 }, { x: 110, y: 60 }, 3, { x: 40, y: 90 })
    const transformed = transformVectorPath(path, [2, 0, 0, .5, -20, -10])
    expect(transformed.commands[1]).toEqual({ kind: 'quadratic', x: 200, y: 20, cx: 60, cy: 35 })
    expect(flattenVectorPath(path)[0].length).toBeGreaterThan(2)
    const cancel = new AbortController(); cancel.abort()
    expect(() => rasterizeVectorCoverage([{ operation: 'replace', path }], { x: 0, y: 0, width: 4, height: 4 }, 1, 1, cancel.signal)).toThrow()
    expect(() => layoutRichText(text(), measure, { ...evaluation, signal: cancel.signal })).toThrow()
  })
})
