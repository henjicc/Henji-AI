import { describe, expect, it } from 'vitest'

import { normalizeProviderToolSchema } from './tool-schema'

/*
 * 回归：每个工具都硬写 strict: true，而 schema 里到处是可选属性和 min/max 约束。
 *
 * DeepSeek 文档明确 strict 模式要求每个 object 都 additionalProperties:false 且全部属性必填，
 * 且不支持 minLength/maxLength/minItems/maxItems。三条我们全违反——这类不一致不会在本地报错，
 * 只会在供应商侧变成一次难以归因的请求失败或参数被静默忽略。
 */
describe('工具 schema 供应商规范化', () => {
  const strictReady = {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1 }, tags: { type: 'array', maxItems: 4 } },
    required: ['id', 'tags'],
    additionalProperties: false,
  }

  it('满足 strict 子集时声明 strict，并剔除不被支持的关键字', () => {
    const result = normalizeProviderToolSchema(strictReady, true)
    expect(result.strict).toBe(true)
    const serialized = JSON.stringify(result.schema)
    expect(serialized).not.toContain('minLength')
    expect(serialized).not.toContain('maxItems')
    // 语义字段必须原样保留。
    expect(serialized).toContain('"required":["id","tags"]')
    expect(serialized).toContain('"additionalProperties":false')
  })

  it('存在可选属性时降级为非 strict，且不篡改 schema', () => {
    const withOptional = {
      type: 'object',
      properties: { id: { type: 'string' }, note: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    }
    const result = normalizeProviderToolSchema(withOptional, true)
    expect(result.strict).toBe(false)
    // 降级后不做任何改写：min/max 之类的提示留给模型参考。
    expect(result.schema).toBe(withOptional)
  })

  it('缺少 additionalProperties:false 时降级，嵌套对象同样参与判定', () => {
    expect(normalizeProviderToolSchema({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    }, true).strict).toBe(false)

    expect(normalizeProviderToolSchema({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
      },
      required: ['nested'],
      additionalProperties: false,
    }, true).strict).toBe(false)
  })

  it('调用方没有要求 strict 时原样透传', () => {
    const result = normalizeProviderToolSchema(strictReady, undefined)
    expect(result.strict).toBe(false)
    expect(result.schema).toBe(strictReady)
  })
})
