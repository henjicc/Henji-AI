import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_EXTERNAL_WAIT_VERSION,
  GENERATION_STATUS_EVENT_VERSION,
  type GenerationTaskStatus,
} from '../../../../../src/core/assistant/externalWait'
import { runAgentSchemaMigrations } from './migrations'
import { AgentExternalWaitStore } from './external-wait-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

describeWithElectronSqlite('AgentExternalWaitStore', () => {
  let database: Database.Database
  let store: AgentExternalWaitStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
      VALUES ('thread-1', '测试', 1, 1, NULL)
    `).run()
    database.prepare(`
      INSERT INTO agent_runs(
        run_id, thread_id, goal, request_json, state_json, status,
        checkpoint_version, checkpoint_json, recovery_status,
        parent_run_id, created_at, updated_at
      ) VALUES ('run-1', 'thread-1', '测试', '{}', '{}', 'waiting_external',
        'agent-checkpoint/v1', '{}', 'none', NULL, 1, 1)
    `).run()
    store = new AgentExternalWaitStore(database)
  })

  afterEach(() => { database.close() })

  const register = (waitId = 'wait-1', timeoutMs = 60_000) => store.register({
    version: AGENT_EXTERNAL_WAIT_VERSION,
    waitId,
    threadId: 'thread-1',
    sourceRunId: 'run-1',
    taskId: 'task-1',
    targetStatuses: ['success', 'error', 'cancelled'],
    timeoutMs,
    savePointSequence: 4,
    resumePolicy: 'linked_child_once',
  })

  const report = (eventId: string, status: GenerationTaskStatus, occurredAt: string) => (
    store.recordStatus({
      version: GENERATION_STATUS_EVENT_VERSION,
      eventId,
      taskId: 'task-1',
      status,
      revision: 1,
      occurredAt,
      resultAvailable: status === 'success',
      errorCode: null,
      errorMessage: null,
    })
  )

  it('终态先于 wait commit 仍可对账且只能 claim/consume 一次', () => {
    expect(report('event-success', 'success', '2026-07-30T10:00:00.000Z')).toBe(true)
    expect(report('event-success', 'success', '2026-07-30T10:00:00.000Z')).toBe(false)
    register()
    const claimed = store.claimReady('task-1')
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({ lastObservedStatus: 'success', status: 'claimed' })
    expect(store.claimReady('task-1')).toEqual([])
    expect(store.consume('wait-1', 'run-child')?.status).toBe('consumed')
    expect(store.consume('wait-1', 'run-other')).toBeNull()
  })

  it('乱序旧事件不会覆盖较新的真实终态', () => {
    register()
    report('event-new', 'success', '2026-07-30T10:00:02.000Z')
    report('event-old', 'generating', '2026-07-30T10:00:01.000Z')
    expect(store.claimReady('task-1')[0]?.lastObservedStatus).toBe('success')
  })

  it('超时 claim 后迟到成功不会产生第二次唤醒', () => {
    register('wait-1', 1_000)
    expect(store.claimExpired(Date.now() + 2_000)).toHaveLength(1)
    report('event-late', 'success', new Date(Date.now() + 3_000).toISOString())
    expect(store.claimReady('task-1')).toEqual([])
  })
})
