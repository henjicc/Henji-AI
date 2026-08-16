import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runAgentSchemaMigrations } from './migrations'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

/**
 * 迁移 13：任务图删除后，历史运行记录必须被清掉，而对话与业务数据一个字节都不能动。
 *
 * 保存点里存着 `route.taskGraph` 与 `effectLedger`，新 schema 已经不认这两个字段。而
 * `store.ts` 的版本检查条件是「版本不匹配**且**状态非终态」——已完成/失败/取消的历史运行
 * 被排除在外，会直奔 `agentRunStateSchema.parse` 然后抛。**光撞 checkpoint 版本号救不了它们。**
 *
 * 所以这条门禁必须同时验证两件事，缺一不可：
 *   1. 运行记录真的删干净了（`agent_runs` 为空，级联表跟着空）
 *   2. 用户的东西一条不少（对话逐条保留、父子链连续、业务表原样）
 *
 * 必须从 v12 **顺序迁移**，不能建一个干净库直接跑 13：真实用户库上的外键、触发器和部分索引
 * 只有在完整迁移链上才成立。
 */
describeWithElectronSqlite('迁移 13：删除历史运行，保留对话与业务数据', () => {
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
    runAgentSchemaMigrations(database)
    database.prepare('DELETE FROM app_schema_migrations WHERE version >= 13').run()
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
      // 非对话条目：迁移应当删掉它，并把断开的父子链重新接上。
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

  it('清空运行记录，但对话逐条保留且父子链重新连续', () => {
    migrateToV12()
    seedBusinessTable()
    seedThreadWithRun()

    applyMigration13()

    expect(database.prepare('SELECT COUNT(*) AS total FROM agent_runs').get())
      .toMatchObject({ total: 0 })
    expect(database.prepare('SELECT last_run_id FROM agent_threads WHERE thread_id = ?').get('thread-1'))
      .toMatchObject({ last_run_id: null })

    const kept = database.prepare(`
      SELECT entry_id, kind, parent_entry_id, run_id FROM agent_session_entries ORDER BY sequence
    `).all() as Array<{ entry_id: string; kind: string; parent_entry_id: string | null; run_id: string | null }>
    // 四条对话消息全在，中间那条非对话条目被清掉。
    expect(kept.map((row) => row.entry_id)).toEqual(['entry-1', 'entry-2', 'entry-4', 'entry-5'])
    // 链条在删除 tool_call 之后重新接上，没有指向已删除条目的悬空父指针。
    expect(kept.map((row) => row.parent_entry_id))
      .toEqual([null, 'entry-1', 'entry-2', 'entry-4'])
    expect(kept.every((row) => row.run_id === null)).toBe(true)
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
