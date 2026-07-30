import { randomUUID } from 'node:crypto'

import {
  agentApprovalRequestSchema,
  type AgentApprovalRequest,
} from '../../../../../src/core/assistant/events'
import type { AgentToolPreview } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolDefinition } from './types'
import { digestJson } from './security'

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed' | 'resolving'

export const AGENT_APPROVAL_CONSUME_GRACE_MS = 30_000

interface StoredApproval {
  request: AgentApprovalRequest
  status: ApprovalStatus
  consumeBy: number | null
}

export interface CreateApprovalInput<TInput = unknown, TOutput = unknown> {
  runId: string
  toolCallId: string
  definition: AgentToolDefinition<TInput, TOutput>
  input: TInput
  preview: AgentToolPreview
  expectedRevisions: Record<string, number>
  ttlMs?: number
}

export interface ConsumeApprovalInput<TInput = unknown, TOutput = unknown> {
  approvalId: string
  runId: string
  toolCallId: string
  definition: AgentToolDefinition<TInput, TOutput>
  input: TInput
  preview: AgentToolPreview
  expectedRevisions: Record<string, number>
}

export class AgentApprovalError extends Error {
  constructor(readonly code: 'APPROVAL_INVALID' | 'APPROVAL_REJECTED' | 'APPROVAL_EXPIRED', message: string) {
    super(message)
    this.name = 'AgentApprovalError'
  }
}

export class AgentApprovalManager {
  private readonly approvals = new Map<string, StoredApproval>()

