import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from 'vitest'

import type { JsonObject } from '../../src/types/runtime'

interface PropertySchema { enum?: unknown[]; anyOf?: PropertySchema[]; type?: string; minimum?: number; maximum?: number }
interface InputSchema { required?: string[]; properties: Record<string, PropertySchema> }

function load(endpoint: string): InputSchema {
  const file = resolve(__dirname, `../fixtures/fal-openapi/${endpoint.replace(/\//g, '__')}.json`)
  return (JSON.parse(readFileSync(file, 'utf8')) as { input: InputSchema }).input
}

function allowedValues(schema: PropertySchema): unknown[] | null {
  if (schema.enum) return schema.enum
  // 只要有一个分支不是枚举（如对象尺寸、null），就不按枚举校验。
  if (!schema.anyOf || schema.anyOf.some((branch) => !branch.enum)) return null
  return schema.anyOf.flatMap((branch) => branch.enum ?? [])
}

/** 按 Fal 官方 OpenAPI 快照核对请求体：必填齐全、字段都在官方列表里、枚举与数值范围合法。 */
export function expectFalOfficialBody(endpoint: string, body: JsonObject): void {
  const schema = load(endpoint)
  for (const field of schema.required ?? []) expect(body, `${endpoint} 缺少 ${field}`).toHaveProperty(field)
  for (const [field, value] of Object.entries(body)) {
    const property = schema.properties[field]
    expect(property, `${endpoint} 没有字段 ${field}`).toBeDefined()
    const allowed = allowedValues(property)
    if (allowed) expect(allowed, `${endpoint}.${field}`).toContain(value)
    if (typeof property.minimum === 'number') expect(value as number).toBeGreaterThanOrEqual(property.minimum)
    if (typeof property.maximum === 'number') expect(value as number).toBeLessThanOrEqual(property.maximum)
  }
}
