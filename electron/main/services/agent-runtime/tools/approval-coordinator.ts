import type { AgentApprovalRequest } from '../../../../../src/core/assistant/events'
import type { AgentPermissionAuditFact } from '../../../../../src/core/assistant/permissionAudit'
import {
  AgentApprovalError,
  AgentApprovalManager,
  type ConsumeApprovalInput,
  type CreateApprovalInput,
} from './approval'
import {
  AgentPermissionAuditUnavailableError,
  AgentPermissionAuditor,
  type AgentPermissionAuditTemplate,
  type RecordPermissionAuditInput,
} from './permission-audit'

export class AgentApprovalCoordinator {
  private readonly manager: AgentApprovalManager
  private readonly auditor: AgentPermissionAuditor
  private readonly templates = new Map<string, AgentPermissionAuditTemplate>()
  private readonly expirationAudits = new Map<string, {
    runId: string
    promise: Promise<void>
  }>()

  constructor(
    appendPermissionAudit: (fact: AgentPermissionAuditFact) => Promise<void>,
    manager = new AgentApprovalManager()
  ) {
    this.manager = manager
    this.auditor = new AgentPermissionAuditor(appendPermissionAudit)
  }

  record(input: RecordPermissionAuditInput): Promise<void> {
    return this.auditor.record(input)
  }

  async request(
    template: AgentPermissionAuditTemplate,
    input: CreateApprovalInput
  ): Promise<AgentApprovalRequest> {
    const approval = this.manager.create(input)
    this.templates.set(approval.approvalId, template)
    try {
      await this.auditor.record({
        template,
        approvalId: approval.approvalId,
        event: 'approval_requested',
        reasonCode: template.previewDataClasses.includes('C2')
          ? 'C2_REQUIRES_APPROVAL'
          : 'POLICY_REQUIRES_APPROVAL',
      })
      return approval
    } catch (error) {
      this.templates.delete(approval.approvalId)
      this.manager.discard(approval.approvalId, approval.runId)
      throw error
    }
  }

  async assertConsumable(
    template: AgentPermissionAuditTemplate,
    input: ConsumeApprovalInput
  ): Promise<void> {
    try {
      this.manager.assertConsumable(input)
    } catch (error) {
      const expired = error instanceof AgentApprovalError && error.code === 'APPROVAL_EXPIRED'
      try {
        if (expired) {
          await this.recordExpirationOnce(
            this.templates.get(input.approvalId) ?? template,
            input.approvalId,
            'APPROVAL_EXPIRED'
          )
        } else {
          await this.auditor.record({
            template: this.templates.get(input.approvalId) ?? template,
            approvalId: input.approvalId,
            event: 'binding_failed',
            reasonCode: 'APPROVAL_BINDING_FAILED',
          })
        }
      } catch {
        // 审批本身已不可消费，保留更精确的拒绝结论；审计器已记录脱敏故障。
      }
      if (expired) this.templates.delete(input.approvalId)
      throw error
    }
  }

  async consume(
    template: AgentPermissionAuditTemplate,
    input: ConsumeApprovalInput
  ): Promise<void> {
    const storedTemplate = this.templates.get(input.approvalId) ?? template
    try {
      await this.manager.consume(input, async () => {
        await this.auditor.record({
          template: storedTemplate,
          approvalId: input.approvalId,
          event: 'consumed',
          reasonCode: 'APPROVAL_CONSUMED',
        })
      })
      this.templates.delete(input.approvalId)
    } catch (error) {
      if (error instanceof AgentApprovalError) {
        try {
          if (error.code === 'APPROVAL_EXPIRED') {
            await this.recordExpirationOnce(
              storedTemplate,
              input.approvalId,
              'APPROVAL_EXPIRED'
            )
          } else {
            await this.auditor.record({
              template: storedTemplate,
              approvalId: input.approvalId,
              event: 'binding_failed',
              reasonCode: 'APPROVAL_BINDING_FAILED',
            })
          }
        } catch {
          // 无效审批不会进入执行阶段，保留原始拒绝原因。
        }
      }
      throw error
    }
  }

