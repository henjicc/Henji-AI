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

/**
 * 按 fields 筛选顶层字段：**给出存在的，如实说明哪些不存在**，不整单拒绝。
 *
 * 旧实现是全有或全无——请求的字段里只要有一个不存在就抛 INVALID_INPUT。模型并不知道
 * artifact 的确切形状（它是运行时按结果拼出来的），于是只能猜一串字段名；猜中 11 个、
 * 猜错 1 个，整次调用照样失败，它再换一串继续猜。
 *
 * 实测同一份代码：一个模型上重复 10 次直到运行被判死（46 轮、77 万 token、0 个 Effect），
 * 另一个模型上一次都没发生。全有或全无把「模型猜字段名」这件必然会发生的事变成了死循环。
 *
 * 现在：命中的字段照常返回；未命中的写进 missingFields 一并告诉模型，附可用字段清单。
 * 一个都没命中才是真的没法继续——那时才报错，因为返回空对象会让模型以为 artifact 是空的。
 */
export function selectPayload(payload: unknown, fields: string[] | undefined): {
  payload: unknown
  selectedFields: string[]
  missingFields: string[]
} {
  if (!fields) return { payload, selectedFields: [], missingFields: [] }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('[INVALID_INPUT] fields 只允许筛选 Artifact 顶层对象字段')
  }
  const record = payload as Record<string, unknown>
  const availableFields = Object.keys(record).filter(Boolean).slice(0, 32)
  const requested = [...new Set(fields)].sort((left, right) => left.localeCompare(right))
  const resolved = new Map(requested.flatMap((field) => {
    const value = resolveFieldPath(record, field)
    return value.found ? [[field, value.value] as const] : []
  }))
  const selectedFields = requested.filter((field) => resolved.has(field))
  const missingFields = requested.filter((field) => !resolved.has(field))

  if (selectedFields.length === 0) {
    const available = availableFields.length > 0
      ? `。可用顶层字段：${availableFields.join('、')}`
      : '。该 Artifact 没有可筛选的顶层字段，请省略 fields'
    const hints = requested.flatMap((field) => {
      const path = findNestedPath(record, field)
      return path ? [`${field} → ${path}`] : []
    })
    const hint = hints.length > 0 ? `。这些字段是嵌套的，改用点路径：${hints.join('；')}` : ''
    throw new Error(
      `[INVALID_INPUT] Artifact 不包含请求的任何顶层字段：${requested.join('、')}${hint}${available}`
    )
  }

  return {
    payload: Object.fromEntries(selectedFields.map((field) => [field, resolved.get(field)])),
    selectedFields,
    missingFields,
  }
}

/**
 * 支持 `scriptApi.actions` 这样的点路径，不只是顶层键。
 *
 * 模型天然会写点路径去要子树——它看到的结果就是嵌套的。旧实现只认顶层键，于是
 * `scriptApi.actions` 被判成"不存在的字段"，而 `scriptApi` 明明就在那儿。实测 camera 场景
 * 一次请求四个字段全是点路径，四个全落空，整次调用被拒。
 *
 * 数组下标不支持：模型要的是"某一类东西"，不是"第 3 个"，加下标只会扩大猜错的面。
 */
function resolveFieldPath(
  record: Record<string, unknown>,
  field: string
): { found: boolean; value: unknown } {
  const segments = field.split('.').filter(Boolean)
  if (segments.length === 0) return { found: false, value: undefined }
  let current: unknown = record
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return { found: false, value: undefined }
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

/**
 * 找出一个裸字段名在 artifact 里的实际点路径。
 *
 * 点路径早就支持了，但错误里只列顶层键——模型写 `recipes`，被告知"可用顶层字段：…、
 * scriptApi、…"，而 `recipes` 就在 `scriptApi` 里面。运行时知道答案却只肯说"不在顶层"，
 * 于是模型原样再试一次：实测三维场景连撞两次同一个字段，白烧两轮。
 *
 * 只查三层、只按叶子名精确匹配、最多给一条路径：目的是把已知的事实说出来，不是做模糊搜索。
 */
function findNestedPath(
  record: Record<string, unknown>,
  field: string,
  depth = 3
): string | null {
  const leaf = field.split('.').filter(Boolean).at(-1)
  if (!leaf) return null
  const walk = (value: unknown, prefix: string[], remaining: number): string | null => {
    if (remaining === 0 || !value || typeof value !== 'object' || Array.isArray(value)) return null
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = [...prefix, key]
      if (key === leaf && path.length > 1) return path.join('.')
      const nested = walk(child, path, remaining - 1)
      if (nested) return nested
    }
    return null
  }
  return walk(record, [], depth)
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
        missingFields: selected.missingFields,
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
    if (!row) throw new Error(`[ARTIFACT_NOT_FOUND] Artifact 不存在或已删除${this.availableRefsHint(request)}`)
    if (row.run_id !== request.runId || row.thread_id !== request.threadId) {
      throw new Error('[PERMISSION_DENIED] Artifact 不属于当前 run/thread')
    }
    return row
  }

  /**
   * 引用不存在时，把本次运行真正有哪些 artifact 说出来。
   *
   * 光说"不存在或已删除"，模型只能再猜一个 ref。实测设置场景：一次 NOT_FOUND 之后模型放弃
   * 读取、换路完成任务——结果是好的，但那一轮白烧了，而且那条失败记录一度把封存卡死。
   * 本次运行有哪些引用是数据库里现成的事实，没有任何理由不告诉它。
   */
  private availableRefsHint(request: AgentArtifactDescribeRequest): string {
    try {
      const rows = this.database.prepare(`
        SELECT a.artifact_ref FROM agent_artifacts a
        JOIN agent_runs r ON r.run_id = a.run_id
        WHERE a.run_id = ? AND r.thread_id = ?
        ORDER BY a.created_at DESC LIMIT 8
      `).all(request.runId, request.threadId) as { artifact_ref: string }[]
      if (rows.length === 0) return '。本次运行没有任何 artifact，不要再调用本工具。'
      return `。本次运行可读的 artifactRef：${rows.map((item) => item.artifact_ref).join('、')}`
    } catch {
      // 提示是锦上添花，取不到就照常报原始错误，不能让它把 NOT_FOUND 变成别的失败。
      return ''
    }
  }
}



