/**
 * 参数化体检：源码通过编译后，指出“以后用户想改却只能改源码”的地方，引导作者开放参数。
 * 只给提示，不拒绝提交；提示随创建结果交给作者（助手），界面不展示。
 *
 * 检查项（都是编译后 IR 上的静态分析，不执行源码）：
 * - 没有声明任何参数却画了文字或图形；
 * - 声明了但没有读到的参数；
 * - 文字元素里写死的文本（字面量）；
 * - 同一个字面量颜色在多个元素里重复出现（应改成颜色参数或风格令牌 ctx.style）。
 */
import type { CodeExpression, CodeMaterialProgram } from './contract'

export interface CodeAuthoringHint { code: 'NO_PARAMETERS' | 'UNUSED_PARAMETER' | 'LITERAL_TEXT' | 'REPEATED_COLOR'; message: string; line?: number }

const COLOR_KEYS = new Set(['fill', 'color', 'stroke'])

function literalColor(expression: CodeExpression): string | undefined {
  if (expression.kind !== 'color' && expression.kind !== 'array') return undefined
  const values = expression.values.map(value => value.kind === 'literal' && typeof value.value === 'number' ? value.value : undefined)
  if (values.length !== 4 || values.some(value => value === undefined)) return undefined
  return values.map(value => Math.round((value as number) * 255)).join(',')
}

export function codeMaterialAuthoringHints(program: CodeMaterialProgram): CodeAuthoringHint[] {
  const hints: CodeAuthoringHint[] = []
  const used = new Set<string>()
  const texts: Array<{ text: string; line?: number }> = []
  const colors = new Map<string, number[]>()
  let draws = 0
  const seen = new Set<CodeExpression>()
  const visit = (expression: CodeExpression | undefined): void => {
    if (!expression || typeof expression !== 'object' || seen.has(expression)) return
    seen.add(expression)
    if (expression.kind === 'parameter') used.add(expression.key)
    if (expression.kind === 'binding') visit(program.bindings[expression.slot]?.expression)
    if (expression.kind === 'draw') {
      draws++
      const line = expression.sourceSpan?.startLine
      const text = expression.properties.text
      if (expression.shape === 'text' && text?.kind === 'literal' && typeof text.value === 'string' && text.value.trim()) texts.push({ text: text.value, line })
      for (const [key, value] of Object.entries(expression.properties)) {
        if (!COLOR_KEYS.has(key)) continue
        const color = literalColor(value)
        if (color) colors.set(color, [...(colors.get(color) ?? []), line ?? 0])
      }
    }
    for (const item of Object.values(expression)) {
      if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) visit(child as CodeExpression) })
      else if (item && typeof item === 'object' && 'kind' in item) visit(item as CodeExpression)
      else if (item && typeof item === 'object' && !Array.isArray(item)) for (const child of Object.values(item)) if (child && typeof child === 'object' && 'kind' in child) visit(child as CodeExpression)
    }
  }
  program.bindings.forEach(binding => visit(binding.expression))
  visit(program.result)
  if (!program.parameters.length && draws) hints.push({ code: 'NO_PARAMETERS', message: '没有开放任何参数：用户或助手以后改文字、颜色、时长都只能改源码。把可能会改的量声明成参数（parameters），画面从参数推导。' })
  for (const parameter of program.parameters) if (!used.has(parameter.key)) hints.push({ code: 'UNUSED_PARAMETER', message: `参数 ${parameter.key}（${parameter.title}）声明了但源码没有读取，改它不会有任何效果；删掉或接到画面上。` })
  for (const { text, line } of texts.slice(0, 8)) hints.push({ code: 'LITERAL_TEXT', message: `文字“${text.length > 24 ? `${text.slice(0, 24)}…` : text}”写死在源码里${line ? `（第 ${line} 行）` : ''}；用户要改字时只能改源码，建议声明为 text 参数。`, ...(line ? { line } : {}) })
  for (const [color, lines] of colors) if (lines.length >= 3) hints.push({ code: 'REPEATED_COLOR', message: `颜色 rgb(${color.split(',').slice(0, 3).join(', ')}) 在 ${lines.length} 个元素里写死（第 ${[...new Set(lines.filter(Boolean))].slice(0, 6).join('、')} 行）；改成颜色参数或风格令牌 ctx.style，换色只改一处。`, ...(lines[0] ? { line: lines[0] } : {}) })
  return hints
}
