import { distributeTableColumns, type TableColumn } from '../../../core/imaging/vectorContent/shaping/table'
import { prepareTextLayout, textIntrinsicWidths } from './shapedText'
import type { RichTextContent, TextStyleInput, TextLayout } from './text'
export type { TableColumn }
export interface TableCell { text: string | RichTextContent; style?: TextStyleInput }
export interface TableInput { columns: readonly TableColumn[]; rows: readonly Readonly<Record<string, string | TableCell>>[]; style?: TextStyleInput }
export interface TableOptions { width?: number; cellPadding?: number; columnGap?: number; rowGap?: number }
export interface TableLayout {
  readonly columns: readonly number[]; readonly rows: readonly number[]
  readonly box: Readonly<{ x: number; y: number; width: number; height: number }>; readonly overflow: boolean; readonly diagnostics: readonly string[]
  readonly cells: readonly Readonly<{ row: number; column: number; box: { x: number; y: number; width: number; height: number }; contentBox: { x: number; y: number; width: number; height: number }; text: TextLayout }>[]
}
export function layoutTable(input: TableInput, options: TableOptions = {}): TableLayout {
  const padding = options.cellPadding ?? 0, gap = options.columnGap ?? 0, rowGap = options.rowGap ?? 0
  if ([padding, gap, rowGap, options.width ?? 0, ...input.columns.map(column => column.width ?? 0)].some(value => !Number.isFinite(value) || value < 0)) throw new Error('表格尺寸必须是有限非负数')
  const keys = new Set(input.columns.map(column => column.key))
  if (keys.size !== input.columns.length) throw new Error('表格列 key 不能重复')
  for (const row of input.rows) for (const key of Object.keys(row)) if (!keys.has(key)) throw new Error(`表格单元格找不到列：${key}`)
  const prepare = (row: number, column: number, width?: number, x = 0, y = 0): TextLayout => {
    const col = input.columns[column], cell = input.rows[row][col.key] ?? '', value = typeof cell === 'string' ? { text: cell } : cell
    const align = col.align ?? (col.numeric ? 'right' : 'left')
    const content = typeof value.text === 'string' ? value.text : { ...value.text, paragraphs: value.text.paragraphs.map(p => ({ ...p, align, runs: p.runs.map(run => ({ ...run, style: { ...run.style, verticalAlign: 'top' as const } })) })) }
    return prepareTextLayout(content, { ...input.style, ...value.style, align, verticalAlign: 'top' }, { wrapWidth: width, box: { width }, anchor: { x, y, horizontal: 0, vertical: 0 }, features: col.numeric ? { tnum: 1, pnum: 0 } : undefined })
  }
  const natural = input.rows.map((_, row) => input.columns.map((_, column) => prepare(row, column)))
  const measures = input.columns.map((_, column) => ({ min: Math.max(0, ...natural.map(row => textIntrinsicWidths(row[column]).min)) + 2 * padding, max: Math.max(0, ...natural.map(row => textIntrinsicWidths(row[column]).max)) + 2 * padding }))
  const widths = distributeTableColumns(input.columns, measures, options.width, gap), heights: number[] = [], cells: Array<TableLayout['cells'][number]> = [], diagnostics: string[] = []
  for (const [index, column] of input.columns.entries()) if (column.numeric) {
    const styles = new Map(natural.flatMap(row => row[index].graphemes.map(g => [JSON.stringify(g.style), g.style] as const)))
    for (const style of styles.values()) {
      const digits = [...'0123456789'].map(text => prepareTextLayout(text, style, { features: { tnum: 1, pnum: 0 }, autospace: false }))
      if (digits.some(digit => digit.contentSize.width !== digits[0].contentSize.width || digit.diagnostics.length)) diagnostics.push(`数字列 ${input.columns[index].key} 的字体 ${style.fontFamily} 未提供可用等宽数字`)
    }
  }
  let y = 0, overflow = false
  input.rows.forEach((_, row) => {
    let x = 0
    const texts = input.columns.map((_, column) => { const text = prepare(row, column, Math.max(Number.MIN_VALUE, widths[column] - padding * 2), x + padding, y + padding); x += widths[column] + gap; return text })
    const height = Math.max(0, ...texts.map(text => text.contentSize.height)) + padding * 2
    x = 0; heights.push(height)
    texts.forEach((text, column) => { overflow ||= text.contentSize.width > Math.max(0, widths[column] - padding * 2); cells.push(Object.freeze({ row, column, box: Object.freeze({ x, y, width: widths[column], height }), contentBox: Object.freeze({ x: x + padding, y: y + padding, width: Math.max(0, widths[column] - padding * 2), height: height - padding * 2 }), text })); x += widths[column] + gap })
    y += height + rowGap
  })
  const occupied = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
  return Object.freeze({ columns: Object.freeze(widths), rows: Object.freeze(heights), box: Object.freeze({ x: 0, y: 0, width: Math.max(options.width ?? 0, occupied), height: Math.max(0, y - rowGap) }), cells: Object.freeze(cells), overflow: overflow || options.width !== undefined && occupied > options.width, diagnostics: Object.freeze(diagnostics) })
}
