import { z } from 'zod'

import { agentTaskFacetStatusSchema } from './taskGraph'

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
  evidence: z.array(z.string().min(1).max(500)).max(12),
  executionFingerprint: z.string().min(1).max(200).optional(),
  blocker: z.string().min(1).max(1_000).optional(),
}).strict()
export type AgentFacetProgress = z.infer<typeof agentFacetProgressSchema>

export const agentProgressSettlementSchema = z.object({
  status: z.enum(['active', 'completed', 'partial', 'blocked', 'waiting_user']),
  completedFacetIds: z.array(z.string().min(1).max(64)).max(16),
  blockedFacets: z.array(z.object({
    facetId: z.string().min(1).max(64),
    reason: z.string().min(1).max(1_000),
  }).strict()).max(16),
  waitingFacetIds: z.array(z.string().min(1).max(64)).max(16),
  remainingFacetIds: z.array(z.string().min(1).max(64)).max(16),
  evidence: z.array(z.string().min(1).max(500)).max(24),
  summary: z.string().min(1).max(2_000),
  suggestedNextStep: z.string().min(1).max(1_000).nullable(),
}).strict()
export type AgentProgressSettlement = z.infer<typeof agentProgressSettlementSchema>
