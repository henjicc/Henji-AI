import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import {
  applicationRefSchema,
  type ApplicationRef,
} from '../../../../../src/core/application-control'
import type { HostContextSnapshot, HostScope } from '../../../../../src/core/assistant/hostContracts'
import type { HenjiScriptCheckpoint } from '../../../../../src/core/assistant/externalWait'
import type { AgentToolDefinition } from '../../agent-runtime/tools/types'
import {
  HenjiScriptError,
  type HenjiCallInstruction,
  type HenjiInstruction,
  type HenjiValueExpression,
} from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 取不到时必须说清**实际有什么**，否则模型只能再猜一遍。
 *
 * 旧文案只有「结果字段 projectId 不存在」。模型不知道该改成什么，于是重写整段脚本再试；
 * 实测 camera 场景因此把 run_henji_script 的 5 次调用额度耗光，最终 0 个 Effect。
 * 这和 artifact 字段筛选、zod 校验消息是同一类问题：报了失败，没给能自纠的事实。
 */
function describeAvailable(current: unknown): string {
  if (Array.isArray(current)) {
    return `。当前是长度 ${current.length} 的数组：可以读 .length，或用非负整数下标取某一项`
  }
  if (isRecord(current)) {
    const keys = Object.keys(current).slice(0, 24)
    return keys.length > 0 ? `。可用字段：${keys.join('、')}` : '。当前对象没有任何字段'
  }
  return `。当前值是 ${current === null ? 'null' : typeof current}，不能继续取字段`
}

function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current) || part >= current.length) {
        throw new HenjiScriptError(
          'SCRIPT_STEP_FAILED', 'execute',
          `数组下标 ${part} 不存在${describeAvailable(current)}`
        )
      }
      current = current[part]
    } else {
      /*
       * 数组的 length 必须读得到。
       *
       * 这是数组唯一一个既安全、又几乎必然要用的属性：模型拿到 refs 之后要判断"有没有"、
       * "有几个"，除了 length 没有别的办法（受限语言不支持 .find/.filter，for...of 也只遍历
       * 静态数组）。旧实现把它一并拒了，错误信息还写着"当前是长度 8 的数组"——运行时明明
       * 知道答案，却因为它不是 hasOwnProperty 意义上的字段而不肯说。实测同一段脚本因此连撞
       * 三次，每次都只能整段重写。
       */
      if (Array.isArray(current) && part === 'length') {
        current = current.length
        continue
      }
      if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
        throw new HenjiScriptError(
          'SCRIPT_STEP_FAILED', 'execute',
          `结果字段 ${part} 不存在${describeAvailable(current)}`
        )
      }
      current = current[part]
    }
  }
  return current
}

function numeric(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', `${name} 需要有限数字`)
  }
  return value
}

export function evaluate(expression: HenjiValueExpression, values: ReadonlyMap<string, unknown>): unknown {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'array') return expression.items.map((item) => evaluate(item, values))
  if (expression.kind === 'object') {
    return Object.fromEntries(expression.entries.map(({ key, value }) => [key, evaluate(value, values)]))
  }
  if (expression.kind === 'variable') {
    if (!values.has(expression.name)) {
      const available = [...values.keys()].slice(0, 24)
      throw new HenjiScriptError(
        'SCRIPT_STEP_FAILED', 'execute',
        `前序结果 ${expression.name} 不存在`
        + (available.length > 0 ? `。已有前序结果：${available.join('、')}` : '。当前还没有任何前序结果')
      )
    }
    return readPath(values.get(expression.name), expression.path)
  }
  if (expression.kind === 'template') {
    return expression.parts.map((part) => typeof part === 'string' ? part : String(evaluate(part, values))).join('')
  }
  if (expression.kind === 'binary') {
    const left = evaluate(expression.left, values)
    if (expression.operator === '&&') return Boolean(left) && evaluate(expression.right, values)
    if (expression.operator === '||') return Boolean(left) || evaluate(expression.right, values)
    const right = evaluate(expression.right, values)
    switch (expression.operator) {
      case '+': return typeof left === 'string' || typeof right === 'string'
        ? String(left) + String(right) : numeric(left, '左操作数') + numeric(right, '右操作数')
      case '-': return numeric(left, '左操作数') - numeric(right, '右操作数')
      case '*': return numeric(left, '左操作数') * numeric(right, '右操作数')
      case '/': return numeric(left, '左操作数') / numeric(right, '右操作数')
      case '%': return numeric(left, '左操作数') % numeric(right, '右操作数')
      case '<': return numeric(left, '左操作数') < numeric(right, '右操作数')
      case '<=': return numeric(left, '左操作数') <= numeric(right, '右操作数')
      case '>': return numeric(left, '左操作数') > numeric(right, '右操作数')
      case '>=': return numeric(left, '左操作数') >= numeric(right, '右操作数')
      case '===': return isDeepStrictEqual(left, right)
      case '!==': return !isDeepStrictEqual(left, right)
      case '==': return String(left) === String(right)
      case '!=': return String(left) !== String(right)
      default: throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', `未知运算符 ${expression.operator}`)
    }
  }
  if (expression.kind === 'conditional') {
    return Boolean(evaluate(expression.condition, values))
      ? evaluate(expression.whenTrue, values)
      : evaluate(expression.whenFalse, values)
  }
  const args = expression.args.map((arg) => evaluate(arg, values))
  switch (expression.name) {
    case 'range': {
      const start = args.length > 1 ? numeric(args[0], 'range start') : 0
      const end = numeric(args.length > 1 ? args[1] : args[0], 'range end')
      const step = args.length > 2 ? numeric(args[2], 'range step') : 1
      const result: number[] = []
      for (let value = start; (step > 0 ? value < end : value > end) && result.length < 64; value += step) result.push(value)
      return result
    }
    case 'take': return Array.isArray(args[0]) ? args[0].slice(0, numeric(args[1], 'take count')) : []
    case 'lerp': return numeric(args[0], 'lerp a') + (numeric(args[1], 'lerp b') - numeric(args[0], 'lerp a')) * numeric(args[2], 'lerp t')
    case 'clamp': return Math.min(numeric(args[2], 'clamp max'), Math.max(numeric(args[1], 'clamp min'), numeric(args[0], 'clamp value')))
    case 'sin': return Math.sin(numeric(args[0], 'sin value'))
    case 'cos': return Math.cos(numeric(args[0], 'cos value'))
    case 'tan': return Math.tan(numeric(args[0], 'tan value'))
  }
}

