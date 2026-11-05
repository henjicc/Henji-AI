import { describe, expect, it } from 'vitest'
import type { ApplicationPlannedStep } from '../transactions'
import { context, createEngine, createFixture } from './engineTestFixture'
import type { ApplicationCollectionExecutor } from './types'

const ITEMS = 300
const longFact = '事'.repeat(1_200)

function setup(options: { failWith?: string } = {}) {
  const fixture = createFixture()
  const { engine } = createEngine(fixture)
  const executor: ApplicationCollectionExecutor = {
    entityType: 'sample.item',
    effectContract: { direct: [], cascades: [] },
    async apply(step) {
      if (options.failWith) throw new Error(options.failWith)
      fixture.revisions.value = 1
      const refs = (step as Extract<ApplicationPlannedStep, { kind: 'collection' }>).operation.kind === 'create'
        ? Array.from({ length: ITEMS }, (_, index) => ({ kind: 'sample.item', id: `item-${index}` })) : []
      return { status: 'completed', resultingRevisions: { 'sample.scope': 1 }, directRefs: refs, undoToken: 'undo-token',
        evidence: refs.map((target) => ({ kind: 'operation_result' as const, target, fact: longFact, capturedAt: new Date().toISOString() })) }
    },
    // 有的执行器撤销时不回读，证据为空也不能把已生效的撤销报成失败。
    async undo() {
      fixture.revisions.value = 2
      return { status: 'completed', resultingRevisions: { 'sample.scope': 2 }, directRefs: [], evidence: [] }
    },
  }
  engine.registerCollectionExecutor(executor)
  const step: ApplicationPlannedStep = { kind: 'collection', parent: { kind: 'sample.parent', id: 'parent-1' }, entityType: 'sample.item', expectedRevisions: { 'sample.scope': 0 },
    operation: { kind: 'create', items: Array.from({ length: ITEMS }, () => ({ properties: { 'sample.value': 2 } })) } }
  return { engine, step }
}

describe('业务生效后回执超长', () => {
  it('超过协议长度的批量创建照常完成：引用不丢，超出部分报告给调用方，撤销同样完成', async () => {
    const { engine, step } = setup()
    const plan = await engine.plan({ summary: '批量创建', transactionMode: 'compensatable', steps: [step] }, context())
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'bounded-commit-key' }, context())
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    expect(result.effects.flatMap((effect) => effect.refs)).toHaveLength(ITEMS)
    expect(result.resultRefs).toHaveLength(256)
    expect(result.evidence.every((item) => item.fact.length <= 1_000)).toBe(true)
    expect(result.receiptTruncation?.omitted).toMatchObject({ resultRefs: ITEMS - 256, evidence: ITEMS - 256 })
    expect(result.receiptTruncation?.note).toContain('不要重复执行')

    const undone = await engine.undo({ undoRef: result.undoRef!, expectedRevisions: { 'sample.scope': 1 }, idempotencyKey: 'bounded-undo-key-1' }, context())
    if (undone.status !== 'completed') throw new Error(JSON.stringify(undone))
    expect(undone.effects.flatMap((effect) => effect.refs)).toHaveLength(ITEMS)
    expect(undone.resultRefs).toHaveLength(256)
    expect(undone.receiptTruncation?.omitted.resultRefs).toBe(ITEMS - 256)
    expect(undone.evidence).toHaveLength(1)
  })

  it('验证未通过且文字超长时仍报验证失败，保留已执行事实，不降级成执行失败', async () => {
    const { engine, step } = setup()
    const conditions = Array.from({ length: 70 }, (_, index) => ({ kind: 'evidence_fact' as const, fact: `${index}${'缺'.repeat(990)}` }))
    const plan = await engine.plan({ summary: '批量创建', transactionMode: 'compensatable', steps: [step], verificationConditions: conditions }, context())
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'bounded-verify-key' }, context())
    if (result.status !== 'failed') throw new Error(JSON.stringify(result))
    expect(result.code).toBe('VERIFICATION_FAILED')
    expect(result.message.length).toBeLessThanOrEqual(2_000)
    expect(result.partial?.uncompensatedStepIndexes).toEqual([0])
    expect(result.undoRef).toBeTruthy()
    expect(result.verification?.unmetConditions).toHaveLength(64)
    expect(result.receiptTruncation?.omitted.unmetConditions).toBe(6)
  })

  it('错误原文超长时失败结果仍合法，调用方不会收到异常', async () => {
    const { engine, step } = setup({ failWith: '错'.repeat(3_000) })
    const plan = await engine.plan({ summary: '批量创建', transactionMode: 'compensatable', steps: [step] }, context())
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'bounded-failure-key' }, context())
    expect(result).toMatchObject({ status: 'failed' })
    if (result.status === 'failed') expect(result.message.length).toBeLessThanOrEqual(2_000)
  })
})
