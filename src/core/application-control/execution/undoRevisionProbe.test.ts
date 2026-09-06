import { describe, expect, it } from 'vitest'
import type { ApplicationCompletedStepResult } from './types'
import { mutationStep, removalStep } from './engineTestFixture'
import { resolveUndoExpectedAbsentMutations } from './undoRevisionProbe'

function completed(
  directIds: string[],
  cascadeDeleteIds: string[] = [],
): ApplicationCompletedStepResult {
  return {
    status: 'completed',
    resultingRevisions: { 'sample.scope': 1 },
    directRefs: directIds.map((id) => ({ kind: 'sample.item', id })),
    cascadeEffects: cascadeDeleteIds.map((id) => ({
      effect: 'delete',
      entityType: 'sample.item',
      refs: [{ kind: 'sample.item', id }],
      propertyIds: [],
      origin: { kind: 'cascade', declarationId: 'sample.cascade-delete' },
    })),
    evidence: [],
    undoToken: 'undo-token',
  }
}

describe('resolveUndoExpectedAbsentMutations', () => {
  it('级联删除引用不能替代同记录 direct remove 证明', () => {
    const resolved = resolveUndoExpectedAbsentMutations(
      [mutationStep('one', 6), removalStep('one')],
      [completed(['one']), completed([], ['one'])],
    )
    expect([...resolved]).toEqual([])
  })

  it('remove 后同一引用再次被 direct touch 时不再视为最终缺失', () => {
    const resolved = resolveUndoExpectedAbsentMutations(
      [mutationStep('one', 6), removalStep('one'), mutationStep('one', 8)],
      [completed(['one']), completed(['one']), completed(['one'])],
    )
    expect([...resolved]).toEqual([])
  })

  it('remove 步骤没有对应完成结果时不跳过实体读取', () => {
    const resolved = resolveUndoExpectedAbsentMutations(
      [mutationStep('one', 6), removalStep('one')],
      [completed(['one'])],
    )
    expect([...resolved]).toEqual([])
  })
})
