import type { CodeParameterDeclaration, CodeParameterValues, CodeParameterValue } from './codeMaterial/contract'
import type { AuthorElementObservation } from './codeAuthorProgram'
import type { TextDrawObservation } from './textDrawObservation'

export interface CodeAuthorTextBinding { parameter: string; value: string; row?: number; field?: string }
/** 元素上画出来的一段文字：`binding` 是能直接改的参数；没有 binding 的段落写死在源码里，只能交给助手改源码。 */
export interface CodeAuthorTextTarget { text: string; binding?: CodeAuthorTextBinding; draw?: TextDrawObservation }

/** 绑定到这个图层、值是字符串的文字参数，以及数据行里除行键外的文字字段。数据行按稳定键定位，键缺失或重复时不回退到旧下标。 */
function textCandidates(author: AuthorElementObservation, declarations: readonly CodeParameterDeclaration[], values: CodeParameterValues): CodeAuthorTextBinding[] {
  const result: CodeAuthorTextBinding[] = []
  for (const parameter of author.textParameterKeys) if (declarations.some(item => item.key === parameter && item.type === 'text') && typeof values[parameter] === 'string') result.push({ parameter, value: values[parameter] as string })
  const data = author.data
  const table = data && declarations.find(item => item.key === data.parameter)
  if (!data || table?.type !== 'table') return result
  const rows = values[data.parameter]
  if (!Array.isArray(rows)) return result
  const matches = data.key !== undefined && data.keyField
    ? rows.flatMap((row, index) => row && typeof row === 'object' && Object.hasOwn(row, data.keyField!) && (row as Record<string, unknown>)[data.keyField!] === data.key ? [index] : [])
    : [data.index]
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]) || matches[0] < 0) return result
  const row = matches[0], record = rows[row]
  if (!record || typeof record !== 'object') return result
  for (const [field, declaration] of Object.entries(table.fields)) {
    if (declaration.type !== 'text' || field === table.rowKey || field === data.keyField || !Object.hasOwn(record, field)) continue
    const value = (record as Record<string, unknown>)[field]
    if (typeof value === 'string') result.push({ parameter: data.parameter, row, field, value })
  }
  return result
}

/**
 * 编辑时把画出来的每段文字对上参数：内容相同的唯一候选就是它；只有一段字、一个候选时即使内容经过拼接也认定是它。
 * 没有绘制观察（旧作者接口、网页文字）时，只有唯一候选才能编辑。
 */
export function readCodeAuthorTextTargets(author: AuthorElementObservation | undefined, declarations: readonly CodeParameterDeclaration[], values: CodeParameterValues, layers: ReadonlySet<string> = new Set()): CodeAuthorTextTarget[] {
  if (!author) return []
  const candidates = textCandidates(author, declarations, values)
  const seen = new Set<string>()
  // 描边、阴影或保留帧会把同一段字报告多次：内容、框与矩阵都相同的只算一段。
  const draws = (author.textDraws ?? []).filter(draw => { const key = JSON.stringify([draw.sourceText, draw.box, draw.matrix]); if (seen.has(key)) return false; seen.add(key); return true })
  if (!draws.length) return candidates.length === 1 ? [{ text: candidates[0].value, binding: candidates[0] }] : []
  // 内容相同的段落与参数按出现顺序一一对应（两个参数同值时各认一段）。
  const used = new Set<CodeAuthorTextBinding>()
  const bindings = draws.map(draw => {
    const equal = candidates.filter(candidate => candidate.value === draw.sourceText)
    const sameDraws = draws.filter(other => other.sourceText === draw.sourceText).length
    // 只有一个同值参数时同文的几段都是它（手工阴影、描边各画一遍）；同值参数与同文段落一样多时按顺序一一对应。
    const binding = equal.length === 1 ? equal[0] : equal.length === sameDraws ? equal.find(candidate => !used.has(candidate)) : undefined
    if (binding) used.add(binding)
    return binding
  })
  // 剩下的唯一候选：画出来的字经过拼接或大小写变换时，认包含它的唯一一段（只有一段字时直接是它）。
  const left = candidates.filter(candidate => !used.has(candidate))
  if (left.length === 1) {
    const value = left[0].value.toLowerCase()
    const open = draws.flatMap((draw, index) => bindings[index] ? [] : [index])
    const containing = open.filter(index => value && draws[index].sourceText.toLowerCase().includes(value))
    const chosen = containing.length === 1 ? containing[0] : open.length === 1 && draws.length === 1 ? open[0] : undefined
    if (chosen !== undefined) bindings[chosen] = left[0]
  }
  // 逐字动画每个字一层，参数挂不到每一层上：没挂到现存图层（`layers`）的文字参数，值与画出来的整段字相同且唯一时也认定是它。
  for (const [index, draw] of draws.entries()) {
    if (bindings[index]) continue
    const equal = declarations.filter(item => item.type === 'text' && !(item.layer && layers.has(item.layer)) && values[item.key] === draw.sourceText)
    if (equal.length === 1) bindings[index] = { parameter: equal[0].key, value: draw.sourceText }
  }
  return draws.map((draw, index) => {
    const binding = bindings[index]
    return { text: binding?.value ?? draw.sourceText, ...(binding ? { binding } : {}), draw }
  })
}

/** The caller writes the complete parameter through the existing undoable parameter operation. */
export function codeAuthorTextParameterValue(binding: CodeAuthorTextBinding, values: CodeParameterValues, text: string): CodeParameterValue {
  if (binding.row === undefined || binding.field === undefined) return text
  const rows = values[binding.parameter]
  if (!Array.isArray(rows)) throw new Error('图层的数据表已改变，请重新选择。')
  return rows.map((row, index) => index === binding.row ? { ...row as Record<string, unknown>, [binding.field!]: text } : row) as CodeParameterValue
}

/** 文字参数的长度上限：顶层文字参数或数据表字段的 maxLength。 */
export function codeAuthorTextMaxLength(binding: CodeAuthorTextBinding, declarations: readonly CodeParameterDeclaration[]): number | undefined {
  const declaration = declarations.find(item => item.key === binding.parameter)
  const field = declaration?.type === 'table' && binding.field ? declaration.fields[binding.field] : declaration
  return field?.type === 'text' ? field.maxLength : undefined
}