  async recordDenied(
    template: AgentPermissionAuditTemplate,
    approvalId?: string
  ): Promise<void> {
    try {
      await this.auditor.record({
        template,
        approvalId,
        event: 'binding_failed',
        reasonCode: 'POLICY_DENIED',
      })
    } catch {
      // C3/R4 的拒绝优先于审计可用性；auditor 已记录脱敏错误。
    }
  }

  async resolve(
    approvalId: string,
    runId: string,
    decision: 'approve' | 'reject'
  ): Promise<'approved' | 'rejected'> {
    const template = this.requireTemplate(approvalId, runId)
    try {
      const resolved = await this.manager.resolve(approvalId, runId, decision, async () => {
        await this.auditor.record({
          template,
          approvalId,
          event: decision === 'approve' ? 'approved' : 'rejected',
          reasonCode: decision === 'approve' ? 'USER_APPROVED' : 'USER_REJECTED',
        })
      })
      if (resolved === 'rejected') this.templates.delete(approvalId)
      return resolved
    } catch (error) {
      if (decision === 'reject' && error instanceof AgentPermissionAuditUnavailableError) {
        this.templates.delete(approvalId)
        return 'rejected'
      }
      if (error instanceof AgentApprovalError && error.code === 'APPROVAL_EXPIRED') {
        try {
          await this.recordExpirationOnce(template, approvalId, 'APPROVAL_EXPIRED')
        } catch {
          // 已过期审批保持 fail-closed；审计器已记录脱敏故障。
        }
        this.templates.delete(approvalId)
      }
      throw error
    }
  }

  async expire(approvalId: string, runId: string): Promise<'expired'> {
    const existingAudit = this.expirationAudits.get(approvalId)
    const template = this.templates.get(approvalId)
    if (!template && (!existingAudit || existingAudit.runId !== runId)) {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批不存在或不属于当前运行')
    }
    try {
      const result = await this.manager.expire(approvalId, runId, async () => {
        if (template) {
          await this.recordExpirationOnce(template, approvalId, 'APPROVAL_EXPIRED')
        } else {
          await existingAudit?.promise
        }
      })
      if (template) {
        await this.recordExpirationOnce(template, approvalId, 'APPROVAL_EXPIRED')
      } else {
        await existingAudit?.promise
      }
      this.templates.delete(approvalId)
      return result
    } catch (error) {
      if (error instanceof AgentPermissionAuditUnavailableError) {
        this.templates.delete(approvalId)
        return 'expired'
      }
      throw error
    }
  }

  async expireRun(runId: string): Promise<void> {
    const expired = this.manager.expireRun(runId)
    await Promise.all(expired.map(async (request) => {
      const template = this.templates.get(request.approvalId)
      if (!template) return
      try {
        await this.recordExpirationOnce(template, request.approvalId, 'RUN_TERMINATED')
      } finally {
        this.templates.delete(request.approvalId)
      }
    }))
  }

  private requireTemplate(approvalId: string, runId: string): AgentPermissionAuditTemplate {
    const template = this.templates.get(approvalId)
    if (!template || template.runId !== runId) {
      throw new AgentApprovalError('APPROVAL_INVALID', '审批不存在或不属于当前运行')
    }
    return template
  }

  private recordExpirationOnce(
    template: AgentPermissionAuditTemplate,
    approvalId: string,
    reasonCode: 'APPROVAL_EXPIRED' | 'RUN_TERMINATED'
  ): Promise<void> {
    const existing = this.expirationAudits.get(approvalId)
    if (existing) {
      if (existing.runId !== template.runId) {
        return Promise.reject(new AgentApprovalError(
          'APPROVAL_INVALID',
          '审批不存在或不属于当前运行'
        ))
      }
      return existing.promise
    }
    const promise = this.auditor.record({
      template,
      approvalId,
      event: 'expired',
      reasonCode,
    })
    this.expirationAudits.set(approvalId, { runId: template.runId, promise })
    return promise
  }
}
