import type { AgentApprovalRequest } from '../../../../../src/core/assistant/events'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_runtime')

export function logApprovalRunExpiryFailure(runId: string, error: unknown): void {
  logger.warn('取消运行时权限审计写入失败', {
    event: 'agent_approval.expire_run.failed',
    requestId: runId,
    context: { errorName: error instanceof Error ? error.name : 'unknown' },
  })
}

export function logApprovalResolved(
  runId: string,
  toolCallId: string,
  approvalId: string,
  decision: 'approved' | 'rejected'
): void {
  logger.info('Agent 工具审批已处理', {
    event: 'agent_approval.resolved',
    requestId: runId,
    taskId: toolCallId,
    context: { approvalId, decision },
  })
}

export function logApprovalRequested(
  runId: string,
  toolCallId: string,
  toolName: string,
  approval: AgentApprovalRequest
): void {
  logger.info('Agent 工具需要审批', {
    event: 'agent_approval.requested',
    requestId: runId,
    taskId: toolCallId,
    context: {
      approvalId: approval.approvalId,
      toolName,
      risk: approval.risk,
      expiresAt: approval.expiresAt,
    },
  })
}

export function logApprovalExpired(
  runId: string,
  toolCallId: string | null,
  approvalId: string
): void {
  logger.warn('Agent 工具审批已过期', {
    event: 'agent_approval.expired',
    requestId: runId,
    taskId: toolCallId ?? undefined,
    context: { approvalId },
  })
}
