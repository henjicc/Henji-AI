import type { JsonObject } from '../../types/runtime'
import type { RuntimeConditionExpression, RuntimeConditionFunction } from '../../types/model'
import { parseRuntimeCondition, type RuntimeConditionNode } from './parser'

export class RuntimeConditionEvaluationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeConditionEvaluationError'
  }
}

export type CompiledRuntimeCondition = (params: JsonObject, context?: JsonObject) => boolean

const compiledExpressionCache = new Map<string, CompiledRuntimeCondition>()

/**
 * 编译 SDK 条件表达式，不使用 eval/new Function。
 *
 * 语法只覆盖真实 catalog 当前使用的布尔表达式：标识符、`.length`、字符串/数字/布尔值、
 * `!`/`typeof`、比较、`&&`/`||`、括号，以及唯一允许的调用 `Array.isArray(value)`。
 * 其他 token、属性和函数调用会抛出明确错误，不会静默判为 false。
 */
export function compileRuntimeCondition(
  expression: RuntimeConditionExpression
): CompiledRuntimeCondition {
  const cached = compiledExpressionCache.get(expression)
  if (cached) return cached

  const node = parseRuntimeCondition(expression)
  const compiled: CompiledRuntimeCondition = (params, context = {}) => {
    return Boolean(evaluateNode(node, params, context))
  }
  compiledExpressionCache.set(expression, compiled)
  return compiled
}

export function evaluateRuntimeCondition(
  condition: RuntimeConditionExpression | RuntimeConditionFunction | undefined,
  params: JsonObject,
  context: JsonObject = {}
): boolean {
  if (condition === undefined) return true
  if (typeof condition === 'function') {
    try {
      return Boolean(condition(params))
    } catch (error) {
      throw new RuntimeConditionEvaluationError(
        `Runtime condition function failed: ${toErrorMessage(error)}`
      )
    }
  }
  return compileRuntimeCondition(condition)(params, context)
}

function evaluateNode(node: RuntimeConditionNode, params: JsonObject, context: JsonObject): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'reference':
      return resolveReference(node.path, params, context)
    case 'array-is-array':
      return Array.isArray(evaluateNode(node.value, params, context))
    case 'unary': {
      const value = evaluateNode(node.operand, params, context)
      return node.operator === '!' ? !value : typeof value
    }
    case 'binary':
      return evaluateBinary(node, params, context)
  }
}

function evaluateBinary(
  node: Extract<RuntimeConditionNode, { kind: 'binary' }>,
  params: JsonObject,
  context: JsonObject
): boolean {
  if (node.operator === '&&') {
    return Boolean(evaluateNode(node.left, params, context)) &&
      Boolean(evaluateNode(node.right, params, context))
  }
  if (node.operator === '||') {
    return Boolean(evaluateNode(node.left, params, context)) ||
      Boolean(evaluateNode(node.right, params, context))
  }

  const left = evaluateNode(node.left, params, context)
  const right = evaluateNode(node.right, params, context)
  switch (node.operator) {
    case '===': return left === right
    case '!==': return left !== right
    case '>': return compare(left, right, (a, b) => a > b)
    case '<': return compare(left, right, (a, b) => a < b)
    case '>=': return compare(left, right, (a, b) => a >= b)
    case '<=': return compare(left, right, (a, b) => a <= b)
  }
}

function resolveReference(path: string[], params: JsonObject, context: JsonObject): unknown {
  const key = path[0]
  const source = Object.prototype.hasOwnProperty.call(context, key) ? context : params
  const value = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined
  if (path.length === 1) return value
  if (path[1] !== 'length') {
    throw new RuntimeConditionEvaluationError(`Unsupported property ${path.join('.')}`)
  }
  if (typeof value === 'string' || Array.isArray(value)) return value.length
  throw new RuntimeConditionEvaluationError(
    `Property ${path.join('.')} requires an array or string value`
  )
}

function compare(
  left: unknown,
  right: unknown,
  comparator: (left: number | string, right: number | string) => boolean
): boolean {
  if (typeof left === 'number' && typeof right === 'number') return comparator(left, right)
  if (typeof left === 'string' && typeof right === 'string') return comparator(left, right)
  throw new RuntimeConditionEvaluationError('Relational operands must have matching number/string types')
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
