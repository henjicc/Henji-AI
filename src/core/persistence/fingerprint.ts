import { z } from 'zod'

/** Sort object keys and set-like JSON Schema arrays, preserving tuple/union order. */
export function canonicalPersistenceJson(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const entries = value.map(item => canonicalPersistenceJson(item))
    return key === 'required' || key === 'enum' ? entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')) : entries
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, item]) => [name, canonicalPersistenceJson(item, name)]))
  return value
}

/** Both accepted input and normalized output matter (defaults, stripping, requiredness). */
export function persistenceSchemaStructure(schemas: Readonly<Record<string, z.ZodType>>): string {
  return JSON.stringify(canonicalPersistenceJson(Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, {
    input: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw', reused: 'inline' }),
    output: z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw', reused: 'inline' }),
  }]))))
}
