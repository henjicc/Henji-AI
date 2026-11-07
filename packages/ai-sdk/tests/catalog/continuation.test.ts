import { describe, expect, it } from 'vitest'
import { buildContinuationParams, captureContinuations, readContinuation } from '../../src/catalog/continuation'
import type { RuntimeContinuation } from '../../src/types/model'

const finalize: RuntimeContinuation = {
  id: 'finalize-draft',
  available: params => params.draft === true,
  capture: ({ taskId }) => taskId ? { taskId } : null,
  params: source => ({ ...source, draft: false }),
  submit: 'direct',
}

describe('续接生成', () => {
  it('只为可续接的结果取平台引用，取不到时不记录', () => {
    const model = { continuations: [finalize] }
    expect(captureContinuations(model, { draft: true }, { taskId: 't1', metadata: null })).toEqual({ 'finalize-draft': { taskId: 't1' } })
    expect(captureContinuations(model, { draft: false }, { taskId: 't1', metadata: null })).toBeUndefined()
    expect(captureContinuations(model, { draft: true }, { metadata: null })).toBeUndefined()
  })

  it('续接参数带上引用，且不沿用源参数里上一次续接的引用', () => {
    const params = buildContinuationParams('m', finalize, { draft: true, prompt: 'p', __continuation: { id: 'old', sourceModelId: 'x', reference: {} } }, { taskId: 't1' })
    expect(params).toEqual({ draft: false, prompt: 'p', __continuation: { id: 'finalize-draft', sourceModelId: 'm', reference: { taskId: 't1' } } })
    expect(readContinuation(params, 'finalize-draft')?.reference).toEqual({ taskId: 't1' })
    expect(readContinuation(params, 'extend')).toBeNull()
    expect(readContinuation({ __continuation: 'bad' })).toBeNull()
  })
})
