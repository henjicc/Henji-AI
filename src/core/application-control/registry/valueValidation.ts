import type { JsonValue } from '../identifiers'
import type { ApplicationPropertyDescriptor, ApplicationPropertyValue } from '../reflection'

/**
 * `hint` 不是可选的装饰，是这条错误有没有用的分界线。
 *
 * 实测「让球上下浮动」那次，模型连撞七次通用写入：一次 `INVALID_REF`、一次
 * `PROPERTY_NOT_FOUND`、两次 NOT_FOUND，每条都只有一个错误码。它只能靠**猜**下一次换什么
 * 格式——猜引用要不要带工程前缀、猜位置属性有没有 y 分量、猜 ref_list 收的是字符串还是对象。
 * 七次全花在拼格式上，一次都没花在用户的需求上。
 *
 * 校验器手里明明有 refKinds、有 value 的形状、有实际收到的东西，不说就是浪费。
 */
function invalid(propertyId: string, reason: string, hint?: string): never {
  throw new Error(`INVALID_PROPERTY_VALUE:${propertyId}:${reason}${hint ? `（${hint}）` : ''}`)
}

/** 把模型实际传进来的东西压成一句能读的话，别把整个对象糊进错误里。 */
function describeReceived(input: unknown): string {
  if (input === null) return 'null'
  if (Array.isArray(input)) return `数组（${input.length} 项）`
  if (typeof input === 'object') return `对象 {${Object.keys(input as object).slice(0, 6).join(', ')}}`
  if (typeof input === 'string') return `字符串 "${input.slice(0, 60)}"`
  return String(input)
}

/** ref / ref_list 的正确形状说明，带一个能照抄的样例。 */
function refShapeHint(refKinds: readonly string[], received: unknown): string {
  const kind = refKinds[0] ?? 'entity.type'
  return `引用必须是对象 {"kind":"<实体类型>","id":"<稳定 id>"}，不是字符串；`
    + `kind 只能取 ${refKinds.join(' / ')}；`
    + `id 用 list_application_entities 或观察结果里返回的原值（通常带父级前缀，如 "<工程 id>:<对象 id>"）。`
    + `例：{"kind":"${kind}","id":"…"}。实际收到：${describeReceived(received)}`
}

function validateNumberRange(
  propertyId: string,
  value: number,
  range: { min?: number; max?: number; step?: number } | undefined
): number {
  if (range?.min !== undefined && value < range.min) invalid(propertyId, 'BELOW_MINIMUM')
  if (range?.max !== undefined && value > range.max) invalid(propertyId, 'ABOVE_MAXIMUM')
  if (range?.step !== undefined) {
    const origin = range.min ?? 0
    const distance = Math.abs((value - origin) / range.step)
    if (Math.abs(distance - Math.round(distance)) > 1e-9) invalid(propertyId, 'INVALID_STEP')
  }
  return value
}

function validateVector(
  propertyId: string,
  value: JsonValue,
  dimensions: 2 | 3,
  range: { min?: number; max?: number; step?: number } | undefined
): JsonValue {
  const keys = dimensions === 2 ? ['x', 'y'] : ['x', 'y', 'z']
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(propertyId, 'EXPECTED_VECTOR')
  }
  const entries = Object.entries(value)
  if (entries.length !== keys.length || entries.some(([key]) => !keys.includes(key))) {
    return invalid(propertyId, 'INVALID_VECTOR_COMPONENTS')
  }
  return Object.fromEntries(keys.map((key) => {
    const component = value[key]
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      return invalid(propertyId, 'INVALID_VECTOR_COMPONENT')
    }
    return [key, validateNumberRange(propertyId, component, range)]
  }))
}

