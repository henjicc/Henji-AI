import { type FontSource, type ShapeOptions, TextShaper } from './harfbuzz'
import { ShapedParagraph, type ParagraphLayout } from './paragraph'

export interface TableColumn { key: string; width?: number; align?: 'left' | 'center' | 'right'; numeric?: boolean }
export interface TableInput { columns: readonly TableColumn[]; rows: readonly Readonly<Record<string, string>>[] }
export interface TableOptions { width?: number; cellPadding?: number; columnGap?: number; rowGap?: number }
interface TableCellLayout { row: number; column: number; x: number; y: number; width: number; height: number; textX: number; textY: number; text: ParagraphLayout }
export interface TableLayout { readonly columns: readonly number[]; readonly rows: readonly number[]; readonly cells: readonly Readonly<TableCellLayout>[]; readonly width: number; readonly height: number; readonly overflow: boolean; readonly diagnostics: readonly string[] }

export function distributeTableColumns(columns: readonly TableColumn[], measures: readonly { min: number; max: number }[], total?: number, gap = 0): number[] {
  const widths = columns.map((column, index) => column.width ?? measures[index].max)
  const auto = columns.flatMap((column, index) => column.width === undefined ? [index] : [])
  if (total !== undefined && auto.length) {
    const room = total - Math.max(0, columns.length - 1) * gap - columns.reduce((sum, column) => sum + (column.width ?? 0), 0)
    const min = auto.reduce((sum, index) => sum + measures[index].min, 0), max = auto.reduce((sum, index) => sum + measures[index].max, 0)
    for (const index of auto) widths[index] = room <= min ? measures[index].min : room >= max ? measures[index].max + (room - max) / auto.length : measures[index].min + (room - min) * (measures[index].max - measures[index].min) / (max - min)
  }
  return widths
}

/** 同一 shaper、字体与排版选项贯穿内在宽度、最终单元格和数字列。 */
export function layoutShapedTable(shaper: TextShaper, font: FontSource, input: TableInput, style: ShapeOptions, options: TableOptions = {}): TableLayout {
  const padding = options.cellPadding ?? 0, columnGap = options.columnGap ?? 0, rowGap = options.rowGap ?? 0
  for (const value of [padding, columnGap, rowGap, options.width ?? 0, ...input.columns.map(column => column.width ?? 0)]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('表格尺寸必须是有限的非负数')
  }
  const keys = new Set(input.columns.map(column => column.key))
  if (keys.size !== input.columns.length) throw new Error('表格列 key 不能重复')
  for (const row of input.rows) for (const key of Object.keys(row)) if (!keys.has(key)) throw new Error(`表格单元格找不到列：${key}`)
  const styles = input.columns.map(column => column.numeric ? { ...style, features: { ...style.features, tnum: 1, pnum: 0 } } : style)
  const paragraphs = input.rows.map(row => input.columns.map((column, index) => new ShapedParagraph(shaper, font, row[column.key] ?? '', styles[index])))
  const measures = input.columns.map((_, column) => {
    const values = paragraphs.map(row => row[column].intrinsicWidths())
    return { min: Math.max(0, ...values.map(value => value.min)) + padding * 2, max: Math.max(0, ...values.map(value => value.max)) + padding * 2 }
  })
  const widths = distributeTableColumns(input.columns, measures, options.width, columnGap)
  const gaps = Math.max(0, widths.length - 1) * columnGap
  const diagnostics: string[] = []
  input.columns.forEach((column, index) => {
    if (!column.numeric) return
    const digits = [...'0123456789'].map(char => shaper.shape(font, char, styles[index]))
    if (digits.some(result => result.glyphs.some(glyph => !glyph.id)) || digits.some(result => result.width !== digits[0].width)) diagnostics.push(`数字列 ${column.key} 的字体未提供等宽数字`)
  })
  const cells: TableCellLayout[] = [], heights: number[] = []
  let y = 0
  input.rows.forEach((row, rowIndex) => {
    let x = 0
    const layouts = input.columns.map((column, index) => {
      // 文本入口以 0 表示不限宽，固定零宽列须使用最小正宽来得到 overflow。
      const inner = Math.max(Number.MIN_VALUE, widths[index] - padding * 2)
      return new ShapedParagraph(shaper, font, row[column.key] ?? '', { ...styles[index], maxWidth: inner }).layout()
    })
    const height = Math.max(0, ...layouts.map(layout => layout.height)) + padding * 2
    heights.push(height)
    layouts.forEach((text, columnIndex) => {
      const column = input.columns[columnIndex], align = column.align ?? (column.numeric ? 'right' : 'left')
      const free = Math.max(0, widths[columnIndex] - padding * 2 - text.width)
      cells.push(Object.freeze({ row: rowIndex, column: columnIndex, x, y, width: widths[columnIndex], height, textX: x + padding + (align === 'right' ? free : align === 'center' ? free / 2 : 0), textY: y + padding, text }))
      x += widths[columnIndex] + columnGap
    })
    y += height + rowGap
  })
  const occupied = widths.reduce((sum, width) => sum + width, 0) + gaps
  return Object.freeze({ columns: Object.freeze(widths), rows: Object.freeze(heights), cells: Object.freeze(cells), width: Math.max(occupied, options.width ?? 0), height: Math.max(0, y - rowGap), overflow: (options.width !== undefined && occupied > options.width) || cells.some(cell => cell.text.overflow), diagnostics: Object.freeze(diagnostics) })
}
