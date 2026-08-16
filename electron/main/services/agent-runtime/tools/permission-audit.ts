import {
  AGENT_PERMISSION_AUDIT_SCHEMA_VERSION,
  agentPermissionAuditFactSchema,
  type AgentPermissionAuditEvent,
  type AgentPermissionAuditFact,
  type AgentPermissionAuditResult,
} from '../../../../../src/core/assistant/permissionAudit'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentDataClass, AgentToolPreview } from '../../../../../src/core/assistant/toolContracts'
import { createMainLogger } from '../../logging'
import { digestJson } from './security'
import type { AgentToolAuthorizationSource, AgentToolDefinition } from './types'

const logger = createMainLogger('main.agent_permission_audit')

export interface AgentPermissionAuditTemplate {
  runId: string
  toolCallId: string
  approvalMode: AgentApprovalMode
  authorizationSource: AgentToolAuthorizationSource
  parentToolCallId?: string
  tool: {
    name: string
    version: number
    risk: AgentToolDefinition['risk']
    permission: string
    readOnly: boolean
    destructive: boolean
  }
  binding: NonNullable<AgentPermissionAuditFact['binding']>
  previewDataClasses: AgentDataClass[]
  failClosed: boolean
}

export interface BuildPermissionAuditTemplateInput {
  runId: string
  toolCallId: string
  approvalMode: AgentApprovalMode
  authorizationSource: AgentToolAuthorizationSource
  parentToolCallId?: string
  definition: AgentToolDefinition
  input: unknown
  preview: AgentToolPreview
  expectedRevisions: Record<string, number>
}

export interface RecordPermissionAuditInput {
  template: AgentPermissionAuditTemplate
  event: AgentPermissionAuditEvent
  approvalId?: string
  result?: AgentPermissionAuditResult
  reasonCode?: string
}

export class AgentPermissionAuditUnavailableError extends Error {
  readonly code = 'PERMISSION_AUDIT_UNAVAILABLE' as const

  constructor() {
    super('权限审计暂时不可用，受保护的工具调用未继续执行')
    this.name = 'AgentPermissionAuditUnavailableError'
  }
}

export function buildPermissionAuditTemplate(
  input: BuildPermissionAuditTemplateInput
): AgentPermissionAuditTemplate {
  const failClosed = !input.definition.readOnly
    || input.definition.destructive
    || input.definition.openWorld
    || input.definition.risk === 'R2'
    || input.definition.risk === 'R3'
    || input.definition.risk === 'R4'
    || input.preview.dataClasses.includes('C2')
    || input.preview.dataClasses.includes('C3')
    || input.authorizationSource === 'approved_workflow'
    || input.authorizationSource === 'approved_program'
    || input.authorizationSource === 'approved_script'
    || input.authorizationSource === 'approved_action_group'
  return {
    runId: input.runId,
    toolCallId: input.toolCallId,
    approvalMode: input.approvalMode,
    authorizationSource: input.authorizationSource,
    ...(input.parentToolCallId ? { parentToolCallId: input.parentToolCallId } : {}),
    tool: {
      name: input.definition.name,
      version: input.definition.version,
      risk: input.definition.risk,
      permission: input.definition.permission,
      readOnly: input.definition.readOnly,
      destructive: input.definition.destructive,
    },
    binding: {
      argsDigest: digestJson(input.input),
      previewDigest: digestJson(input.preview),
      targetDigest: digestJson(input.preview.targetIds),
      revisionsDigest: digestJson(input.expectedRevisions),
      targetCount: Object.keys(input.preview.targetIds).length,
      dataClasses: input.preview.dataClasses,
      ...(input.preview.destination
        ? { destinationDigest: digestJson(input.preview.destination) }
        : {}),
      reversible: input.preview.reversible,
    },
    previewDataClasses: input.preview.dataClasses,
    failClosed,
  }
}

export class AgentPermissionAuditor {
  constructor(
    private readonly append: (fact: AgentPermissionAuditFact) => Promise<void>
  ) {}

  async record(input: RecordPermissionAuditInput): Promise<void> {
    const fact = agentPermissionAuditFactSchema.parse({
      schemaVersion: AGENT_PERMISSION_AUDIT_SCHEMA_VERSION,
      runId: input.template.runId,
      toolCallId: input.template.toolCallId,
      approvalId: input.approvalId,
      event: input.event,
      occurredAt: new Date().toISOString(),
      tool: input.template.tool,
      authorization: {
        approvalMode: input.template.approvalMode,
        source: input.template.authorizationSource,
        parentToolCallId: input.template.parentToolCallId,
        reasonCode: input.reasonCode,
      },
      binding: input.template.binding,
      result: input.result,
    })
    logger.debug('Agent 权限审计写入开始', {
      event: 'agent_permission_audit.append.started',
      requestId: fact.runId,
      taskId: fact.toolCallId,
      context: { auditEvent: fact.event },
    })
    try {
      await this.append(fact)
      logger.debug('Agent 权限审计写入完成', {
        event: 'agent_permission_audit.append.completed',
        requestId: fact.runId,
        taskId: fact.toolCallId,
        context: { auditEvent: fact.event },
      })
    } catch (error) {
      logger.error('Agent 权限审计写入失败', {
        event: 'agent_permission_audit.append.failed',
        requestId: fact.runId,
        taskId: fact.toolCallId,
        context: {
          auditEvent: fact.event,
          failClosed: input.template.failClosed,
          errorName: error instanceof Error ? error.name : 'unknown',
        },
      })
      if (input.template.failClosed) throw new AgentPermissionAuditUnavailableError()
      logger.warn('低风险只读工具在审计降级下继续', {
        event: 'agent_permission_audit.append.degraded',
        requestId: fact.runId,
        taskId: fact.toolCallId,
        context: { auditEvent: fact.event },
      })
    }
  }
}
