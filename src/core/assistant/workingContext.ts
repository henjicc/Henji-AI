import { z } from 'zod'

import { hostScopeRevisionsSchema } from './hostContracts'

export const AGENT_WORKING_SUMMARY_VERSION = 'agent-working-summary/v1' as const

export const agentWorkingStepSchema = z.object({
  stepId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  status: z.enum(['active', 'completed', 'failed']),
  toolName: z.string().min(1).max(200).nullable(),
  toolCategory: z.string().min(1).max(100).nullable(),
  readOnly: z.boolean().nullable(),
  idempotent: z.boolean().nullable(),
  summary: z.string().max(1_000),
  evidence: z.array(z.string().min(1).max(500)).max(8),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict()
export type AgentWorkingStep = z.infer<typeof agentWorkingStepSchema>

export const agentWorkingEvidenceSchema = z.object({
  source: z.string().min(1).max(200),
  summary: z.string().min(1).max(1_000),
  references: z.record(z.string(), z.string().max(500)),
  observedAt: z.string().datetime(),
}).strict()
export type AgentWorkingEvidence = z.infer<typeof agentWorkingEvidenceSchema>

export const agentPendingApprovalSummarySchema = z.object({
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  expiresAt: z.string().datetime(),
}).strict()

export const agentWorkingRecoverySchema = z.object({
  mode: z.enum(['none', 'resume_read_only', 'verify_before_write', 'await_user']),
  reason: z.string().max(1_000),
  toolName: z.string().min(1).max(200).nullable(),
  toolCategory: z.string().min(1).max(100).nullable(),
}).strict()
export type AgentWorkingRecovery = z.infer<typeof agentWorkingRecoverySchema>

export const agentWorkingSummarySchema = z.object({
  version: z.literal(AGENT_WORKING_SUMMARY_VERSION),
  goal: z.string().min(1).max(32 * 1024),
  route: z.object({
    intent: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    toolDomains: z.array(z.string().min(1).max(100)).max(8),
  }).strict().nullable(),
  planVersion: z.number().int().nonnegative(),
  activeStep: agentWorkingStepSchema.nullable(),
  completedSteps: z.array(agentWorkingStepSchema).max(20),
  failedSteps: z.array(agentWorkingStepSchema).max(10),
  evidence: z.array(agentWorkingEvidenceSchema).max(12),
  pendingApprovals: z.array(agentPendingApprovalSummarySchema).max(4),
  unresolvedItems: z.array(z.string().min(1).max(1_000)).max(10),
  scopeRevisions: hostScopeRevisionsSchema.nullable(),
  artifactRefs: z.array(z.string().min(1).max(500)).max(12),
  recovery: agentWorkingRecoverySchema,
  updatedAt: z.string().datetime(),
}).strict()
export type AgentWorkingSummary = z.infer<typeof agentWorkingSummarySchema>

export function createAgentWorkingSummary(goal: string): AgentWorkingSummary {
  return agentWorkingSummarySchema.parse({
    version: AGENT_WORKING_SUMMARY_VERSION,
    goal,
    route: null,
    planVersion: 0,
    activeStep: null,
    completedSteps: [],
    failedSteps: [],
    evidence: [],
    pendingApprovals: [],
    unresolvedItems: [],
    scopeRevisions: null,
    artifactRefs: [],
    recovery: {
      mode: 'none',
      reason: '',
      toolName: null,
      toolCategory: null,
    },
    updatedAt: new Date().toISOString(),
  })
}
