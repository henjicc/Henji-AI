import { distributeTableColumns, type TableColumn } from '../../../core/imaging/vectorContent/shaping/table'
import { prepareTextLayout, textIntrinsicWidths } from './shapedText'
import type { RichTextContent, TextStyleInput, TextLayout } from './text'
interface TableCell { text: string | RichTextContent; style?: TextStyleInput; colSpan?: number; rowSpan?: number }
export interface TableInput { columns: readonly TableColumn[]; rows: readonly Readonly<Record<string, string | TableCell>>[]; style?: TextStyleInput }
export interface TableOptions { width?: number; cellPadding?: number; columnGap?: number; rowGap?: number }
export interface TableLayout {
  readonly columns: readonly number[]; readonly rows: readonly number[]
  readonly box: Readonly<{ x: number; y: number; width: number; height: number }>; readonly overflow: boolean; readonly diagnostics: readonly string[]
  readonly cells: readonly Readonly<{ row: number; column: number; colSpan: number; rowSpan: number; box: { x: number; y: number; width: number; height: number }; contentBox: { x: number; y: number; width: number; height: number }; text: TextLayout }>[]
}
interface PlacedCell { row: number; column: number; colSpan: number; rowSpan: number; value: TableCell }

/** 合并单元格占住的格子不再读自己的内容，顺序按从上到下、从左到右。 */
function placeCells(input: TableInput): PlacedCell[] {
  const covered = new Set<string>(), placed: PlacedCell[] = []
  input.rows.forEach((row, rowIndex) => input.columns.forEach((column, columnIndex) => {
    if (covered.has(`${rowIndex}:${columnIndex}`)) return
    const cell = row[column.key] ?? '', value = typeof cell === 'string' ? { text: cell } : cell
    const colSpan = Math.min(value.colSpan ?? 1, input.columns.length - columnIndex), rowSpan = Math.min(value.rowSpan ?? 1, input.rows.length - rowIndex)
    if (!Number.isInteger(colSpan) || colSpan < 1 || !Number.isInteger(rowSpan) || rowSpan < 1) throw new Error('colSpan 和 rowSpan 必须是正整数')
    for (let r = 0; r < rowSpan; r++) for (let c = 0; c < colSpan; c++) {
      if (covered.has(`${rowIndex + r}:${columnIndex + c}`)) throw new Error(`第 ${rowIndex + 1} 行「${column.key}」列的合并格压到了别的合并格`)
      covered.add(`${rowIndex + r}:${columnIndex + c}`)
    }
    placed.push({ row: rowIndex, column: columnIndex, colSpan, rowSpan, value })
  }))
  return placed
}

