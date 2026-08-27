import { describe, expect, it } from 'vitest'

import { createModelIndex } from '../src/catalog/model-index'
import type { ModelRuntimeDefinition } from '../src/types/model'

function model(id: string, provider: string, aliases: string[] = []): ModelRuntimeDefinition {
  return {
    meta: {
      id,
      canonicalModelId: id,
      provider,
      type: 'image',
      aliases,
    },
    params: [],
    endpoints: '/generate',
    request: { builder: () => ({}) },
    pricing: { currency: '$', fixed: 0 },
  }
}

describe('createModelIndex', () => {
  it('按真实 ID 与 alias 解析，并保留目录顺序、数量和供应商去重顺序', () => {
    const first = model('first', 'fal', ['legacy-first'])
    const second = model('second', 'kie', ['legacy-second'])
    const index = createModelIndex([first, second])

    expect(index.get('first')).toBe(first)
    expect(index.get('legacy-first')).toBe(first)
    expect(index.get('legacy-second')).toBe(second)
    expect(index.get('missing')).toBeUndefined()
    expect(index.providerIds()).toEqual(['fal', 'kie'])
    expect(index.len()).toBe(2)
    expect(index.list()).toEqual([first, second])
  })

  it('alias 不覆盖已存在的真实 model ID', () => {
    const canonical = model('stable-id', 'fal')
    const conflictingAlias = model('other-id', 'kie', ['stable-id'])
    const index = createModelIndex([canonical, conflictingAlias])

    expect(index.get('stable-id')).toBe(canonical)
  })

  it('后声明的真实 model ID 会取代同名的早期 alias', () => {
    const earlyAlias = model('early', 'fal', ['future-id'])
    const canonical = model('future-id', 'kie')
    const index = createModelIndex([earlyAlias, canonical])

    expect(index.get('future-id')).toBe(canonical)
  })

  it('多个模型声明同一 alias 时保留先声明者', () => {
    const first = model('first', 'fal', ['shared-alias'])
    const second = model('second', 'kie', ['shared-alias'])
    const index = createModelIndex([first, second])

    expect(index.get('shared-alias')).toBe(first)
  })
})
