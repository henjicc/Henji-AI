import { DEFAULT_STYLE_TOKENS, resolveStyleTypeScale, styleTokensSchema, type StyleTokens } from '../styleKit'
import { CodeMaterialError } from './contract'
import type { CodeExpression, CodeMaterialProgram } from './contract'

function shape(value: unknown, path: string[]): CodeExpression {
  if (Array.isArray(value)) return { kind: 'style', type: 'color', path }
  if (value && typeof value === 'object') return { kind: 'object', type: 'object', properties: Object.fromEntries(Object.entries(value).map(([key, member]) => [key, shape(member, [...path, key])])) }
  if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') throw new CodeMaterialError('TYPE', '风格令牌契约无效。')
  return { kind: 'style', type: typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : 'number', path }
}
/** Only fixed public token paths become IR. No dynamic lookup, getter or host object. */
export const CODE_STYLE_EXPRESSION = shape(resolveStyleTypeScale(DEFAULT_STYLE_TOKENS), [])
export function isCodeStyleExpression(value: CodeExpression): boolean { return value.kind === 'style' || value.kind === 'object' && Object.values(value.properties).some(isCodeStyleExpression) }
export function validatedCodeStyle(value?: StyleTokens): StyleTokens {
  if (!value) return resolveStyleTypeScale(DEFAULT_STYLE_TOKENS)
  const parsed = styleTokensSchema.safeParse(value)
  if (!parsed.success) throw new CodeMaterialError('CONTEXT', `ctx.style 无效：${parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('；')}`)
  return resolveStyleTypeScale(parsed.data)
}
const boundPrograms = new WeakMap<CodeMaterialProgram, { key: string; program: CodeMaterialProgram }>()
const stylePrograms = new WeakMap<CodeMaterialProgram, boolean>()
export function readCodeStyleToken(tokens: StyleTokens, path: readonly string[]): number | boolean | string | number[] {
  let value: unknown = tokens
  for (const key of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key) || ['constructor', 'prototype', '__proto__'].includes(key)) throw new CodeMaterialError('TYPE', '未知风格令牌路径。')
    value = (value as Record<string, unknown>)[key]
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
  if (Array.isArray(value) && value.length === 4 && value.every(channel => typeof channel === 'number')) return [...value] as number[]
  throw new CodeMaterialError('TYPE', '风格读取必须指向固定令牌。')
}
/** Filters bake only validated host data into trusted IR, never author code into executable JS. */
export function bindCodeMaterialStyle(program: CodeMaterialProgram, style?: StyleTokens): CodeMaterialProgram {
  let usesStyle = stylePrograms.get(program)
  if (usesStyle === undefined) { usesStyle = JSON.stringify(program).includes('"kind":"style"'); stylePrograms.set(program, usesStyle) }
  if (!usesStyle) return program
  const key = JSON.stringify(style ?? DEFAULT_STYLE_TOKENS)
  const cached = boundPrograms.get(program)
  if (cached?.key === key) return cached.program
  const tokens = validatedCodeStyle(style)
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!value || typeof value !== 'object') return value
    if ('kind' in value && value.kind === 'style') {
      const expression = value as Extract<CodeExpression, { kind: 'style' }>; const token = readCodeStyleToken(tokens, expression.path)
      return Array.isArray(token) ? { kind: 'color', type: 'color', values: token.map(channel => ({ kind: 'literal', type: 'number', value: channel })) } : { kind: 'literal', type: expression.type, value: token }
    }
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, visit(member)]))
  }
  const bound = visit(program) as CodeMaterialProgram
  stylePrograms.set(bound, false); boundPrograms.set(program, { key, program: bound })
  return bound
}
