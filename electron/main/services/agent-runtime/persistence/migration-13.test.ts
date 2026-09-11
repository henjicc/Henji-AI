import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runAgentSchemaMigrations } from './migrations'
import { AgentPersistenceStore } from './store'
import { createInitialAgentRunState } from '../runner/initial-state'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

/** 从真实 v12 schema 升级，保留旧记录并验证只读兼容投影。 */
describeWithElectronSqlite('迁移 13/14：保留历史并阻止未知操作自动重放', () => {
  let database: Database.Database

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
  })

  afterEach(() => {
    database.close()
  })

  /** 迁移到 v12 为止，模拟一个已经在用的真实库。 */
  function migrateToV12(): void {
    runAgentSchemaMigrations(database, 12)
  }

  /** 业务工程哨兵：本迁移一个字节都不该碰它。 */
  function seedBusinessTable(): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS camera_stage_projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `)
    database.prepare(`
      INSERT INTO camera_stage_projects(project_id, name, payload) VALUES (?, ?, ?)
    `).run('project-1', '三维工程', '{"objects":[{"id":"sphere-1"}]}')
  }

  function seedThreadWithRun(): void {
    const now = Date.now()
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('thread-1', '三维布景', now, now, 'run-1')
    database.prepare(`
      INSERT INTO agent_runs(
        run_id, thread_id, goal, status, request_json, state_json,
        checkpoint_version, checkpoint_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run-1', 'thread-1', '布置三维场景', 'completed', '{}',
      // 旧状态：带着已经不存在的 taskGraph 与 effectLedger，新 schema 解析必炸。
      JSON.stringify({ workingSummary: { route: { taskGraph: { facets: [] } }, effectLedger: [] } }),
      'agent-checkpoint/v2', '{}', now, now
    )
    const entries: Array<[string, string, number, string | null]> = [
      ['entry-1', 'user_message', 1, null],
      ['entry-2', 'assistant_message', 2, 'entry-1'],
      // 非对话条目也保留，不能借协议升级删除原执行历史。
      ['entry-3', 'run_reference', 3, 'entry-2'],
      ['entry-4', 'user_message', 4, 'entry-3'],
      ['entry-5', 'assistant_message', 5, 'entry-4'],
    ]
    for (const [entryId, kind, sequence, parentEntryId] of entries) {
      database.prepare(`
        INSERT INTO agent_session_entries(
          entry_id, thread_id, run_id, kind, sequence, parent_entry_id,
          schema_version, payload_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId, 'thread-1', 'run-1', kind, sequence, parentEntryId,
        'agent-session-entry/v1', '{}', `key-${entryId}`, now
      )
    }
  }

  function applyMigration13(): void {
    runAgentSchemaMigrations(database)
  }

  it('保留原始运行、全部对话条目和原父子链', () => {
    migrateToV12()
    seedBusinessTable()
    seedThreadWithRun()

    applyMigration13()

    expect(database.prepare('SELECT COUNT(*) AS total FROM agent_runs').get())
      .toMatchObject({ total: 1 })
    expect(database.prepare('SELECT last_run_id FROM agent_threads WHERE thread_id = ?').get('thread-1'))
      .toMatchObject({ last_run_id: 'run-1' })

    const kept = database.prepare(`
      SELECT entry_id, kind, parent_entry_id, run_id FROM agent_session_entries ORDER BY sequence
    `).all() as Array<{ entry_id: string; kind: string; parent_entry_id: string | null; run_id: string | null }>
    expect(kept.map((row) => row.entry_id)).toEqual(['entry-1', 'entry-2', 'entry-3', 'entry-4', 'entry-5'])
    expect(kept.map((row) => row.parent_entry_id)).toEqual([null, 'entry-1', 'entry-2', 'entry-3', 'entry-4'])
    expect(kept.every((row) => row.run_id === 'run-1')).toBe(true)
    const beforeRead = database.prepare('SELECT state_json, checkpoint_json FROM agent_runs').get()
    const store = new AgentPersistenceStore(database)
    expect(store.loadState('run-1')).toMatchObject({ status: 'failed',
      error: { code: 'CHECKPOINT_VERSION_MISMATCH' }, executionOutcome: { status: 'pending' },
      workingSummary: { recovery: { mode: 'verify_before_write' } } })
    expect(store.listRuns()[0]).toMatchObject({ recoveryStatus: 'recovery_required' })
    expect(database.prepare('SELECT state_json, checkpoint_json FROM agent_runs').get()).toEqual(beforeRead)

  })

  it('业务工程数据逐字不变', () => {
    migrateToV12()
    seedBusinessTable()
    seedThreadWithRun()

    applyMigration13()

    expect(database.prepare('SELECT * FROM camera_stage_projects').all()).toEqual([{
      project_id: 'project-1', name: '三维工程', payload: '{"objects":[{"id":"sphere-1"}]}',
    }])
  })

  it('v13 的兼容状态也必须核对，不能因 schema 能读取就默认有恢复证据', () => {
    runAgentSchemaMigrations(database, 13)
    seedThreadWithRun()
    const previous = createInitialAgentRunState('run-1', { threadId: 'thread-1', goal: '布置三维场景' })
    previous.workingSummary!.unresolvedItems = Array.from({ length: 10 }, (_, index) => `原任务待核对 ${index}`)
    previous.workingSummary!.attachmentRefs = ['asset:original-input']
    const raw = JSON.stringify({ ...previous, status: 'completed' })
    database.prepare('UPDATE agent_runs SET state_json = ?').run(raw)
    runAgentSchemaMigrations(database)
    const store = new AgentPersistenceStore(database)
    expect(store.loadState('run-1')).toMatchObject({ status: 'failed',
      executionOutcome: { status: 'pending' }, workingSummary: { recovery: { mode: 'verify_before_write' } } })
    expect(store.listRuns()[0]).toMatchObject({ recoveryStatus: 'recovery_required' })
    expect(store.loadState('run-1')?.workingSummary?.unresolvedItems).toEqual([
      ...previous.workingSummary!.unresolvedItems,
      expect.stringContaining('缺少当前协议的精确恢复证据'),
    ])
    expect(store.loadState('run-1')?.workingSummary?.attachmentRefs).toEqual(['asset:original-input'])
    expect(database.prepare('SELECT state_json, operation_history_version FROM agent_runs').get())
      .toEqual({ state_json: raw, operation_history_version: 0 })
    expect(store.operations.execute({ action: 'list', runId: 'run-1' })).toEqual([])
  })

  it('不删除旧事件；不兼容事件通过缺口返回只读历史状态', () => {
    migrateToV12()
    seedThreadWithRun()
    const event = JSON.stringify({ type: 'TaskGraphUpdated', sequence: 1, taskGraph: { facets: [] } })
    database.prepare('INSERT INTO agent_events(run_id, sequence, event_id, event_json, occurred_at) VALUES (?, ?, ?, ?, ?)')
      .run('run-1', 1, 'old-event', event, Date.now())
    applyMigration13()
    const store = new AgentPersistenceStore(database)
    expect(store.loadEvents('run-1')).toEqual([])
    expect(store.loadEventsAfter('run-1', 0, 10)).toMatchObject({ events: [], latestSequence: 1 })
    expect(database.prepare('SELECT event_json FROM agent_events').get()).toEqual({ event_json: event })
  })

  it('迁移可重复执行，第二次是空操作', () => {
    migrateToV12()
    seedThreadWithRun()
    applyMigration13()
    const afterFirst = database.prepare('SELECT COUNT(*) AS total FROM agent_session_entries').get()

    applyMigration13()

    expect(database.prepare('SELECT COUNT(*) AS total FROM agent_session_entries').get())
      .toEqual(afterFirst)
    expect(database.prepare('SELECT COUNT(*) AS total FROM app_schema_migrations WHERE version = 13').get())
      .toMatchObject({ total: 1 })
  })
})
