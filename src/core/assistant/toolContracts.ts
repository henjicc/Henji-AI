import { z } from 'zod'

import { agentApprovalRequestSchema } from './events'

export const agentToolRiskSchema = z.enum(['R0', 'R1', 'R2', 'R3', 'R4'])
export type AgentToolRisk = z.infer<typeof agentToolRiskSchema>

export const agentDataClassSchema = z.enum(['C0', 'C1', 'C2', 'C3'])
export type AgentDataClass = z.infer<typeof agentDataClassSchema>

export const agentToolSideSchema = z.enum(['frontend', 'backend'])
export type AgentToolSide = z.infer<typeof agentToolSideSchema>

export const agentToolErrorCodeSchema = z.enum([
  'UNKNOWN_TOOL',
  'VERSION_MISMATCH',
  'INVALID_INPUT',
  'INVALID_OUTPUT',
  'PERMISSION_DENIED',
  'APPROVAL_REQUIRED',
  'APPROVAL_INVALID',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'STALE_CONTEXT',
  'NOT_FOUND',
  'NOT_READY',
  'CONFLICT',
  'TIMEOUT',
  'CANCELLED',
  'RESULT_TOO_LARGE',
  'EXECUTION_FAILED',
])
export type AgentToolErrorCode = z.infer<typeof agentToolErrorCodeSchema>

export const agentToolErrorSchema = z.object({
  code: agentToolErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  recovery: z.enum(['refresh_context', 'request_approval', 'wait', 'user_action', 'none']),
}).strict()
export type AgentToolError = z.infer<typeof agentToolErrorSchema>

export const agentToolPreviewSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2_000),
  targetIds: z.record(z.string(), z.string()),
  reversible: z.boolean(),
  dataClasses: z.array(agentDataClassSchema).max(4),
  destination: z.string().max(500).optional(),
}).strict()
export type AgentToolPreview = z.infer<typeof agentToolPreviewSchema>

export const agentToolObservationSchema = z.object({
  source: z.object({
    toolName: z.string().min(1),
    toolVersion: z.number().int().positive(),
    toolCallId: z.string().min(1),
  }).strict(),
  trust: z.literal('untrusted_observation'),
  dataClasses: z.array(agentDataClassSchema).max(4),
  summary: z.string().max(2_000),
  output: z.unknown(),
  artifactRef: z.string().min(1).optional(),
  undo: z.object({
    kind: z.string().min(1),
    token: z.string().min(1),
  }).strict().optional(),
}).strict()
export type AgentToolObservation = z.infer<typeof agentToolObservationSchema>

export const agentToolGatewayResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('approval_required'),
    approval: agentApprovalRequestSchema,
  }).strict(),
  z.object({
    status: z.literal('completed'),
    observation: agentToolObservationSchema,
    cached: z.boolean(),
  }).strict(),
])
export type AgentToolGatewayResult = z.infer<typeof agentToolGatewayResultSchema>

export const agentToolCatalogEntrySchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  side: agentToolSideSchema,
  risk: agentToolRiskSchema,
  permission: z.string().min(1),
  readOnly: z.boolean(),
  supportsPreview: z.boolean(),
  supportsUndo: z.boolean(),
  whenToUse: z.array(z.string().min(1).max(500)).max(6),
  avoidWhen: z.array(z.string().min(1).max(500)).max(6),
  prerequisites: z.array(z.string().min(1).max(500)).max(8),
  outputs: z.array(z.string().min(1).max(500)).max(8),
  successEvidence: z.array(z.string().min(1).max(500)).max(8),
  failureRecovery: z.array(z.string().min(1).max(500)).max(8),
  parallelSafe: z.boolean(),
}).strict()
export type AgentToolCatalogEntry = z.infer<typeof agentToolCatalogEntrySchema>
