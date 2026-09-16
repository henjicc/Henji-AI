import { expect, it } from 'vitest'
import { applicationTransactionFailureFactsSchema, failureObservedEffects, transactionFailureFacts } from './applicationTransactionFailureFacts'
import { requireFrontendSuccess } from '../../../electron/main/services/agent-runtime/tools/builtin/frontend-utils'
import { toGatewayError } from '../../../electron/main/services/agent-runtime/tools/gateway-support'
import { serializeError } from '../../../electron/main/services/agent-runtime/runner/runner-results'

const effect = { effect: 'update' as const, entityType: 'image_edit.layer', refs: [{ kind: 'image_edit.layer', id: 'v3:doc:layer' }],
  propertyIds: ['image_edit.layer.name'], origin: { kind: 'direct' as const } }
const facts = transactionFailureFacts({ status: 'failed', code: 'VERIFICATION_FAILED', message: '验证失败', recoverable: true,
  currentRevisions: { image_edit: 2, canvas: 3 }, effects: [effect], resultRefs: effect.refs, undoRef: 'undo:abcdefghijklmnop',
  partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } })!

it('合法失败事实经既有前端传输、Gateway 和事件序列化保留，观察永不伪装已验证', () => {
  let caught: unknown
  try { requireFrontendSuccess({ ok: false, error: { code: 'CAPABILITY_REJECTED', message: '已修改但验证失败', recoverable: true,
    details: { transaction: facts, privateDocument: '不能传输' } } }) } catch (error) { caught = error }
  const gateway = toGatewayError(caught)
  expect(gateway.retryable).toBe(false)
  expect(gateway.transaction).toEqual(facts)
  expect(serializeError(gateway).transaction).toEqual(facts)
  expect(JSON.stringify(serializeError(gateway))).not.toContain('privateDocument')
  expect(failureObservedEffects(facts)).toEqual([expect.objectContaining({ verified: false, effect: 'update' })])
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