export function collectRefs(value: unknown, result: Map<string, ApplicationRef>, depth = 0): void {
  if (depth > 7) return
  const parsed = applicationRefSchema.safeParse(value)
  if (parsed.success) {
    result.set(`${parsed.data.kind}\u0000${parsed.data.id}`, parsed.data)
    return
  }
  if (Array.isArray(value)) value.slice(0, 256).forEach((item) => collectRefs(item, result, depth + 1))
  else if (isRecord(value)) Object.values(value).slice(0, 256).forEach((item) => collectRefs(item, result, depth + 1))
}

export function fullRef(value: unknown, location: HenjiCallInstruction['location']): ApplicationRef {
  const parsed = applicationRefSchema.safeParse(value)
  if (!parsed.success) throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', '需要完整稳定引用', location)
  if (/\.{3}|…/.test(parsed.data.id)) {
    throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', '稳定引用不得截断', location)
  }
  return parsed.data
}

export function requiredScopes(definition: AgentToolDefinition, input: unknown): HostScope[] {
  return definition.resolveRequiredContext?.(input) ?? definition.requiredContext
}

export function revisions(context: HostContextSnapshot | null, scopes: readonly HostScope[]): Partial<Record<HostScope, number>> {
  if (!context) return {}
  return Object.fromEntries(scopes.flatMap((scope) => {
    const value = context.scopeRevisions[scope]
    return value === undefined ? [] : [[scope, value]]
  }))
}

export function literalString(expression: HenjiValueExpression | undefined): string | null {
  return expression?.kind === 'literal' && typeof expression.value === 'string' ? expression.value : null
}

export function nestedInstructions(instructions: readonly HenjiInstruction[]): HenjiInstruction[] {
  return instructions.flatMap((instruction) => instruction.kind === 'branch'
    ? [instruction, ...nestedInstructions(instruction.whenTrue), ...nestedInstructions(instruction.whenFalse)]
    : [instruction])
}

export function expressionObjectEntry(expression: HenjiValueExpression | undefined, key: string): HenjiValueExpression | undefined {
  return expression?.kind === 'object' ? expression.entries.find((entry) => entry.key === key)?.value : undefined
}

export function literalRefKind(expression: HenjiValueExpression | undefined): string | null {
  return literalString(expressionObjectEntry(expression, 'kind'))
}

export function propertyKeys(expression: HenjiValueExpression | undefined): string[] {
  return expression?.kind === 'object' ? expression.entries.map((entry) => entry.key) : []
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('摘要输入包含不可序列化值')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${entries.join(',')}}`
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function serializable(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('脚本断点值嵌套过深')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.slice(0, 512).map((item) => serializable(item, depth + 1))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 512).flatMap(([key, item]) => (
      item === undefined ? [] : [[key, serializable(item, depth + 1)]]
    )))
  }
  throw new Error('脚本断点只允许保存稳定引用和有限 JSON 值')
}

export function checkpointDigest(input: Omit<HenjiScriptCheckpoint, 'continuationDigest'>): string {
  return digest(input)
}