export function layoutTable(input: TableInput, options: TableOptions = {}): TableLayout {
  const padding = options.cellPadding ?? 0, gap = options.columnGap ?? 0, rowGap = options.rowGap ?? 0
  if ([padding, gap, rowGap, options.width ?? 0, ...input.columns.map(column => column.width ?? 0)].some(value => !Number.isFinite(value) || value < 0)) throw new Error('表格尺寸必须是有限非负数')
  const keys = new Set(input.columns.map(column => column.key))
  if (keys.size !== input.columns.length) throw new Error('表格列 key 不能重复')
  for (const row of input.rows) for (const key of Object.keys(row)) if (!keys.has(key)) throw new Error(`表格单元格找不到列：${key}`)
  const placed = placeCells(input)
  const prepare = (cell: PlacedCell, width?: number, x = 0, y = 0): TextLayout => {
    const col = input.columns[cell.column], value = cell.value
    const align = col.align ?? (col.numeric ? 'right' : 'left')
    const content = typeof value.text === 'string' ? value.text : { ...value.text, paragraphs: value.text.paragraphs.map(p => ({ ...p, align, runs: p.runs.map(run => ({ ...run, style: { ...run.style, verticalAlign: 'top' as const } })) })) }
    return prepareTextLayout(content, { ...input.style, ...value.style, align, verticalAlign: 'top' }, { wrapWidth: width, box: { width }, anchor: { x, y, horizontal: 0, vertical: 0 }, features: col.numeric ? { tnum: 1, pnum: 0 } : undefined })
  }
  const natural = new Map(placed.map(cell => [cell, prepare(cell)]))
  const measures = input.columns.map((_, column) => {
    const own = placed.filter(cell => cell.column === column && cell.colSpan === 1).map(cell => textIntrinsicWidths(natural.get(cell)!))
    return { min: Math.max(0, ...own.map(value => value.min)) + 2 * padding, max: Math.max(0, ...own.map(value => value.max)) + 2 * padding }
  })
  // 跨列的格子放不下时，把缺的宽度平摊给它占的自适应列，固定列的宽度不动；这样不跨列的表格结果不变。
  for (const cell of placed.filter(value => value.colSpan > 1)) {
    const columns = input.columns.slice(cell.column, cell.column + cell.colSpan), range = measures.slice(cell.column, cell.column + cell.colSpan)
    const open = range.filter((_, index) => columns[index].width === undefined)
    if (!open.length) continue
    const inner = gap * (cell.colSpan - 1), size = textIntrinsicWidths(natural.get(cell)!)
    const used = (key: 'min' | 'max'): number => range.reduce((sum, value, index) => sum + (columns[index].width ?? value[key]), 0)
    const needMin = size.min + 2 * padding - inner - used('min'), needMax = size.max + 2 * padding - inner - used('max')
    for (const measure of open) { if (needMin > 0) measure.min += needMin / open.length; if (needMax > 0) measure.max += needMax / open.length }
  }
  const widths = distributeTableColumns(input.columns, measures, options.width, gap), heights: number[] = [], diagnostics: string[] = []
  for (const [index, column] of input.columns.entries()) if (column.numeric) {
    const styles = new Map(placed.filter(cell => cell.column === index).flatMap(cell => natural.get(cell)!.graphemes.map(g => [JSON.stringify(g.style), g.style] as const)))
    for (const style of styles.values()) {
      const digits = [...'0123456789'].map(text => prepareTextLayout(text, style, { features: { tnum: 1, pnum: 0 }, autospace: false }))
      if (digits.some(digit => digit.contentSize.width !== digits[0].contentSize.width || digit.diagnostics.length)) diagnostics.push(`数字列 ${input.columns[index].key} 的字体 ${style.fontFamily} 未提供可用等宽数字`)
    }
  }
  const columnX = widths.reduce<number[]>((list, width, index) => { list.push(index ? list[index - 1] + widths[index - 1] + gap : 0); return list }, [])
  const spanWidth = (cell: PlacedCell): number => widths.slice(cell.column, cell.column + cell.colSpan).reduce((sum, width) => sum + width, 0) + gap * (cell.colSpan - 1)
  const laid: Array<{ cell: PlacedCell; text: TextLayout; y: number }> = []
  let y = 0, overflow = false
  input.rows.forEach((_, row) => {
    for (const cell of placed) if (cell.row === row) {
      const text = prepare(cell, Math.max(Number.MIN_VALUE, spanWidth(cell) - padding * 2), columnX[cell.column] + padding, y + padding)
      overflow ||= text.contentSize.width > Math.max(0, spanWidth(cell) - padding * 2)
      laid.push({ cell, text, y })
    }
    // 跨行的格子在它最后一行结算：前面几行的高度不够才撑高这一行。
    const need = laid.filter(({ cell }) => cell.row + cell.rowSpan - 1 === row).map(({ text, y: start }) => start + text.contentSize.height + padding * 2 - y)
    const height = Math.max(0, ...need)
    heights.push(height)
    y += height + rowGap
  })
  const cells = laid.map(({ cell, text, y: start }) => {
    const width = spanWidth(cell), x = columnX[cell.column]
    const height = heights.slice(cell.row, cell.row + cell.rowSpan).reduce((sum, value) => sum + value, 0) + rowGap * (cell.rowSpan - 1)
    return Object.freeze({ row: cell.row, column: cell.column, colSpan: cell.colSpan, rowSpan: cell.rowSpan, box: Object.freeze({ x, y: start, width, height }), contentBox: Object.freeze({ x: x + padding, y: start + padding, width: Math.max(0, width - padding * 2), height: height - padding * 2 }), text })
  })
  const occupied = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
  return Object.freeze({ columns: Object.freeze(widths), rows: Object.freeze(heights), box: Object.freeze({ x: 0, y: 0, width: Math.max(options.width ?? 0, occupied), height: Math.max(0, y - rowGap) }), cells: Object.freeze(cells), overflow: overflow || options.width !== undefined && occupied > options.width, diagnostics: Object.freeze(diagnostics) })
}
