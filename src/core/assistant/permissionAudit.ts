import { z } from 'zod'

import { agentApprovalModeSchema } from './runtimeContracts'
import { agentDataClassSchema, agentToolRiskSchema } from './toolContracts'

export const AGENT_PERMISSION_AUDIT_SCHEMA_VERSION = 'agent-permission-audit/v1' as const

export const agentPermissionAuditEventSchema = z.enum([
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
])
export type AgentPermissionAuditEvent = z.infer<typeof agentPermissionAuditEventSchema>

export const agentPermissionAuditOutcomeSchema = z.enum([
  'pending',
  'allowed',
  'approved',
  'rejected',
  'expired',
  'consumed',
  'denied',
  'succeeded',
  'failed',
  'cached',
])
export type AgentPermissionAuditOutcome = z.infer<typeof agentPermissionAuditOutcomeSchema>

const stableCodeSchema = z.string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const safeIdentifierSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/)

export const agentPermissionAuditToolSchema = z.object({
  name: safeIdentifierSchema,
  version: z.number().int().positive(),
  risk: agentToolRiskSchema,
  permission: safeIdentifierSchema,
  readOnly: z.boolean(),
  destructive: z.boolean(),
}).strict()

export const agentPermissionAuditAuthorizationSchema = z.object({
  approvalMode: agentApprovalModeSchema,
  source: z.enum(['direct', 'approved_workflow', 'approved_action_group']),
  parentToolCallId: z.string().min(1).max(200).optional(),
  reasonCode: stableCodeSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.source === 'approved_workflow' && !value.parentToolCallId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentToolCallId'],
      message: 'approved_workflow 必须关联父工具调用',
    })
  }
  if (value.source !== 'approved_workflow' && value.parentToolCallId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentToolCallId'],
      message: `${value.source} 不应包含父工具调用`,
    })
  }
})

export const agentPermissionAuditBindingSchema = z.object({
  argsDigest: digestSchema,
  previewDigest: digestSchema,
  targetDigest: digestSchema,
  revisionsDigest: digestSchema,
  targetCount: z.number().int().nonnegative().max(10_000),
  dataClasses: z.array(agentDataClassSchema).min(1).max(4),
  destinationDigest: digestSchema.optional(),
  reversible: z.boolean(),
}).strict()

export const agentPermissionAuditResultSchema = z.object({
  errorCode: stableCodeSchema.optional(),
  durationMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1_000).optional(),
  dataClasses: z.array(agentDataClassSchema).min(1).max(4).optional(),
}).strict()
export type AgentPermissionAuditResult = z.infer<typeof agentPermissionAuditResultSchema>

export const agentPermissionAuditFactSchema = z.object({
  schemaVersion: z.literal(AGENT_PERMISSION_AUDIT_SCHEMA_VERSION),
  runId: z.string().min(1).max(200),
  toolCallId: z.string().min(1).max(200),
  approvalId: z.string().min(1).max(200).optional(),
  event: agentPermissionAuditEventSchema,
  occurredAt: z.string().datetime(),
  tool: agentPermissionAuditToolSchema,
  authorization: agentPermissionAuditAuthorizationSchema,
  binding: agentPermissionAuditBindingSchema.optional(),
  result: agentPermissionAuditResultSchema.optional(),
}).strict()
export type AgentPermissionAuditFact = z.infer<typeof agentPermissionAuditFactSchema>

export const agentPermissionAuditRecordSchema = agentPermissionAuditFactSchema.extend({
  auditId: z.number().int().positive(),
  outcome: agentPermissionAuditOutcomeSchema,
}).strict()
export type AgentPermissionAuditRecord = z.infer<typeof agentPermissionAuditRecordSchema>

export const agentPermissionAuditQuerySchema = z.object({
  runId: z.string().min(1).max(200),
  toolCallId: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(2_000).default(500),
}).strict()
export type AgentPermissionAuditQuery = z.input<typeof agentPermissionAuditQuerySchema>

export const agentPermissionAuditAppendResultSchema = z.object({
  auditId: z.number().int().positive(),
}).strict()
export type AgentPermissionAuditAppendResult = z.infer<
  typeof agentPermissionAuditAppendResultSchema
>

const outcomeByEvent: Record<AgentPermissionAuditEvent, AgentPermissionAuditOutcome> = {
  approval_requested: 'pending',
  auto_allowed: 'allowed',
  approved: 'approved',
  rejected: 'rejected',
  expired: 'expired',
  consumed: 'consumed',
  binding_failed: 'denied',
  execution_completed: 'succeeded',
  execution_failed: 'failed',
  execution_cached: 'cached',
}

export function permissionAuditOutcomeForEvent(
  event: AgentPermissionAuditEvent
): AgentPermissionAuditOutcome {
  return outcomeByEvent[event]
}
