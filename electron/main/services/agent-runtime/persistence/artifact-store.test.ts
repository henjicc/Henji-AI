import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentArtifactReadRequestSchema } from '../../../../../src/core/assistant/artifacts'
import { runAgentSchemaMigrations } from './migrations'
import { AgentArtifactPersistenceStore } from './artifact-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

function insertRun(database: Database.Database, runId: string, threadId: string): void {
  const now = Date.now()
  database.prepare(`
    INSERT OR IGNORE INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(threadId, threadId, now, now, runId)
  database.prepare(`
    INSERT INTO agent_runs(
      run_id, thread_id, goal, request_json, state_json, status,
      checkpoint_version, checkpoint_json, recovery_status,
      parent_run_id, created_at, updated_at
    ) VALUES (?, ?, 'test', '{}', '{}', 'running', 'test', '{}', 'none', NULL, ?, ?)
  `).run(runId, threadId, now, now)
}

function insertArtifact(
  database: Database.Database,
  artifactRef: string,
  runId: string,
  payload: unknown,
  dataClasses: string[] = ['C1']
): void {
  const payloadJson = JSON.stringify(payload)
  database.prepare(`
    INSERT INTO agent_artifacts(
      artifact_ref, run_id, source, data_classes_json,
      payload_json, original_bytes, created_at
    ) VALUES (?, ?, 'query_assets:call-1', ?, ?, ?, ?)
  `).run(
    artifactRef,
    runId,
    JSON.stringify(dataClasses),
    payloadJson,
    Buffer.byteLength(payloadJson, 'utf8'),
    Date.now()
  )
}

describeWithElectronSqlite('AgentArtifactPersistenceStore', () => {
  let database: Database.Database

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    insertRun(database, 'run-1', 'thread-1')
    insertRun(database, 'run-2', 'thread-1')
    insertRun(database, 'run-3', 'thread-2')
  })

  afterEach(() => { database.close() })

  it('进程级 store 重建后仍可用稳定 cursor 完整分页读取 UTF-8 内容', () => {
    const payload = { items: Array.from({ length: 400 }, (_, index) => `第 ${index} 条内容🙂`) }
    insertArtifact(database, 'artifact:large', 'run-1', payload)
    const store = new AgentArtifactPersistenceStore(database)
    let cursor: string | undefined
    let combined = ''

    do {
      const page = store.read(agentArtifactReadRequestSchema.parse({
        runId: 'run-1',
        threadId: 'thread-1',
        artifactRef: 'artifact:large',
        cursor,
        limitBytes: 512,
      }))
      combined += page.content
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(JSON.parse(combined)).toEqual(payload)
  })

  it('只允许筛选存在的顶层字段，且 cursor 绑定字段选择', () => {
    insertArtifact(database, 'artifact:fields', 'run-1', {
      visible: 'a'.repeat(2_000),
      omitted: 'b'.repeat(2_000),
    })
    const store = new AgentArtifactPersistenceStore(database)
    const first = store.read(agentArtifactReadRequestSchema.parse({
      runId: 'run-1', threadId: 'thread-1', artifactRef: 'artifact:fields',
      fields: ['visible'], limitBytes: 512,
    }))

    expect(first.selectedFields).toEqual(['visible'])
    expect(() => store.read(agentArtifactReadRequestSchema.parse({
      runId: 'run-1', threadId: 'thread-1', artifactRef: 'artifact:fields',
      fields: ['omitted'], cursor: first.nextCursor ?? undefined,
    }))).toThrow(/cursor/)
    expect(() => store.read(agentArtifactReadRequestSchema.parse({
      runId: 'run-1', threadId: 'thread-1', artifactRef: 'artifact:fields',
      fields: ['missing'],
    }))).toThrow(/不包含顶层字段/)
  })

  it('拒绝跨 run、跨 thread、不存在引用与 C3 内容', () => {
    insertArtifact(database, 'artifact:private', 'run-1', { ok: true })
    insertArtifact(database, 'artifact:secret', 'run-1', { secret: true }, ['C3'])
    const store = new AgentArtifactPersistenceStore(database)

    expect(() => store.describe({
      runId: 'run-2', threadId: 'thread-1', artifactRef: 'artifact:private',
    })).toThrow(/PERMISSION_DENIED/)
    expect(() => store.describe({
      runId: 'run-3', threadId: 'thread-2', artifactRef: 'artifact:private',
    })).toThrow(/PERMISSION_DENIED/)
    expect(() => store.describe({
      runId: 'run-1', threadId: 'thread-1', artifactRef: 'artifact:missing',
    })).toThrow(/ARTIFACT_NOT_FOUND/)
    expect(() => store.read(agentArtifactReadRequestSchema.parse({
      runId: 'run-1', threadId: 'thread-1', artifactRef: 'artifact:secret',
    }))).toThrow(/PERMISSION_DENIED/)
  })
})
