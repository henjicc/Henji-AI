import type { ApplicationRef, JsonValue } from '../identifiers'
import type { ApplicationPropertyDescriptor } from '../reflection'

/**
 * 列表筛选与排序的比较规则。
 *
 * 等值之外只补四类：多值“或”（in）、包含（contains）、区间（gt/gte/lt/lte）、时间段重叠（overlap）。
 * 这是素材按标签与集合找、批注按多个状态找、片段按时间段找这些真实用法的并集；不做表达式语言，
 * 条件之间一律是“且”，要“或”就在同一个属性上用 in。
 */
export const WHERE_OPERATORS = ['eq', 'ne', 'in', 'contains', 'gt', 'gte', 'lt', 'lte'] as const
export type WhereOperator = typeof WHERE_OPERATORS[number]

const RANGE: readonly WhereOperator[] = ['gt', 'gte', 'lt', 'lte']
const EQUALITY: readonly WhereOperator[] = ['eq', 'ne', 'in']

/** 属性取值种类静态决定的比较方式；点分路径取出的字段与 schema 没写明类型的 json 属性到运行时才知道形状，全部放行。 */
const OPERATORS_BY_KIND: Record<ApplicationPropertyDescriptor['value']['kind'], readonly WhereOperator[]> = {
  boolean: EQUALITY,
  string: [...EQUALITY, 'contains', ...RANGE],
  enum: EQUALITY,
  color: EQUALITY,
  number: [...EQUALITY, ...RANGE],
  integer: [...EQUALITY, ...RANGE],
  ref: EQUALITY,
  ref_list: ['contains'],
  vector2: ['eq', 'ne'],
  vector3: ['eq', 'ne'],
  json: WHERE_OPERATORS,
}

export interface ResolvedPropertyKey {
  /** 调用方写的键，报错时原样回显。 */
  key: string
  property: ApplicationPropertyDescriptor
  path: string[]
  /** json 属性的值 schema 顶层写明的类型（number、string、object…）；没写明或是联合类型时不给。 */
  jsonType?: string
}

type ValueShape = 'number' | 'string' | 'boolean' | 'array' | 'structured'

/** 能静态确定的取值形状；点分路径里的字段、没写明类型的 json 属性返回 undefined，留到比较时再看实际值。 */
function valueShape(resolved: ResolvedPropertyKey): ValueShape | undefined {
  if (resolved.path.length) return undefined
  const kind = resolved.property.value.kind
  if (kind === 'json') {
    const type = resolved.jsonType
    return type === 'number' || type === 'integer' ? 'number' : type === 'string' ? 'string' : type === 'boolean' ? 'boolean'
      : type === 'array' ? 'array' : type === 'object' ? 'structured' : undefined
  }
  return kind === 'number' || kind === 'integer' ? 'number' : kind === 'boolean' ? 'boolean'
    : kind === 'ref_list' ? 'array' : kind === 'ref' || kind === 'vector2' || kind === 'vector3' ? 'structured' : 'string'
}

const OPERATORS_BY_JSON_SHAPE: Record<ValueShape, readonly WhereOperator[]> = {
  number: ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte'],
  string: WHERE_OPERATORS,
  boolean: ['eq', 'ne', 'in'],
  array: ['eq', 'ne', 'contains'],
  structured: ['eq', 'ne', 'in'],
}

