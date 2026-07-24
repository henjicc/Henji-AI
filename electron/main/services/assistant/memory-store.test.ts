import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runAgentSchemaMigrations } from '../agent-runtime/persistence/migrations'
import { AgentMemoryStore } from './memory-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

describeWithElectronSqlite('AgentMemoryStore', () => {
  let database: Database.Database
  let store: AgentMemoryStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    const now = Date.now()
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at)
      VALUES ('thread-memory', '记忆测试', ?, ?)
    `).run(now, now)
    database.prepare(`
      INSERT INTO agent_runs(
        run_id, thread_id, goal, request_json, state_json, status,
        checkpoint_version, checkpoint_json, recovery_status,
        parent_run_id, created_at, updated_at
      ) VALUES ('run-memory', 'thread-memory', '记住偏好', '{}', '{}', 'completed',
        'agent-checkpoint/v1', '{}', 'none', NULL, ?, ?)
    `).run(now, now)
    store = new AgentMemoryStore(database)
  })

  afterEach(() => {
    database.close()
  })

  it('默认关闭，启用后经过候选确认才进入相关性检索', () => {
    expect(store.getSettings().enabled).toBe(false)
    expect(() => store.propose('run-memory', '用户确认', {
      content: '我更偏好 KIE 的图片模型。',
      scope: { type: 'global', id: null },
      kind: 'preference',
      conflictKey: 'image-provider',
    })).toThrow('尚未启用')

    store.updateSettings({ enabled: true, defaultTtlDays: 30 })
    const candidate = store.propose('run-memory', '用户确认', {
      content: '我更偏好 KIE 的图片模型。',
      scope: { type: 'global', id: null },
      kind: 'preference',
      conflictKey: 'image-provider',
    })
    expect(store.getState()).toMatchObject({
      memories: [],
      candidates: [{ candidateId: candidate.candidateId, status: 'pending' }],
    })

    const memory = store.confirm(candidate.candidateId)
    expect(store.retrieve('帮我生成一张图片', 'generation', null)).toEqual([
      expect.objectContaining({
        memoryId: memory.memoryId,
        layer: 'confirmed_preference',
        score: expect.any(Number),
        retrievalReasons: expect.arrayContaining(['已确认偏好与当前选择任务相关']),
      }),
    ])
  })

  it('同 scope/conflictKey 的新记忆取代旧记忆，删除后不再检索', () => {
    store.updateSettings({ enabled: true })
    const first = store.confirm(store.propose('run-memory', '用户确认', {
      content: '图片优先 KIE。',
      scope: { type: 'global', id: null },
      kind: 'preference',
      conflictKey: 'image-provider',
    }).candidateId)
    const second = store.confirm(store.propose('run-memory', '用户纠正', {
      content: '图片优先 PPIO。',
      scope: { type: 'global', id: null },
      kind: 'preference',
      conflictKey: 'image-provider',
    }).candidateId)
    expect(database.prepare(`
      SELECT status FROM agent_memories WHERE memory_id = ?
    `).get(first.memoryId)).toEqual({ status: 'superseded' })
    store.delete(second.memoryId)
    expect(store.retrieve('生成图片', 'generation', null)).toEqual([])
  })

  it('项目 scope 不会泄漏到其他项目，过期内容不会注入', () => {
    store.updateSettings({ enabled: true })
    const memory = store.confirm(store.propose('run-memory', '用户确认', {
      content: '这个项目使用竖屏构图。',
      scope: { type: 'project', id: 'project-1' },
      kind: 'workflow',
      ttlDays: 30,
    }).candidateId)
    expect(store.retrieve('继续这个项目构图', 'nodes', 'project-2')).toEqual([])
    expect(store.retrieve('继续这个项目构图', 'nodes', 'project-1')).toHaveLength(1)
    database.prepare(`
      UPDATE agent_memories SET expires_at = ? WHERE memory_id = ?
    `).run(Date.now() - 1, memory.memoryId)
    expect(store.retrieve('继续这个项目构图', 'nodes', 'project-1')).toEqual([])
  })
})
