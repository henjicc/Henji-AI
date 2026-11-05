import { readFileSync, existsSync } from 'node:fs'
import { BLACK_HEX } from '../../../core/theme/colorTokens'
import { expect, it } from 'vitest'
import { TextFontSession } from '../../../core/imaging/vectorContent/shaping/fontPolicy'
import { withTextFontSession } from '../../../core/imaging/vectorContent/shaping/fontContext'
import { layoutText, drawText, glyphLayers } from './text'
import { layoutTable } from './table'
import { recordAuthorCanvas, sameAuthorCanvasRecording } from '../engine/videoEditAuthorCanvasRecorder'

it('正式作者入口无 Canvas 度量地录制轮廓/外观指纹，揭示共享簇跟随 owner，关闭释放布局', async () => {
  const file = ['C:/Windows/Fonts/calibri.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(existsSync)
  if (!file) throw new Error('需要本机可用字体')
  const data = readFileSync(file), fonts = new TextFontSession('win32', async () => ({ bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }))
  await fonts.prepare()
  const cleanup: Array<() => void> = [], owner = {}
  const access = { owner, chain: fonts.chain.bind(fonts), choose: fonts.choose.bind(fonts), onClose: (run: () => void) => cleanup.push(run) }
  const measure = { reset() {}, globalCompositeOperation: 'source-over', globalAlpha: 1, measureText() { throw new Error('不应读取 Canvas 度量') } } as unknown as OffscreenCanvasRenderingContext2D
  try {
    withTextFontSession(access, () => {
      const options = { maxWidth: 500 }, plain = layoutText('ffi AV', { fontSize: 40 }, { ligatures: true }), appearance = layoutText('hello', { strokes: [{ width: 4, color: BLACK_HEX, position: 'outside' }] }, options)
      options.maxWidth = 1
      const record = () => recordAuthorCanvas({ width: 800, height: 300 }, measure, [1, 0, 0, 1, 0, 0], ctx => { drawText(ctx, plain); drawText(ctx, appearance) }, true)
      const a = record(), b = record()
      expect(a.comparable).toBe(true); expect(sameAuthorCanvasRecording(a, b)).toBe(true)
      expect(a.ops.some(op => op[0] === 'textAppearance')).toBe(true)
      expect(a.textDraws[1].constraint.maxWidth).toBe(500)
      expect(() => recordAuthorCanvas({ width: 800, height: 300 }, measure, [1, 0, 0, 1, 0, 0], ctx => { ctx.globalCompositeOperation = 'destination-in'; drawText(ctx, plain) }, true)).toThrow('source-in')
      const hidden = recordAuthorCanvas({ width: 800, height: 300 }, measure, [1, 0, 0, 1, 0, 0], ctx => drawText(ctx, plain, { graphemes: [1] }), true)
      expect(hidden.textDraws[0].inkBounds).toBeNull()
      const erased = recordAuthorCanvas({ width: 800, height: 300 }, measure, [1, 0, 0, 1, 0, 0], ctx => { drawText(ctx, plain); ctx.globalCompositeOperation = 'destination-out'; drawText(ctx, appearance) }, true)
      expect(erased.textDraws[0].retained).toBe(false)
      const merged = layoutTable({ columns: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], rows: [{ a: { text: '跨两列的一个很长的标题', colSpan: 2 }, c: 'x' }, { a: { text: '跨两行', rowSpan: 2 }, b: 'b1', c: 'c1' }, { b: 'b2', c: 'c2' }], style: { fontSize: 20 } }, { width: 600, cellPadding: 4 })
      expect(merged.cells).toHaveLength(7)
      expect(merged.cells[0].box.width).toBeCloseTo(merged.columns[0] + merged.columns[1])
      expect(merged.cells.find(cell => cell.rowSpan === 2)!.box.height).toBeCloseTo(merged.rows[1] + merged.rows[2])
      const glyphs = glyphLayers(layoutText('ab c', { fontSize: 40 }), { pose: () => ({}) })
      expect(glyphs).toHaveLength(3)
      const table = layoutTable({ columns: [{ key: 'n', numeric: true }, { key: 'label' }], rows: [{ n: '-12.5%', label: 'abc' }, { n: '200', label: 'longer' }], style: { fontSize: 30 } }, { width: 300, cellPadding: 4 })
      expect(table.cells[1].box.x).toBeGreaterThanOrEqual(table.cells[0].box.width)
      expect(table.diagnostics).toEqual([])
      cleanup.forEach(run => run())
      expect(() => drawText(measure, plain)).toThrow('已经释放')
    })
  } finally { fonts.close() }
})