export interface ListCondition {
  propertyIds: string[]
  matches(properties: Record<string, JsonValue>): boolean
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRef(value: unknown): value is ApplicationRef {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.id === 'string'
}

/** 引用只比 kind 与 id：读回的引用常带 label 或 revision，调用方照抄或只写两项都应命中。 */
function sameValue(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (isRef(left) && isRef(right)) return left.kind === right.kind && left.id === right.id
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

export function valueAtPath(value: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = Array.isArray(current) ? current[Number(segment)] : current[segment]
  }
  return current
}

function compare(left: JsonValue | undefined, right: JsonValue): number | null {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0
  return null
}

function test(operator: WhereOperator, value: JsonValue | undefined, operand: JsonValue): boolean {
  switch (operator) {
    case 'eq': return sameValue(value, operand)
    case 'ne': return !sameValue(value, operand)
    case 'in': return (operand as JsonValue[]).some(item => sameValue(value, item))
    case 'contains':
      if (Array.isArray(value)) return value.some(item => sameValue(item, operand))
      return typeof value === 'string' && typeof operand === 'string' && value.includes(operand)
    default: {
      const order = compare(value, operand)
      if (order === null) return false
      return operator === 'gt' ? order > 0 : operator === 'gte' ? order >= 0 : operator === 'lt' ? order < 0 : order <= 0
    }
  }
}

function supported(resolved: ResolvedPropertyKey): readonly WhereOperator[] {
  if (resolved.path.length) return WHERE_OPERATORS
  if (resolved.property.value.kind !== 'json') return OPERATORS_BY_KIND[resolved.property.value.kind]
  const shape = valueShape(resolved)
  return shape ? OPERATORS_BY_JSON_SHAPE[shape] : WHERE_OPERATORS
}

/**
 * 把一条 where 条件编译成判定函数。标量、数组与引用值是等值；其余对象值的键是比较方式，同一属性上的多个
 * 比较方式是“且”（{"gte":2,"lt":5}）。写错在这里拒绝并点名该属性支持哪些，不留到逐条比对时静默筛成空列表。
 */
export function compileWhereCondition(resolved: ResolvedPropertyKey, raw: JsonValue): ListCondition {
  const { key, property, path } = resolved
  const allowed = supported(resolved)
  const kind = path.length ? `${property.value.kind} 属性里的字段` : `${property.value.kind} 属性`
  const describe = `${key} 是${kind}，支持的比较方式：${allowed.join('、')}`
  const entries: Array<[WhereOperator, JsonValue]> = isRecord(raw) && !isRef(raw)
    ? Object.entries(raw).map(([operator, operand]) => {
        if (!WHERE_OPERATORS.includes(operator as WhereOperator)) {
          throw new Error(`INVALID_WHERE:${describe}（收到 ${operator}）。对象值的键是比较方式；要整体比较一个对象请写 {"eq": 对象}。`)
        }
        return [operator as WhereOperator, operand]
      })
    : [['eq', raw]]
  if (!entries.length) throw new Error(`INVALID_WHERE:${describe}；条件不能是空对象。`)
  for (const [operator, operand] of entries) {
    if (!allowed.includes(operator)) throw new Error(`INVALID_WHERE:${describe}（收到 ${operator}）。`)
    if (operator === 'in' && !Array.isArray(operand)) throw new Error(`INVALID_WHERE:${key} 的 in 要给数组，命中其中任意一个即保留。`)
    if (RANGE.includes(operator)) {
      if (typeof operand !== 'number' && typeof operand !== 'string') throw new Error(`INVALID_WHERE:${key} 的 ${operator} 要给数值或字符串（时间按 ISO 字符串比较）。`)
      // 数值与字符串互不比较：类型不对的区间条件一条也命中不了，在这里说清而不是返回空列表
      const shape = valueShape(resolved)
      if (shape === 'number' && typeof operand !== 'number') throw new Error(`INVALID_WHERE:${key} 是数值属性，${operator} 要给数值（收到字符串 ${JSON.stringify(operand)}，去掉引号）。`)
      if (shape === 'string' && typeof operand !== 'string') throw new Error(`INVALID_WHERE:${key} 是字符串属性，${operator} 要给字符串（收到数值 ${operand}）。`)
    }
  }
  return {
    propertyIds: [property.id],
    matches: properties => {
      const value = valueAtPath(properties[property.id], path)
      return entries.every(([operator, operand]) => test(operator, value, operand))
    },
  }
}

export interface OverlapQuery { start: ResolvedPropertyKey; end?: ResolvedPropertyKey; duration?: ResolvedPropertyKey; from: number; to: number }

/**
 * 时间段重叠：实体占 [start, end) 或 [start, start+duration)，与 [from, to) 有交集即命中；
 * 只给 start，或某个实体没有结束值（只标在一个时刻上的批注、标记）时按时间点算（from ≤ start < to）。
 * 单位就是这些属性自己的单位。
 */
export function compileOverlapCondition(query: OverlapQuery): ListCondition {
  const numeric = (resolved: ResolvedPropertyKey | undefined, role: string): void => {
    if (!resolved || resolved.path.length) return
    const kind = resolved.property.value.kind
    if (kind !== 'number' && kind !== 'integer' && kind !== 'json') {
      throw new Error(`INVALID_OVERLAP:overlap.${role} 要指向数值属性，${resolved.key} 是 ${kind} 属性。`)
    }
  }
  numeric(query.start, 'start'); numeric(query.end, 'end'); numeric(query.duration, 'duration')
  if (query.end && query.duration) throw new Error('INVALID_OVERLAP:overlap 的 end 与 duration 只写一个。')
  if (!(query.from < query.to)) throw new Error('INVALID_OVERLAP:overlap.from 必须小于 overlap.to。')
  const read = (properties: Record<string, JsonValue>, resolved: ResolvedPropertyKey): number | null => {
    const value = valueAtPath(properties[resolved.property.id], resolved.path)
    return typeof value === 'number' ? value : null
  }
  return {
    propertyIds: [query.start, query.end, query.duration].flatMap(item => item ? [item.property.id] : []),
    matches: properties => {
      const start = read(properties, query.start)
      if (start === null) return false
      const span = query.end ? read(properties, query.end) : query.duration ? read(properties, query.duration) : null
      const end = span === null ? start : query.end ? span : start + span
      return end > start ? start < query.to && end > query.from : start >= query.from && start < query.to
    },
  }
}

export interface OrderKey extends ResolvedPropertyKey { direction: 'asc' | 'desc' }

/** 排序只认数值、字符串与布尔：引用、向量、对象、数组没有先后，照排会原样返回而不报错，所以在读取前拒绝并说明改法。 */
export function assertOrderable(resolved: ResolvedPropertyKey): void {
  const shape = valueShape(resolved)
  if (shape !== 'structured' && shape !== 'array') return
  const kind = resolved.property.value.kind
  const hint = kind === 'ref' ? `可写 ${resolved.key}.id 按引用的 id 排`
    : kind === 'vector2' || kind === 'vector3' ? `可写 ${resolved.key}.x 这样按其中一个分量排`
      : '可在属性后接点分路径，按其中一个数值或字符串字段排'
  throw new Error(`INVALID_ORDER:${resolved.key} 是${shape === 'array' ? '数组' : '对象'}值，不能直接排序；${hint}。`)
}

/** 数值按大小、字符串按字典序、布尔 false 在前；取不到值的一律排在最后，与升降序无关。 */
export function compareByOrder(order: readonly OrderKey[]): (left: Record<string, JsonValue>, right: Record<string, JsonValue>) => number {
  const rank = (value: JsonValue | undefined): JsonValue | undefined => typeof value === 'boolean' ? Number(value) : value
  return (left, right) => {
    for (const key of order) {
      const a = rank(valueAtPath(left[key.property.id], key.path))
      const b = rank(valueAtPath(right[key.property.id], key.path))
      const missingA = a === undefined || a === null, missingB = b === undefined || b === null
      if (missingA || missingB) { if (missingA !== missingB) return missingA ? 1 : -1; continue }
      const result = compare(a, b as JsonValue)
      if (result) return key.direction === 'desc' ? -result : result
    }
    return 0
  }
}
