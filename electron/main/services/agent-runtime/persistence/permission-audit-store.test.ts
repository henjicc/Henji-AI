import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_PERMISSION_AUDIT_SCHEMA_VERSION,
  agentPermissionAuditFactSchema,
  type AgentPermissionAuditEvent,
  type AgentPermissionAuditFact,
} from '../../../../../src/core/assistant/permissionAudit'
import { runAgentSchemaMigrations } from './migrations'
import { AgentPermissionAuditStore } from './permission-audit-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip
const digest = (character: string): string => character.repeat(64)

function fact(
  event: AgentPermissionAuditEvent,
  toolCallId = 'tool-call-1'
): AgentPermissionAuditFact {
  return agentPermissionAuditFactSchema.parse({
    schemaVersion: AGENT_PERMISSION_AUDIT_SCHEMA_VERSION,
    runId: 'run-1',
    toolCallId,
    approvalId: event === 'auto_allowed' ? undefined : 'approval-1',
    event,
    occurredAt: '2026-07-30T08:00:00.000Z',
    tool: {
      name: 'update_canvas_node',
      version: 2,
      risk: 'R2',
      permission: 'canvas:write',
      readOnly: false,
      destructive: false,
    },
    authorization: {
      approvalMode: 'assistant_decides',
      source: 'direct',
      reasonCode: event === 'auto_allowed' ? 'SAFE_READ' : 'USER_DECISION',
    },
    binding: {
      argsDigest: digest('a'),
      previewDigest: digest('b'),
      targetDigest: digest('c'),
      revisionsDigest: digest('d'),
      targetCount: 1,
      dataClasses: ['C1'],
      reversible: true,
    },
    result: event.startsWith('execution_')
      ? {
          durationMs: 12,
          dataClasses: ['C1'],
          ...(event === 'execution_failed' ? { errorCode: 'EXECUTION_FAILED' } : {}),
        }
      : undefined,
  })
}

function createRun(database: Database.Database): void {
  database.prepare(`
    INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
    VALUES ('thread-1', '测试', 1, 1, 'run-1')
  `).run()
  database.prepare(`
    INSERT INTO agent_runs(
      run_id, thread_id, goal, request_json, state_json, status,
      checkpoint_version, checkpoint_json, recovery_status,
      parent_run_id, created_at, updated_at
    ) VALUES ('run-1', 'thread-1', '测试', '{}', '{}', 'running',
      'test', '{}', 'none', NULL, 1, 1)
  `).run()
}

describeWithElectronSqlite('AgentPermissionAuditStore', () => {
  let database: Database.Database
  let store: AgentPermissionAuditStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    createRun(database)
    store = new AgentPermissionAuditStore(database)
  })

  afterEach(() => {
    database.close()
  })

  it('按发生顺序保存全部审批与执行事实，并派生固定 outcome', () => {
    const events: AgentPermissionAuditEvent[] = [
      'approval_requested',
      'auto_allowed',
      'approved',
      'rejected',
      'expired',
      'consumed',
      'binding_failed',
      'execution_completed',
      'execution_failed',
      'execution_cached',
    ]

    for (const event of events) store.append(fact(event))

    expect(store.query({ runId: 'run-1' }).map((record) => [
      record.event,
      record.outcome,
    ])).toEqual([
      ['approval_requested', 'pending'],
      ['auto_allowed', 'allowed'],
      ['approved', 'approved'],
      ['rejected', 'rejected'],
      ['expired', 'expired'],
      ['consumed', 'consumed'],
      ['binding_failed', 'denied'],
      ['execution_completed', 'succeeded'],
      ['execution_failed', 'failed'],
      ['execution_cached', 'cached'],
    ])
  })

  it('支持按 toolCallId 查询，并只返回限制内最新事实', () => {
    store.append(fact('approval_requested', 'call-a'))
    store.append(fact('approval_requested', 'call-b'))
    store.append(fact('approved', 'call-a'))

    expect(store.query({
      runId: 'run-1',
      toolCallId: 'call-a',
    }).map((record) => record.event)).toEqual([
      'approval_requested',
      'approved',
    ])
    expect(store.query({ runId: 'run-1', limit: 2 }).map((record) => record.toolCallId))
      .toEqual(['call-b', 'call-a'])
  })

  it('持久层只保存摘要和固定元数据，不保存原始敏感正文', () => {
    const input = fact('approval_requested')
    store.append(input)
    const row = database.prepare(`
      SELECT metadata_json FROM agent_permission_audit WHERE run_id = 'run-1'
    `).get() as { metadata_json: string }

    expect(row.metadata_json).not.toContain('rawArgs')
    expect(row.metadata_json).not.toContain('C:\\')
    expect(row.metadata_json).not.toContain('sk-secret-value')
    expect(() => agentPermissionAuditFactSchema.parse({
      ...input,
      rawArgs: { apiKey: 'sk-secret-value' },
    })).toThrow()
    expect(() => agentPermissionAuditFactSchema.parse({
      ...input,
      binding: {
        ...input.binding,
        targetIds: { filePath: 'C:\\secret.txt' },
      },
    })).toThrow()
  })
})
