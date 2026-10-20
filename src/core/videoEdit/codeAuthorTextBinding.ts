import type { CodeParameterDeclaration, CodeParameterValues, CodeParameterValue } from './codeMaterial/contract'
import type { AuthorElementObservation } from './codeAuthorProgram'

export interface CodeAuthorTextBinding { parameter: string; value: string; row?: number; field?: string }

/** Editing-time lookup only. A stable data key always takes precedence over the observed index. */
export function readCodeAuthorTextBinding(author: AuthorElementObservation | undefined, declarations: readonly CodeParameterDeclaration[], values: CodeParameterValues): CodeAuthorTextBinding | undefined {
  if (!author) return undefined
  if (author.textParameterKeys.length === 1) {
    const parameter = author.textParameterKeys[0]
    if (declarations.some(item => item.key === parameter && item.type === 'text') && typeof values[parameter] === 'string') return { parameter, value: values[parameter] as string }
    return undefined
  }
  if (author.textParameterKeys.length) return undefined
  const data = author.data
  if (!data) return undefined
  const table = declarations.find(item => item.key === data.parameter)
  if (table?.type !== 'table') return undefined
  const fields = Object.entries(table.fields).filter(([key, field]) => field.type === 'text' && key !== table.rowKey && key !== data.keyField)
  if (fields.length !== 1) return undefined
  const rows = values[data.parameter]
  if (!Array.isArray(rows)) return undefined
  const matches = data.key !== undefined && data.keyField
    ? rows.flatMap((row, index) => row && typeof row === 'object' && Object.hasOwn(row, data.keyField!) && (row as Record<string, unknown>)[data.keyField!] === data.key ? [index] : [])
    : [data.index]
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]) || matches[0] < 0) return undefined
  const row = matches[0], field = fields[0][0], record = rows[row]
  if (!record || typeof record !== 'object' || !Object.hasOwn(record, field)) return undefined
  const value = (record as Record<string, unknown>)[field]
  return typeof value === 'string' ? { parameter: data.parameter, row, field, value } : undefined
}

/** The caller writes the complete parameter through the existing undoable parameter operation. */
export function codeAuthorTextParameterValue(binding: CodeAuthorTextBinding, values: CodeParameterValues, text: string): CodeParameterValue {
  if (binding.row === undefined || binding.field === undefined) return text
  const rows = values[binding.parameter]
  if (!Array.isArray(rows)) throw new Error('图层的数据表已改变，请重新选择。')
  return rows.map((row, index) => index === binding.row ? { ...row as Record<string, unknown>, [binding.field!]: text } : row) as CodeParameterValue
}
