import type { JsonValue } from '../identifiers'
import type { ApplicationPropertyDescriptor, ApplicationPropertyValue } from '../reflection'

function invalid(propertyId: string, reason: string): never {
  throw new Error(`INVALID_PROPERTY_VALUE:${propertyId}:${reason}`)
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
        return invalid(descriptor.id, 'EXPECTED_REF')
      }
      const kind = input.kind
      const id = input.id
      if (typeof kind !== 'string' || !valueType.refKinds.includes(kind) || typeof id !== 'string') {
        return invalid(descriptor.id, 'INVALID_REF')
      }
      return input
    }
    case 'ref_list': {
      if (!Array.isArray(input)) return invalid(descriptor.id, 'EXPECTED_REF_LIST')
      if (valueType.maxItems !== undefined && input.length > valueType.maxItems) {
        return invalid(descriptor.id, 'TOO_MANY_REFS')
      }
      for (const item of input) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return invalid(descriptor.id, 'INVALID_REF')
        }
        if (typeof item.kind !== 'string' || !valueType.refKinds.includes(item.kind) || typeof item.id !== 'string') {
          return invalid(descriptor.id, 'INVALID_REF')
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
