import { randomUUID } from 'node:crypto'

import {
  agentApprovalRequestSchema,
  type AgentApprovalRequest,
} from '../../../../../src/core/assistant/events'
import type { AgentToolDefinition } from './types'
import { digestJson } from './security'

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed'

interface StoredApproval {
  request: AgentApprovalRequest
  status: ApprovalStatus
}

export interface CreateApprovalInput {
  runId: string
  toolCallId: string
  definition: AgentToolDefinition
  input: unknown
  preview: {
    title: string
    summary: string
    targetIds: Record<string, string>
    reversible: boolean
  }
  expectedRevisions: Record<string, number>
  ttlMs?: number
}

export class AgentApprovalError extends Error {
  constructor(readonly code: 'APPROVAL_INVALID' | 'APPROVAL_REJECTED' | 'APPROVAL_EXPIRED', message: string) {
    super(message)
    this.name = 'AgentApprovalError'
  }
}

export class AgentApprovalManager {
  private readonly approvals = new Map<string, StoredApproval>()

  create(input: CreateApprovalInput): AgentApprovalRequest {
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? 5 * 60 * 1_000)).toISOString()
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
      expectedRevisions: input.expectedRevisions,
      permission: input.definition.permission,
      scope: `${input.definition.permission}:${digestJson(input.preview.targetIds).slice(0, 16)}`,
      expiresAt,
      reversible: input.preview.reversible,
    })
    this.approvals.set(request.approvalId, { request, status: 'pending' })
    return request
  }

  resolve(approvalId: string, runId: string, decision: 'approve' | 'reject'): 'approved' | 'rejected' {
    const stored = this.requireStored(approvalId, runId)
    this.assertNotExpired(stored)
    if (stored.status !== 'pending') throw new AgentApprovalError('APPROVAL_INVALID', '审批已被处理')
    stored.status = decision === 'approve' ? 'approved' : 'rejected'
    return stored.status
  }

  consume(
    approvalId: string,
    runId: string,
    toolCallId: string,
    definition: AgentToolDefinition,
    input: unknown,
    expectedRevisions: Record<string, number>
  ): void {
    const stored = this.requireStored(approvalId, runId)
    this.assertNotExpired(stored)
    if (stored.status === 'rejected') throw new AgentApprovalError('APPROVAL_REJECTED', '用户拒绝了本次工具调用')
    if (stored.status !== 'approved') throw new AgentApprovalError('APPROVAL_INVALID', '审批尚未通过或已被消费')
    const request = stored.request
    if (
      request.toolCallId !== toolCallId
      || request.toolName !== definition.name
      || request.toolVersion !== definition.version
      || request.argsDigest !== digestJson(input)
      || digestJson(request.expectedRevisions) !== digestJson(expectedRevisions)
    ) {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批绑定与当前工具调用不一致')
    }
    stored.status = 'consumed'
  }

  expireRun(runId: string): void {
    for (const stored of this.approvals.values()) {
      if (stored.request.runId === runId && (stored.status === 'pending' || stored.status === 'approved')) {
        stored.status = 'expired'
      }
    }
  }

  expire(approvalId: string, runId: string): 'expired' {
    const stored = this.requireStored(approvalId, runId)
    if (stored.status === 'pending' || stored.status === 'approved') stored.status = 'expired'
    return 'expired'
  }

  private requireStored(approvalId: string, runId: string): StoredApproval {
    const stored = this.approvals.get(approvalId)
    if (!stored || stored.request.runId !== runId) {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批不存在或不属于当前运行')
    }
    return stored
  }

  private assertNotExpired(stored: StoredApproval): void {
    if (stored.status === 'expired' || Date.parse(stored.request.expiresAt) <= Date.now()) {
      stored.status = 'expired'
      throw new AgentApprovalError('APPROVAL_EXPIRED', '审批已过期')
    }
  }
}
