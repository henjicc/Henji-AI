import { describe, expect, it, vi } from 'vitest'

import { ApplicationExecutionProgressFailure, rollbackStepWrites } from './persistence'
import { createFixture, createEngine, context, mutationStep } from './engineTestFixture'

/*
 * 步骤自己报告的写入事实与失败原因，必须原样穿过引擎的外层包装。
 * 助手按 partial / recoverable / code 判断要不要重试：写了却报“未改变、可重试”会让它重复写入；
 * 取消或冲突被归成执行失败，它就分不清该停下还是重新读取后再规划。
 */

function partialResult(id: string) {
  return {
    status: 'completed' as const,
    resultingRevisions: { 'sample.scope': 1 },
    directRefs: [{ kind: 'sample.item', id }],
    evidence: [],
  }
}

async function commitSteps(steps: ReturnType<typeof mutationStep>[], setup: (executor: ReturnType<typeof createEngine>['executor']) => void) {
  const fixture = createFixture()
  const { engine, executor } = createEngine(fixture)
  setup(executor)
  const plan = await engine.plan({ summary: '步骤失败事实', transactionMode: 'compensatable', steps }, context())
  const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'step-failure-facts-0001' }, context())
  return { result, fixture }
}

describe('步骤失败事实穿过引擎包装', () => {
  it('单步执行器报告已写入时，结果如实写明已执行未补偿且不可重试', async () => {
    const { result } = await commitSteps([mutationStep('one', 6)], (executor) => {
      vi.spyOn(executor, 'apply').mockRejectedValueOnce(
        new ApplicationExecutionProgressFailure('候选已应用但保存未完成', [partialResult('one')], [], new Error('保存失败')))
    })
    expect(result).toMatchObject({ status: 'failed', recoverable: false,
      partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } })
    expect(result.status === 'failed' && result.message).not.toContain('没有任何步骤')
    expect(result.status === 'failed' && result.resultRefs).toEqual([{ kind: 'sample.item', id: 'one' }])
  })

  it('后一步报告已写入时，前一步照常补偿，失败那一步记为未补偿', async () => {
    const { result, fixture } = await commitSteps([mutationStep('one', 6), mutationStep('two', 8)], (executor) => {
      const apply = executor.apply.bind(executor)
      vi.spyOn(executor, 'apply').mockImplementation(async (step) => {
        if (step.target.id === 'two') throw new ApplicationExecutionProgressFailure('写入一半', [partialResult('two')], [], new Error('磁盘错误'))
        return apply(step)
      })
    })
    expect(result).toMatchObject({ status: 'failed', recoverable: false,
      partial: { completedStepIndexes: [0, 1], compensatedStepIndexes: [0], uncompensatedStepIndexes: [1] } })
    expect(fixture.values.get('one')).toBe(2)
  })

  it('执行器回滚失败时，这一步的写入作为未补偿事实报告，原因不带运行时前缀', async () => {
    const { result } = await commitSteps([mutationStep('one', 6)], (executor) => {
      vi.spyOn(executor, 'apply').mockImplementationOnce(() => rollbackStepWrites(new Error('写入失败'),
        async () => { throw new Error('回滚失败') }, () => partialResult('one')))
    })
    expect(result).toMatchObject({ status: 'failed', recoverable: false, partial: { uncompensatedStepIndexes: [0] } })
    expect(result.status === 'failed' && result.message).toContain('写入失败')
    expect(result.status === 'failed' && result.message).toContain('回滚失败')
    expect(result.status === 'failed' && result.message).not.toContain('Error:')
  })

  it('回滚失败后连剩余事实也读不到时，仍报告这一步未补偿', async () => {
    const { result } = await commitSteps([mutationStep('one', 6)], (executor) => {
      vi.spyOn(executor, 'apply').mockImplementationOnce(() => rollbackStepWrites(new Error('写入失败'),
        async () => { throw new Error('回滚失败') }, async () => { throw new Error('状态读取失败') }))
    })
    expect(result).toMatchObject({ status: 'failed', recoverable: false, partial: { uncompensatedStepIndexes: [0] } })
  })

  it.each([
    ['取消标记', new Error('CANCELLED'), 'CANCELLED', false],
    ['中止信号', new DOMException('This operation was aborted', 'AbortError'), 'CANCELLED', false],
    ['版本冲突', new Error('REVISION_CONFLICT:sample.scope:0/1'), 'CONFLICT', true],
  ] as const)('步骤内的%s保持原错误码', async (_label, error, code, recoverable) => {
    const { result } = await commitSteps([mutationStep('one', 6)], (executor) => {
      vi.spyOn(executor, 'apply').mockRejectedValueOnce(error)
    })
    expect(result).toMatchObject({ status: 'failed', code, recoverable, partial: { completedStepIndexes: [] } })
    expect(result.status === 'failed' && result.message).not.toMatch(/CANCELLED|REVISION_CONFLICT/)
  })

  it('前一步已补偿后遇到冲突，错误码仍是冲突并保留补偿事实', async () => {
    const { result } = await commitSteps([mutationStep('one', 6), mutationStep('two', 8)], (executor) => {
      const apply = executor.apply.bind(executor)
      vi.spyOn(executor, 'apply').mockImplementation(async (step) => {
        if (step.target.id === 'two') throw new Error('REVISION_CONFLICT:sample.scope:1/2')
        return apply(step)
      })
    })
    expect(result).toMatchObject({ status: 'failed', code: 'CONFLICT', recoverable: true,
      partial: { completedStepIndexes: [0], compensatedStepIndexes: [0], uncompensatedStepIndexes: [] } })
  })
})
