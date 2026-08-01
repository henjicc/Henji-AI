import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

import {
  AGENT_ARTIFACT_SCHEMA_VERSION,
  agentArtifactDescriptorSchema,
  agentArtifactPageSchema,
  type AgentArtifactDescribeRequest,
  type AgentArtifactDescriptor,
  type AgentArtifactPage,
  type AgentArtifactReadRequest,
} from '../../../../../src/core/assistant/artifacts'
import type { AgentContextArtifact } from '../context/types'
import { sanitizeObservationValue } from '../context/sanitize'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_artifact')

interface ArtifactRow {
  artifact_ref: string
  run_id: string
  thread_id: string
  source: string
  data_classes_json: string
  payload_json: string
  original_bytes: number
  created_at: number
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown
}

function rootKind(value: unknown): AgentArtifactDescriptor['rootKind'] {
  if (Array.isArray(value)) return 'array'
  if (value && typeof value === 'object') return 'object'
  return 'value'
}

function selectionDigest(fields: string[]): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16)
}

function encodeCursor(offset: number, digest: string): string {
  return `v1:${offset}:${digest}`
}

function decodeCursor(cursor: string | undefined, digest: string, totalBytes: number): number {
  if (!cursor) return 0
  const match = /^v1:(\d+):([a-f0-9]{16})$/.exec(cursor)
  if (!match || match[2] !== digest) {
    throw new Error('[INVALID_INPUT] Artifact cursor 与当前字段选择不匹配')
  }
  const offset = Number(match[1])
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalBytes) {
    throw new Error('[INVALID_INPUT] Artifact cursor 已超出内容范围')
  }
  return offset
}

function selectPayload(payload: unknown, fields: string[] | undefined): {
  payload: unknown
  selectedFields: string[]
} {
  if (!fields) return { payload, selectedFields: [] }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('[INVALID_INPUT] fields 只允许筛选 Artifact 顶层对象字段')
  }
  const record = payload as Record<string, unknown>
  const availableFields = Object.keys(record).filter(Boolean).slice(0, 32)
  const selectedFields = [...new Set(fields)].sort((left, right) => left.localeCompare(right))
  for (const field of selectedFields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      const available = availableFields.length > 0
        ? `。可用顶层字段：${availableFields.join('、')}`
        : '。该 Artifact 没有可筛选的顶层字段，请省略 fields'
      throw new Error(`[INVALID_INPUT] Artifact 不包含顶层字段：${field}${available}`)
    }
  }
  return {
    payload: Object.fromEntries(selectedFields.map((field) => [field, record[field]])),
    selectedFields,
  }
}

function safeUtf8Page(buffer: Buffer, offset: number, limitBytes: number): {
  content: string
  nextOffset: number
} {
  if (offset < buffer.length && (buffer[offset] & 0xc0) === 0x80) {
    throw new Error('[INVALID_INPUT] Artifact cursor 未落在 UTF-8 字符边界')
  }
  let end = Math.min(buffer.length, offset + limitBytes)
  while (end > offset && end < buffer.length && (buffer[end] & 0xc0) === 0x80) end -= 1
  return { content: buffer.subarray(offset, end).toString('utf8'), nextOffset: end }
}

export class AgentArtifactPersistenceStore {
  constructor(private readonly database: Database.Database) {}