function normalizeNonNullValue(
  descriptor: ApplicationPropertyDescriptor,
  valueType: ApplicationPropertyValue,
  input: JsonValue
): JsonValue {
  switch (valueType.kind) {
    case 'boolean':
      if (typeof input !== 'boolean') return invalid(descriptor.id, 'EXPECTED_BOOLEAN')
      return input
    case 'string': {
      if (typeof input !== 'string') return invalid(descriptor.id, 'EXPECTED_STRING')
      const value = input.normalize('NFKC')
      if (valueType.minLength !== undefined && value.length < valueType.minLength) {
        return invalid(descriptor.id, 'STRING_TOO_SHORT')
      }
      if (valueType.maxLength !== undefined && value.length > valueType.maxLength) {
        return invalid(descriptor.id, 'STRING_TOO_LONG')
      }
      return value
    }
    case 'number':
    case 'integer': {
      if (typeof input !== 'number' || !Number.isFinite(input)) {
        return invalid(descriptor.id, 'EXPECTED_NUMBER')
      }
      if (valueType.kind === 'integer' && !Number.isInteger(input)) {
        return invalid(descriptor.id, 'EXPECTED_INTEGER')
      }
      return validateNumberRange(descriptor.id, input, valueType.hardRange)
    }
    case 'enum':
      if (typeof input !== 'string' || !valueType.values.some((item) => item.value === input)) {
        return invalid(descriptor.id, 'UNKNOWN_ENUM_VALUE')
      }
      return input
    case 'color':
      if (typeof input !== 'string') return invalid(descriptor.id, 'EXPECTED_COLOR')
      if (valueType.format === 'hex' && !/^#[0-9A-Fa-f]{6}$/.test(input)) {
        return invalid(descriptor.id, 'INVALID_HEX_COLOR')
      }
      if (valueType.format === 'rgba' && !/^rgba\(\s*(?:\d{1,3}\s*,\s*){3}(?:0|1|0?\.\d+)\s*\)$/.test(input)) {
        return invalid(descriptor.id, 'INVALID_RGBA_COLOR')
      }
      return input
    case 'vector2':
      return validateVector(descriptor.id, input, 2, valueType.componentRange)
    case 'vector3':
      return validateVector(descriptor.id, input, 3, valueType.componentRange)
    case 'ref': {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return invalid(descriptor.id, 'EXPECTED_REF', refShapeHint(valueType.refKinds, input))
      }
      const kind = input.kind
      const id = input.id
      if (typeof kind !== 'string' || !valueType.refKinds.includes(kind) || typeof id !== 'string') {
        return invalid(descriptor.id, 'INVALID_REF', refShapeHint(valueType.refKinds, input))
      }
      return input
    }
    case 'ref_list': {
      if (!Array.isArray(input)) {
        return invalid(
          descriptor.id,
          'EXPECTED_REF_LIST',
          `这是引用列表，要传数组。${refShapeHint(valueType.refKinds, input)}`,
        )
      }
      if (valueType.maxItems !== undefined && input.length > valueType.maxItems) {
        return invalid(
          descriptor.id,
          'TOO_MANY_REFS',
          `最多 ${valueType.maxItems} 项，本次 ${input.length} 项`,
        )
      }
      for (const [index, item] of input.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return invalid(descriptor.id, 'INVALID_REF', `第 ${index} 项：${refShapeHint(valueType.refKinds, item)}`)
        }
        if (typeof item.kind !== 'string' || !valueType.refKinds.includes(item.kind) || typeof item.id !== 'string') {
          return invalid(descriptor.id, 'INVALID_REF', `第 ${index} 项：${refShapeHint(valueType.refKinds, item)}`)
        }
      }
      return input
    }
    case 'json':
      return input
  }
}

export function normalizeApplicationPropertyValue(
  descriptor: ApplicationPropertyDescriptor,
  input: JsonValue
): JsonValue {
  if (input === null) {
    if (!descriptor.nullable) invalid(descriptor.id, 'NULL_NOT_ALLOWED')
    return null
  }
  return normalizeNonNullValue(descriptor, descriptor.value, input)
}
