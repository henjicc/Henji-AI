import { expect, it } from 'vitest'
import { applicationTransactionFailureFactsSchema, failureObservedEffects, transactionFailureFacts } from './applicationTransactionFailureFacts'

const effect = { effect: 'update' as const, entityType: 'image_edit.layer', refs: [{ kind: 'image_edit.layer', id: 'v3:doc:layer' }],
  propertyIds: ['image_edit.layer.name'], origin: { kind: 'direct' as const } }
const facts = transactionFailureFacts({ status: 'failed', code: 'VERIFICATION_FAILED', message: '验证失败', recoverable: true,
  currentRevisions: { image_edit: 2, canvas: 3 }, effects: [effect], resultRefs: effect.refs, undoRef: 'undo:abcdefghijklmnop',
  partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } })!

it('事务失败事实经序列化保留实际副作用且不伪装已验证', () => {
  const transmitted = applicationTransactionFailureFactsSchema.parse(JSON.parse(JSON.stringify(facts)))
  expect(transmitted).toEqual(facts)
  expect(transmitted.replayMutation).toBe(false)
  expect(failureObservedEffects(transmitted)).toEqual([expect.objectContaining({ verified: false, effect: 'update' })])
})

it('失败DTO拒绝任意 details、属性值、文档和越界数组', () => {
  for (const extra of [{ details: {} }, { document: {} }, { values: { key: 'secret' } }, { effects: Array(513).fill(effect) }]) {
    expect(applicationTransactionFailureFactsSchema.safeParse({ ...facts, ...extra }).success).toBe(false)
  }
  expect(transactionFailureFacts({ status: 'failed', code: 'CONFLICT', message: '零写入冲突', recoverable: true })).toBeUndefined()
})

it('256个合法引用映射到有界观察时不丢后半段引用', () => {
  const refs = Array.from({ length: 256 }, (_, index) => ({ kind: 'image_edit.layer', id: `layer-${index}` }))
  const observations = failureObservedEffects({ ...facts, effects: [{ ...effect, refs }] })
  expect(observations).toHaveLength(2)
  expect(observations.flatMap((item) => item.targetRefs)).toEqual(refs)
  expect(observations.every((item) => item.verified === false)).toBe(true)
})
