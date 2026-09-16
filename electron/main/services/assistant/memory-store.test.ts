import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initializeAssistantMemorySchema } from './storageSchema'
import { AgentMemoryStore } from './memory-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

describeWithElectronSqlite('AgentMemoryStore', () => {
  let database: Database.Database
  let store: AgentMemoryStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    initializeAssistantMemorySchema(database)
    store = new AgentMemoryStore(database)
  })

  afterEach(() => {
    database.close()
  })


  it('共享摘要持久化、长度限制、并发保护和关闭状态', () => {
    const initial = store.getSharedMemory()
    expect(initial.enabled).toBe(true)
    const saved = store.updateSharedMemory({ content: '偏好水墨质感。', expectedRevision: initial.revision })
    expect(new AgentMemoryStore(database).getSharedMemory()).toEqual(saved)
    expect(store.getState().memories[0].content).toBe('偏好水墨质感。')
    expect(() => store.updateSharedMemory({ content: '旧修改', expectedRevision: initial.revision })).toThrow('记忆已改变')
    expect(() => store.updateSharedMemory({ content: '字'.repeat(801), expectedRevision: saved.revision })).toThrow()
    store.updateSettings({ enabled: false })
    expect(store.getSharedMemory().enabled).toBe(false)
    expect(() => store.updateSharedMemory({ content: '新偏好', expectedRevision: store.getSharedMemory().revision })).toThrow('关闭')
    const cleared = store.updateSharedMemory({ content: '', expectedRevision: store.getSharedMemory().revision })
    expect(cleared.content).toBe('')
    expect(store.getState().memories).toHaveLength(0)
    expect(store.getSharedMemory().enabled).toBe(false)
  })

  it('已明确关闭的旧设置不会被共享记忆初始化覆盖', () => {
    store.updateSettings({ enabled: false })
    expect(store.getSharedMemory().enabled).toBe(false)
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
    expect(store.retrieveDetailed({
      goal: '帮我生成一张图片',
      workspaceId: 'generation',
      projectId: null,
      intent: 'generate',
      toolDomains: [],
      stepSignals: [],
      limit: 6,
    }).entries).toEqual([
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