  describe(request: AgentArtifactDescribeRequest): AgentArtifactDescriptor {
    const row = this.requireOwnedRow(request)
    const payload = parseJson(row.payload_json)
    return agentArtifactDescriptorSchema.parse({
      schemaVersion: AGENT_ARTIFACT_SCHEMA_VERSION,
      artifactRef: row.artifact_ref,
      source: row.source,
      dataClasses: parseJson(row.data_classes_json),
      createdAt: new Date(row.created_at).toISOString(),
      originalBytes: row.original_bytes,
      rootKind: rootKind(payload),
      topLevelFields: payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).filter(Boolean).slice(0, 100)
        : [],
    })
  }

  read(request: AgentArtifactReadRequest): AgentArtifactPage {
    const startedAt = Date.now()
    logger.info('Agent Artifact 分页读取开始', {
      event: 'agent_artifact.read.started',
      requestId: request.runId,
      context: { artifactRef: request.artifactRef, hasCursor: Boolean(request.cursor) },
    })
    try {
      const row = this.requireOwnedRow(request)
      const descriptor = this.describe(request)
      if (descriptor.dataClasses.includes('C3')) {
        throw new Error('[PERMISSION_DENIED] C3 Artifact 禁止进入 Agent 上下文')
      }
      const selected = selectPayload(
        sanitizeObservationValue(parseJson(row.payload_json)),
        request.fields
      )
      const buffer = Buffer.from(JSON.stringify(selected.payload), 'utf8')
      const digest = selectionDigest(selected.selectedFields)
      const offset = decodeCursor(request.cursor, digest, buffer.length)
      const page = safeUtf8Page(buffer, offset, request.limitBytes)
      const hasMore = page.nextOffset < buffer.length
      const result = agentArtifactPageSchema.parse({
        schemaVersion: AGENT_ARTIFACT_SCHEMA_VERSION,
        artifactRef: descriptor.artifactRef,
        source: descriptor.source,
        dataClasses: descriptor.dataClasses,
        contentEncoding: 'json-fragment',
        content: page.content,
        returnedBytes: Buffer.byteLength(page.content, 'utf8'),
        totalBytes: buffer.length,
        nextCursor: hasMore ? encodeCursor(page.nextOffset, digest) : null,
        hasMore,
        selectedFields: selected.selectedFields,
      })
      logger.info('Agent Artifact 分页读取完成', {
        event: 'agent_artifact.read.completed',
        requestId: request.runId,
        context: {
          artifactRef: request.artifactRef,
          returnedBytes: result.returnedBytes,
          totalBytes: result.totalBytes,
          hasMore,
          durationMs: Date.now() - startedAt,
        },
      })
      return result
    } catch (error) {
      logger.warn('Agent Artifact 分页读取失败', {
        event: 'agent_artifact.read.failed',
        requestId: request.runId,
        context: {
          artifactRef: request.artifactRef,
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof Error ? error.message.match(/^\[([^\]]+)]/)?.[1] : undefined,
        },
      })
      throw error
    }
  }

  load(artifactRef: string): AgentContextArtifact | null {
    const row = this.database.prepare(`
      SELECT a.artifact_ref, a.run_id, r.thread_id, a.source, a.data_classes_json,
             a.payload_json, a.original_bytes, a.created_at
      FROM agent_artifacts a
      JOIN agent_runs r ON r.run_id = a.run_id
      WHERE a.artifact_ref = ?
    `).get(artifactRef) as ArtifactRow | undefined
    if (!row) return null
    return {
      artifactRef: row.artifact_ref,
      source: row.source,
      dataClasses: agentArtifactDescriptorSchema.shape.dataClasses.parse(parseJson(row.data_classes_json)),
      payload: parseJson(row.payload_json),
      originalBytes: row.original_bytes,
      createdAt: new Date(row.created_at).toISOString(),
    }
  }

  private requireOwnedRow(request: AgentArtifactDescribeRequest): ArtifactRow {
    const row = this.database.prepare(`
      SELECT a.artifact_ref, a.run_id, r.thread_id, a.source, a.data_classes_json,
             a.payload_json, a.original_bytes, a.created_at
      FROM agent_artifacts a
      JOIN agent_runs r ON r.run_id = a.run_id
      WHERE a.artifact_ref = ?
    `).get(request.artifactRef) as ArtifactRow | undefined
    if (!row) throw new Error('[ARTIFACT_NOT_FOUND] Artifact 不存在或已删除')
    if (row.run_id !== request.runId || row.thread_id !== request.threadId) {
      throw new Error('[PERMISSION_DENIED] Artifact 不属于当前 run/thread')
    }
    return row
  }
}