  create<TInput, TOutput>(input: CreateApprovalInput<TInput, TOutput>): AgentApprovalRequest {
    assertApprovalPreviewTargets(input.definition, input.input, input.preview)
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? 5 * 60 * 1_000)).toISOString()
    const scope = createApprovalScope(input.definition, input.preview)
    const request = agentApprovalRequestSchema.parse({
      approvalId: randomUUID(),
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.definition.name,
      toolVersion: input.definition.version,
      risk: input.definition.risk,
      title: input.preview.title,
      summary: input.preview.summary,
      argsDigest: digestJson(input.input),
      previewDigest: digestJson(input.preview),
      targetIds: input.preview.targetIds,
      dataClasses: input.preview.dataClasses,
      destination: input.preview.destination,
      expectedRevisions: input.expectedRevisions,
      permission: input.definition.permission,
      scope,
      expiresAt,
      reversible: input.preview.reversible,
    })
    this.approvals.set(request.approvalId, { request, status: 'pending', consumeBy: null })
    return request
  }

  async resolve(
    approvalId: string,
    runId: string,
    decision: 'approve' | 'reject',
    beforeCommit?: (request: AgentApprovalRequest) => Promise<void>
  ): Promise<'approved' | 'rejected'> {
    const stored = this.requireStored(approvalId, runId)
    this.assertNotExpired(stored)
    if (stored.status !== 'pending') throw new AgentApprovalError('APPROVAL_INVALID', '审批已被处理')
    const resolved = decision === 'approve' ? 'approved' : 'rejected'
    stored.status = 'resolving'
    try {
      await beforeCommit?.(stored.request)
      if (stored.status !== 'resolving') {
        throw new AgentApprovalError('APPROVAL_INVALID', '审批状态已发生变化')
      }
      if (resolved === 'approved') {
        stored.consumeBy = Math.max(
          Date.parse(stored.request.expiresAt),
          Date.now() + AGENT_APPROVAL_CONSUME_GRACE_MS
        )
      }
      stored.status = resolved
      return resolved
    } catch (error) {
      if (stored.status === 'resolving') {
        stored.status = decision === 'reject' ? 'rejected' : 'pending'
      }
      throw error
    }
  }

  async consume<TInput, TOutput>(
    input: ConsumeApprovalInput<TInput, TOutput>,
    beforeCommit?: (request: AgentApprovalRequest) => Promise<void>
  ): Promise<void> {
    const request = this.assertConsumable(input)
    const stored = this.requireStored(input.approvalId, input.runId)
    if (stored.status !== 'approved') throw new AgentApprovalError('APPROVAL_INVALID', '审批状态已发生变化')
    stored.status = 'resolving'
    try {
      await beforeCommit?.(request)
      if (stored.status !== 'resolving') {
        throw new AgentApprovalError('APPROVAL_INVALID', '审批状态已发生变化')
      }
      stored.status = 'consumed'
    } catch (error) {
      if (stored.status === 'resolving') stored.status = 'approved'
      throw error
    }
  }

  assertConsumable<TInput, TOutput>(
    input: ConsumeApprovalInput<TInput, TOutput>
  ): AgentApprovalRequest {
    const stored = this.requireStored(input.approvalId, input.runId)
    this.assertNotExpired(stored)
    if (stored.status === 'rejected') throw new AgentApprovalError('APPROVAL_REJECTED', '用户拒绝了本次工具调用')
    if (stored.status !== 'approved') throw new AgentApprovalError('APPROVAL_INVALID', '审批尚未通过或已被消费')
    assertApprovalPreviewTargets(input.definition, input.input, input.preview)
    const request = stored.request
    const currentScope = createApprovalScope(input.definition, input.preview)
    if (
      request.toolCallId !== input.toolCallId
      || request.toolName !== input.definition.name
      || request.toolVersion !== input.definition.version
      || request.risk !== input.definition.risk
      || request.argsDigest !== digestJson(input.input)
      || request.previewDigest !== digestJson(input.preview)
      || digestJson(request.targetIds) !== digestJson(input.preview.targetIds)
      || digestJson(request.dataClasses) !== digestJson(input.preview.dataClasses)
      || request.destination !== input.preview.destination
      || request.reversible !== input.preview.reversible
      || request.permission !== input.definition.permission
      || request.scope !== currentScope
      || digestJson(request.expectedRevisions) !== digestJson(input.expectedRevisions)
    ) {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批绑定与当前工具调用不一致')
    }
    return request
  }

  expireRun(runId: string): AgentApprovalRequest[] {
    const expired: AgentApprovalRequest[] = []
    for (const stored of this.approvals.values()) {
      if (
        stored.request.runId === runId
        && (stored.status === 'pending' || stored.status === 'approved' || stored.status === 'resolving')
      ) {
        stored.status = 'expired'
        expired.push(stored.request)
      }
    }
    return expired
  }

  async expire(
    approvalId: string,
    runId: string,
    beforeCommit?: (request: AgentApprovalRequest) => Promise<void>
  ): Promise<'expired'> {
    const stored = this.requireStored(approvalId, runId)
    if (stored.status === 'expired') return 'expired'
    if (stored.status !== 'pending' && stored.status !== 'approved') {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批已被处理')
    }
    stored.status = 'resolving'
    try {
      await beforeCommit?.(stored.request)
      if (stored.status !== 'resolving') {
        throw new AgentApprovalError('APPROVAL_INVALID', '审批状态已发生变化')
      }
      stored.status = 'expired'
      return 'expired'
    } catch (error) {
      if (stored.status === 'resolving') stored.status = 'expired'
      throw error
    }
  }

  discard(approvalId: string, runId: string): void {
    const stored = this.approvals.get(approvalId)
    if (stored?.request.runId === runId) this.approvals.delete(approvalId)
  }

  private requireStored(approvalId: string, runId: string): StoredApproval {
    const stored = this.approvals.get(approvalId)
    if (!stored || stored.request.runId !== runId) {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批不存在或不属于当前运行')
    }
    return stored
  }

  private assertNotExpired(stored: StoredApproval): void {
    const now = Date.now()
    const pendingExpired = stored.status === 'pending'
      && Date.parse(stored.request.expiresAt) <= now
    const approvedExpired = stored.status === 'approved'
      && (stored.consumeBy ?? Date.parse(stored.request.expiresAt)) <= now
    if (
      stored.status === 'expired'
      || pendingExpired
      || approvedExpired
    ) {
      stored.status = 'expired'
      throw new AgentApprovalError('APPROVAL_EXPIRED', '审批已过期')
    }
  }
}

function createApprovalScope<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>,
  preview: AgentToolPreview
): string {
  return `${definition.permission}:${digestJson({
    toolName: definition.name,
    toolVersion: definition.version,
    permission: definition.permission,
    readOnly: definition.readOnly,
    destructive: definition.destructive,
    openWorld: definition.openWorld,
    targetIds: preview.targetIds,
    dataClasses: preview.dataClasses,
    destination: preview.destination ?? null,
    reversible: preview.reversible,
  }).slice(0, 16)}`
}

export function assertApprovalPreviewTargets<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>,
  input: TInput,
  preview: AgentToolPreview
): void {
  if (digestJson(definition.targetIds(input)) !== digestJson(preview.targetIds)) {
    throw new AgentApprovalError('APPROVAL_INVALID', '审批预览目标与工具目标不一致')
  }
}
