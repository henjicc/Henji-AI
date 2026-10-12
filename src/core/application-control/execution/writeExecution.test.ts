import { describe, expect, it } from 'vitest'
import { ApplicationWriteExecution, ApplicationWriteFailure, applicationWriteChannel, assertApplicationWriteChannel } from './writeExecution'
import { ApplicationPreflightFailure, ApplicationTransactionFailure } from './transactionFailure'

describe('统一写执行通道', () => {
  it('拒绝故意绕过包装的 handler，并给出修正入口', () => {
    expect(() => assertApplicationWriteChannel('bypass', () => ({}))).toThrow('WRITE_EXECUTION_REQUIRED:bypass')
    expect(() => assertApplicationWriteChannel('write', applicationWriteChannel(() => ({})))).not.toThrow()
  })
  it('事务外普通异常是明确零执行，事务内异常不伪造零执行', async () => {
    const execution = new ApplicationWriteExecution()
    expect(execution.failure(new Error('missing'))).toMatchObject({ execution: { notExecuted: true } })
    const handler = applicationWriteChannel(() => { throw new Error('dispatch failed') })
    await expect(handler({}, {})).rejects.toMatchObject({ execution: { notExecuted: false, targetMutation: 'unknown' } })
    const rejected = applicationWriteChannel(async (_input, context) => context.execution.preflight(() => { throw new Error('missing') }))
    await expect(rejected({}, {})).rejects.toMatchObject({ execution: { notExecuted: true } })
  })
  it('已进入统一包装的加载前拒绝是明确零执行，且保留领域原因', async () => {
    const cause = Object.assign(new Error('格式不支持'), { name: 'PersistenceError' })
    const handler = applicationWriteChannel(async (_input, context) => context.execution.preflight(() => { throw cause }))
    await expect(handler({}, {})).rejects.toMatchObject({
      original: { cause }, execution: { billing: 'not_charged', targetMutation: 'none', notExecuted: true },
    })
  })
  it('保留已计费未写入事实；后置验证错误不能改判零执行', async () => {
    const paid = applicationWriteChannel((_input, context) => {
      context.execution.report({ billing: 'completed', audioDocumentId: 'audio' })
      throw new ApplicationPreflightFailure('late check')
    })
    await expect(paid({}, {})).rejects.toMatchObject({ execution: { notExecuted: false, billing: 'completed', targetMutation: 'none', audioDocumentId: 'audio' } })
    const execution = new ApplicationWriteExecution()
    await execution.run(() => ({}))
    expect(execution.failure(new ApplicationPreflightFailure('output'))).toMatchObject({ execution: { notExecuted: false } })
  })
  it('嵌套领域失败不丢失事实、不覆盖已报告修改', async () => {
    const handler = applicationWriteChannel((_input, context) => {
      context.execution.report({ targetMutation: 'applied' })
      throw new ApplicationWriteFailure('failed', { notExecuted: false, billing: 'completed', targetMutation: 'applied' })
    })
    await expect(handler({}, {})).rejects.toMatchObject({ execution: { notExecuted: false, billing: 'completed', targetMutation: 'applied' } })
  })
  it('付费完成后事务前置失败也保留费用，不能降成未执行', () => {
    const execution = new ApplicationWriteExecution()
    execution.report({ billing: 'completed' })
    const transaction = new ApplicationTransactionFailure({ status: 'failed', code: 'CONFLICT', message: '原目标改变', recoverable: true, partial: { completedStepIndexes: [], compensatedStepIndexes: [], uncompensatedStepIndexes: [] } })
    expect(execution.failure(transaction)).toMatchObject({ original: transaction, execution: { notExecuted: false, billing: 'completed' } })
  })
})
