import type Database from 'better-sqlite3'

import {
  AGENT_PERMISSION_AUDIT_SCHEMA_VERSION,
  agentPermissionAuditFactSchema,
  agentPermissionAuditQuerySchema,
  agentPermissionAuditRecordSchema,
  permissionAuditOutcomeForEvent,
  type AgentPermissionAuditFact,
  type AgentPermissionAuditQuery,
  type AgentPermissionAuditRecord,
} from '../../../../../src/core/assistant/permissionAudit'

interface PermissionAuditRow {
  id: number
  run_id: string
  tool_call_id: string
  action: AgentPermissionAuditFact['event']
  outcome: AgentPermissionAuditRecord['outcome']
  metadata_json: string
  created_at: number
}

const storedMetadataSchema = agentPermissionAuditFactSchema.pick({
  approvalId: true,
  tool: true,
  authorization: true,
  binding: true,
  result: true,
}).strict()

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function toRecord(row: PermissionAuditRow): AgentPermissionAuditRecord {
  const metadata = storedMetadataSchema.parse(parseJson(row.metadata_json))
  return agentPermissionAuditRecordSchema.parse({
    schemaVersion: AGENT_PERMISSION_AUDIT_SCHEMA_VERSION,
    auditId: row.id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    event: row.action,
    outcome: row.outcome,
    occurredAt: new Date(row.created_at).toISOString(),
    ...metadata,
  })
}

export class AgentPermissionAuditStore {
  constructor(private readonly database: Database.Database) {}

  append(rawFact: unknown): AgentPermissionAuditRecord {
    const fact = agentPermissionAuditFactSchema.parse(rawFact)
    const outcome = permissionAuditOutcomeForEvent(fact.event)
    const metadata = storedMetadataSchema.parse({
      approvalId: fact.approvalId,
      tool: fact.tool,
      authorization: fact.authorization,
      binding: fact.binding,
      result: fact.result,
    })
    const createdAt = Date.parse(fact.occurredAt)
    const result = this.database.prepare(`
      INSERT INTO agent_permission_audit(
        run_id, tool_call_id, action, outcome, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      fact.runId,
      fact.toolCallId,
      fact.event,
      outcome,
      JSON.stringify(metadata),
      createdAt
    )
    return agentPermissionAuditRecordSchema.parse({
      ...fact,
      auditId: Number(result.lastInsertRowid),
      outcome,
    })
  }

  query(rawQuery: AgentPermissionAuditQuery): AgentPermissionAuditRecord[] {
    const query = agentPermissionAuditQuerySchema.parse(rawQuery)
    const rows = (query.toolCallId
      ? this.database.prepare(`
          SELECT * FROM (
            SELECT id, run_id, tool_call_id, action, outcome, metadata_json, created_at
            FROM agent_permission_audit
            WHERE run_id = ? AND tool_call_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )
          ORDER BY created_at ASC, id ASC
        `).all(query.runId, query.toolCallId, query.limit)
      : this.database.prepare(`
          SELECT * FROM (
            SELECT id, run_id, tool_call_id, action, outcome, metadata_json, created_at
            FROM agent_permission_audit
            WHERE run_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )
          ORDER BY created_at ASC, id ASC
        `).all(query.runId, query.limit)) as PermissionAuditRow[]
    return rows.map(toRecord)
  }
}
