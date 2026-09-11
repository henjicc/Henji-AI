import { describe, expect, it } from 'vitest'
import { operationRecordSchema, operationSnapshotSchema, projectOperationSnapshots } from './operations'

function operation() {
  return operationRecordSchema.parse({
    schemaVersion: 'operation-record/v1', operationId: 'operation', logicalTaskId: 'run', runId: 'run', threadId: 'thread',
    key: 'original-key', toolCallId: 'call', toolName: 'change_application_entities', toolVersion: 1,
    inputDigest: 'a'.repeat(64), authorizationDigest: 'b'.repeat(64),
    readOnly: false, container: false, targets: [{ kind: 'asset', id: 'original' }], targetBindings: {}, expectedRevisions: {},
    attempt: 1, state: 'unknown', createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:01.000Z',
    output: { privateResponse: 'do-not-project' }, effects: [],
    verifications: [{ operationId: 'operation', conditionId: 'formal_result', targets: [{ kind: 'asset', id: 'original' }],
      status: 'needs_check', evidence: ['回执尚未返回'], verifiedAt: '2026-09-12T00:00:01.000Z' }],
    persistenceReceipts: [{ operationId: 'operation', boundaryId: 'saved', targets: [{ kind: 'asset', id: 'original' }],
      storageTarget: { kind: 'asset', id: 'original' }, persistedAt: '2026-09-12T00:00:01.000Z', digest: 'c'.repeat(64) }],
    externalCalls: [{ key: 'task', source: 'generation', inputDigest: 'd'.repeat(64), target: { kind: 'generation.task', id: 'task' },
      state: 'submitted', dispatchedAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:01.000Z',
      response: { internalUrl: 'https://private.test' } }],
  })
}

describe('正式操作记录查询投影', () => {
  it('执行未知与已保存事实分别保留；原输出、外部响应和授权摘要不进入模型投影', () => {
    const projected = projectOperationSnapshots([operation()])
    expect(operationSnapshotSchema.array().parse(projected)).toMatchObject([{
      state: 'unknown', persistedTargets: [{ kind: 'asset', id: 'original' }],
      verifications: [{ status: 'needs_check' }], externalTasks: [{ state: 'submitted', target: { kind: 'generation.task', id: 'task' } }],
    }])
    const json = JSON.stringify(projected)
    for (const excluded of ['do-not-project', 'private.test', 'authorizationDigest', 'inputDigest', 'original-key']) {
      expect(json).not.toContain(excluded)
    }
  })

  it('查询不把容器或只读调用重复算作业务操作，也不截断未解决的问题', () => {
    const records = Array.from({ length: 25 }, (_, index) => ({ ...operation(), operationId: `operation-${index}` }))
    expect(projectOperationSnapshots([...records, { ...operation(), container: true }, { ...operation(), readOnly: true },
      { ...operation(), businessMutation: false }])).toHaveLength(25)
  })
})
