import { z } from 'zod'

import { agentDataClassSchema } from './toolContracts'

export const AGENT_ARTIFACT_SCHEMA_VERSION = 'agent-artifact/v1' as const
export const AGENT_ARTIFACT_PAGE_MAX_BYTES = 4 * 1024

export const agentArtifactDescriptorSchema = z.object({
  schemaVersion: z.literal(AGENT_ARTIFACT_SCHEMA_VERSION),
  artifactRef: z.string().min(1).max(500),
  source: z.string().min(1).max(500),
  dataClasses: z.array(agentDataClassSchema).min(1).max(4),
  createdAt: z.string().datetime(),
  originalBytes: z.number().int().nonnegative(),
  rootKind: z.enum(['array', 'object', 'value']),
  topLevelFields: z.array(z.string().min(1).max(500)).max(100),
}).strict()
export type AgentArtifactDescriptor = z.infer<typeof agentArtifactDescriptorSchema>

export const agentArtifactDescribeRequestSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1),
  artifactRef: z.string().min(1).max(500),
}).strict()
export type AgentArtifactDescribeRequest = z.infer<typeof agentArtifactDescribeRequestSchema>

export const agentArtifactReadRequestSchema = agentArtifactDescribeRequestSchema.extend({
  cursor: z.string().min(1).max(200).optional(),
  limitBytes: z.number().int().min(256).max(AGENT_ARTIFACT_PAGE_MAX_BYTES).default(AGENT_ARTIFACT_PAGE_MAX_BYTES),
  fields: z.array(z.string().min(1).max(500)).min(1).max(32).optional(),
}).strict()
export type AgentArtifactReadRequest = z.infer<typeof agentArtifactReadRequestSchema>

export const agentArtifactPageSchema = z.object({
  schemaVersion: z.literal(AGENT_ARTIFACT_SCHEMA_VERSION),
  artifactRef: z.string().min(1).max(500),
  source: z.string().min(1).max(500),
  dataClasses: z.array(agentDataClassSchema).min(1).max(4),
  contentEncoding: z.literal('json-fragment'),
  content: z.string().max(AGENT_ARTIFACT_PAGE_MAX_BYTES),
  returnedBytes: z.number().int().nonnegative().max(AGENT_ARTIFACT_PAGE_MAX_BYTES),
  totalBytes: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).max(200).nullable(),
  hasMore: z.boolean(),
  selectedFields: z.array(z.string().min(1).max(500)).max(32),
}).strict()
export type AgentArtifactPage = z.infer<typeof agentArtifactPageSchema>
