import { describe, expect, it, vi } from 'vitest'
import { ApplicationExecutionProgressFailure, ApplicationPersistenceBoundaryFailure,
  ApplicationPersistenceFailure, withApplicationPersistenceBoundary,
  type ApplicationPersistenceParticipant, type ApplicationPersistenceReceipt } from './persistence'
import type { ApplicationCompletedStepResult, ApplicationExecutionContext } from './types'

const context: ApplicationExecutionContext = { requestId: 'batch', exposure: 'local_adapter',
  permissions: new Set(), acceptedDataClasses: new Set(['C0', 'C1']) }
const completed: ApplicationCompletedStepResult = { status: 'completed', directRefs: [], evidence: [], resultingRevisions: { image_edit: 2 } }
const saveFailure = () => new ApplicationPersistenceFailure('内存修改保留，请仅重试保存', {
  memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document',
  recovery: { capabilityId: 'retry_image_edit_document_save', target: { kind: 'image_edit.document', id: 'v3:test' }, replayMutation: false } })

describe('应用事务最终持久化屏障', () => {
  it('同一 owner 只开始和确认一次，执行时使用同一个 scope，结束总是释放', async () => {
    const confirm = vi.fn(async () => undefined)
    const release = vi.fn()
    const begin = vi.fn(() => ({ confirm, release }))
    const participant = { key: 'image-edit-document:test', begin }
    const execute = vi.fn(async (batch: ApplicationExecutionContext) => {
      expect(batch.persistenceScopes).toEqual(new Set([participant.key]))
      expect(confirm).not.toHaveBeenCalled()
      return [completed, completed]
    })
    await withApplicationPersistenceBoundary({ participants: [participant, participant], context, execute, completed: (result) => result })
    expect(begin).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('修改成功但存储失败保留全部已完成事实，不执行补偿或第二次业务操作', async () => {
    const execute = vi.fn(async () => [completed])
    const release = vi.fn()
    const participant = { key: 'owned', begin: () => ({ confirm: async () => { throw saveFailure() }, release }) }
    await expect(withApplicationPersistenceBoundary({ participants: [participant], context, execute, completed: (result) => result }))
      .rejects.toMatchObject({ completed: [completed], failure: { facts: { memoryState: 'modified', recovery: { replayMutation: false } } } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('业务部分补偿失败与保存失败同时发生，保留原原因和完整索引', async () => {
    const original = new ApplicationExecutionProgressFailure('第二步失败；第一步补偿失败', [completed, completed], [1])
    const participant = { key: 'owned', begin: () => ({ confirm: async () => { throw saveFailure() }, release: vi.fn() }) }
    const result = withApplicationPersistenceBoundary({ participants: [participant], context,
      execute: async () => { throw original }, completed: () => [] })
    await expect(result).rejects.toBeInstanceOf(ApplicationPersistenceBoundaryFailure)
    await expect(result).rejects.toMatchObject({ completed: [completed, completed], executionFailure: original })
  })

  it('末尾投影回执只接纳已声明级联，生产失败也保留已发生的投影', async () => {
    const receipt: ApplicationPersistenceReceipt = { effects: [{ effect: 'update', entityType: 'canvas.node',
      refs: [{ kind: 'canvas.node', id: 'project:node' }], propertyIds: [],
      origin: { kind: 'cascade', declarationId: 'image_edit.document.node_projection' } }], resultingRevisions: { canvas: 5 } }
    const participant: ApplicationPersistenceParticipant = { key: 'owned', persistenceEffects: [{
      declarationId: 'image_edit.document.node_projection', effect: 'update', entityType: 'canvas.node', propertyIds: [], revisionScopes: ['canvas'] }],
      begin: () => ({ confirm: async () => { const error = saveFailure(); throw new ApplicationPersistenceFailure(error.message, error.facts, error, receipt) }, release: vi.fn() }) }
    const onReceipt = vi.fn()
    await expect(withApplicationPersistenceBoundary({ participants: [participant], context, execute: async () => [completed],
      completed: (result) => result, onReceipt })).rejects.toMatchObject({ receipts: [receipt] })
    expect(onReceipt).toHaveBeenCalledWith(receipt)
    await expect(withApplicationPersistenceBoundary({ participants: [{ ...participant, persistenceEffects: [] }], context,
      execute: async () => [completed], completed: (result) => result })).rejects.toThrow('UNDECLARED_PERSISTENCE_EFFECT')
  })
})
