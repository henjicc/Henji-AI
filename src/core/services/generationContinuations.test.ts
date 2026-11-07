import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { GENERATION_CONTINUATIONS_KEY, listGenerationContinuations, prepareGenerationContinuation, withStoredContinuations } from './generationContinuations'

function model(id: string, type: 'image' | 'video', continuations?: ModelDefinition['continuations']): ModelDefinition {
  return {
    meta: { id, canonicalModelId: 'image-apps-v2-relighting', provider: 'fal', type, name: { zh: id, en: id }, tags: [] },
    params: [], linkages: [], endpoints: '/x', request: { builder: params => params },
    pricing: { currency: '$', calculator: () => 0 },
    ...(continuations ? { continuations } : {}),
  } as ModelDefinition
}

describe('生成结果续接', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(model('image-src', 'image', [{
      id: 'animate', targetModelId: 'video-target', submit: 'edit',
      capture: ({ taskId }) => taskId ? { taskId } : null,
      params: source => ({ prompt: source.prompt }),
    }]))
    registry.register(model('video-target', 'video'))
  })
  afterEach(() => registry.clear())

  it('只列出保存了引用、且目标模型可用的续接', () => {
    const options = withStoredContinuations({ prompt: 'p' }, { animate: { taskId: 't1' } })
    expect(listGenerationContinuations('image-src', options)).toEqual([{ id: 'animate', targetModelId: 'video-target', submit: 'edit' }])
    expect(listGenerationContinuations('image-src', { prompt: 'p' })).toEqual([])
    registry.clear()
    registry.register(model('image-src', 'image', [{ id: 'animate', targetModelId: 'video-target', submit: 'edit', capture: () => null, params: s => s }]))
    expect(listGenerationContinuations('image-src', options)).toEqual([])
  })

  it('保存结果时按这一次重写引用：再次生成或编辑后没有可续接的动作，就不留上一次的引用', () => {
    const previous = withStoredContinuations({ prompt: 'p' }, { animate: { taskId: 'old' } })
    expect(withStoredContinuations(previous, undefined)).toEqual({ prompt: 'p' })
    expect(withStoredContinuations(previous, { animate: { taskId: 'new' } })[GENERATION_CONTINUATIONS_KEY]).toEqual({ animate: { taskId: 'new' } })
  })

  it('列出时按源参数重新核对能否续接', () => {
    registry.register(model('draft-src', 'video', [{
      id: 'finalize-draft', submit: 'direct', available: params => params.draft === true,
      capture: ({ taskId }) => taskId ? { taskId } : null, params: source => ({ ...source, draft: false }),
    }]))
    const reference = { 'finalize-draft': { taskId: 't1' } }
    expect(listGenerationContinuations('draft-src', withStoredContinuations({ draft: true }, reference))).toHaveLength(1)
    expect(listGenerationContinuations('draft-src', withStoredContinuations({ draft: false }, reference))).toEqual([])
  })

  it('续接参数换到目标模型、带上引用，不把源结果的派生值带过去', () => {
    const options = withStoredContinuations({ prompt: 'p', __videoDurationSeconds: [3] }, { animate: { taskId: 't1' } })
    const prepared = prepareGenerationContinuation('image-src', options, 'animate')
    expect(prepared).toMatchObject({ targetModelId: 'video-target', submit: 'edit' })
    expect(prepared?.params).toEqual({ prompt: 'p', __continuation: { id: 'animate', sourceModelId: 'image-src', reference: { taskId: 't1' } } })
    expect(prepared?.params).not.toHaveProperty(GENERATION_CONTINUATIONS_KEY)
    expect(prepareGenerationContinuation('image-src', options, 'extend')).toBeNull()
  })
})
