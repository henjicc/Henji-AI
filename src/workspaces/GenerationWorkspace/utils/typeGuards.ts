export function isRecord(value: DynamicValue): value is DynamicValueMap {
  return typeof value === 'object' && value !== null
}

export function isStringArray(value: DynamicValue): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

