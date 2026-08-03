import { z } from 'zod'

import { AGENT_TASK_FACET_LIMIT, agentTaskFacetStatusSchema } from './taskGraph'

/** 单个 Facet 进度携带的证据条数上限，运行时截断必须用同一个值。 */
export const AGENT_FACET_EVIDENCE_LIMIT = 12
/** 整次结算汇总的证据条数上限。 */
export const AGENT_SETTLEMENT_EVIDENCE_LIMIT = 24

export const agentFacetProgressKindSchema = z.enum([
  'revision_changed',
  'verification_improved',
  'schema_discovered',
  'external_wait_started',
  'user_input_received',
  'facet_completed',
  'no_change',
  'repeated_discovery',
  'repeated_write',
  'repeated_failure',
  'capability_missing',
  'permission_blocked',
  'revision_conflict',
  'waiting_user',
])
export type AgentFacetProgressKind = z.infer<typeof agentFacetProgressKindSchema>

export const agentFacetProgressSchema = z.object({
  facetId: z.string().min(1).max(64),
  status: agentTaskFacetStatusSchema,
  kind: agentFacetProgressKindSchema,
  summary: z.string().min(1).max(1_000),
  evidence: z.array(z.string().min(1).max(500)).max(AGENT_FACET_EVIDENCE_LIMIT),
  executionFingerprint: z.string().min(1).max(200).optional(),
  blocker: z.string().min(1).max(1_000).optional(),
}).strict()
export type AgentFacetProgress = z.infer<typeof agentFacetProgressSchema>

export const agentProgressSettlementSchema = z.object({
  status: z.enum(['active', 'completed', 'partial', 'blocked', 'waiting_user']),
  completedFacetIds: z.array(z.string().min(1).max(64)).max(AGENT_TASK_FACET_LIMIT),
  blockedFacets: z.array(z.object({
    facetId: z.string().min(1).max(64),
    reason: z.string().min(1).max(1_000),
  }).strict()).max(AGENT_TASK_FACET_LIMIT),
  waitingFacetIds: z.array(z.string().min(1).max(64)).max(AGENT_TASK_FACET_LIMIT),
  remainingFacetIds: z.array(z.string().min(1).max(64)).max(AGENT_TASK_FACET_LIMIT),
  evidence: z.array(z.string().min(1).max(500)).max(AGENT_SETTLEMENT_EVIDENCE_LIMIT),
  summary: z.string().min(1).max(2_000),
  suggestedNextStep: z.string().min(1).max(1_000).nullable(),
}).strict()
export type AgentProgressSettlement = z.infer<typeof agentProgressSettlementSchema>
