import { describe, expect, it } from 'vitest'

import { defineModel, ModelRuntimeValidationError, validateRuntimeModel } from '../src/catalog'
import type { ModelRuntimeDefinition } from '../src/types/model'

function baseModel(overrides: Partial<ModelRuntimeDefinition> = {}): ModelRuntimeDefinition {
  return {
    meta: {
      id: 'test-model',
      canonicalModelId: 'test-model',
      provider: 'kie',
      type: 'image',
      tags: ['text-to-image'],
    },
    params: [
      {
        id: 'aspectRatio',
        type: 'dropdown',
        order: 1,
        default: '1:1',
        options: [{ value: '1:1' }, { value: '16:9' }],
      },
      {
        id: 'seed',
        type: 'number',
        order: 2,
        default: -1,
        min: -1,
        max: 999999999,
      },
    ],
    endpoints: '/v1/generate',
    pricing: { currency: '$', fixed: 0.1 },
    ...overrides,
  }
}

describe('SDK defineModel（纯函数）', () => {
  it('校验通过时原样返回运行时定义', () => {
    const model = baseModel()
    const result = defineModel(model)
    expect(result.meta.id).toBe('test-model')
    expect(result.params).toHaveLength(2)
  })

  it('不产生任何副作用：不修改入参对象', () => {
    const model = baseModel()
    const result = defineModel(model)
    expect(result).not.toBe(model)
    expect(result.meta).not.toBe(model.meta)
  })

  it('多次调用同一入参得到等价结果（纯函数）', () => {
    const model = baseModel()
    const first = defineModel(model)
    const second = defineModel(model)
    expect(first).toEqual(second)
  })

  it('允许非空的扩展 meta.type', () => {
    const model = baseModel({
      meta: { ...baseModel().meta, type: 'transcript' },
    })
    expect(defineModel(model).meta.type).toBe('transcript')
  })

  it('meta.type 为空时抛出 ModelRuntimeValidationError', () => {
    const model = baseModel({
      meta: { ...baseModel().meta, type: '' },
    })
    expect(() => defineModel(model)).toThrow(ModelRuntimeValidationError)
  })

  it('dropdown 缺少 options 时校验失败', () => {
    const model = baseModel({
      params: [
        { id: 'mode', type: 'dropdown', order: 1, default: 'a' } as never,
      ],
    })
    expect(() => defineModel(model)).toThrow('options is required')
  })

  it('number 缺少 min/max 时校验失败', () => {
    const model = baseModel({
      params: [{ id: 'count', type: 'number', order: 1, default: 1 } as never],
    })
    expect(() => defineModel(model)).toThrow(/min is required|max is required/)
  })

  it('endpoints 缺失时校验失败', () => {
    const model = baseModel({ endpoints: undefined as never })
    expect(() => defineModel(model)).toThrow('endpoints is required')
  })

  it('pricing 既无 fixed 也无 calculator 时校验失败', () => {
    const model = baseModel({ pricing: { currency: '$' } })
    expect(() => defineModel(model)).toThrow('pricing must have either fixed or calculator')
  })

  it('重复参数 ID 时校验失败', () => {
    const model = baseModel({
      params: [
        { id: 'dup', type: 'number', order: 1, default: 1, min: 0, max: 1 },
        { id: 'dup', type: 'number', order: 2, default: 1, min: 0, max: 1 },
      ],
    })
    expect(() => defineModel(model)).toThrow('Duplicate param ID: dup')
  })
})

describe('validateRuntimeModel：自定义 fail 回调', () => {
  it('允许调用方接管报错方式（应用侧复用同一份规则时会用到）', () => {
    const model = baseModel({ pricing: { currency: '$' } })
    const messages: string[] = []
    expect(() =>
      validateRuntimeModel(model, (message) => {
        messages.push(message)
        throw new Error(message)
      })
    ).toThrow()
    expect(messages).toContain('Model pricing must have either fixed or calculator')
  })
})
