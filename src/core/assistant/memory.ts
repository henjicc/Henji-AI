import { z } from 'zod'

/** 一次读取最多返回多少条记忆与候选。处理器截断与能力输出 schema 必须共用这一份。 */
export const AGENT_MEMORY_LIST_LIMIT = 20

export const AGENT_MEMORY_SCHEMA_VERSION = 'agent-memory/v1' as const

export const agentMemoryScopeSchema = z.object({
  type: z.enum(['global', 'workspace', 'project']),
  id: z.string().min(1).max(300).nullable(),
}).strict().superRefine((scope, context) => {
  if (scope.type === 'global' && scope.id !== null) {
    context.addIssue({ code: 'custom', message: '全局记忆不能包含 scope id' })
  }
  if (scope.type !== 'global' && scope.id === null) {
    context.addIssue({ code: 'custom', message: '工作区或项目记忆必须包含 scope id' })
  }
})
export type AgentMemoryScope = z.infer<typeof agentMemoryScopeSchema>

export const agentMemoryKindSchema = z.enum(['preference', 'fact', 'workflow'])
export type AgentMemoryKind = z.infer<typeof agentMemoryKindSchema>

export const agentMemoryLayerSchema = z.enum([
  'confirmed_preference',
  'project_knowledge',
  'workflow_knowledge',
])
export type AgentMemoryLayer = z.infer<typeof agentMemoryLayerSchema>

const memoryContentSchema = z.string().min(1).max(1_000)
  .refine((value) => !value.includes('\0'), '记忆内容不能包含空字符')

export const agentMemorySettingsSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_SCHEMA_VERSION),
  enabled: z.boolean(),
  defaultTtlDays: z.number().int().min(1).max(365),
  updatedAt: z.string().datetime(),
}).strict()
export type AgentMemorySettings = z.infer<typeof agentMemorySettingsSchema>

export const agentMemoryRecordSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_SCHEMA_VERSION),
  memoryId: z.string().min(1),
  scope: agentMemoryScopeSchema,
  kind: agentMemoryKindSchema,
  content: memoryContentSchema,
  sourceRunId: z.string().min(1).nullable(),
  sourceLabel: z.string().min(1).max(200),
  sensitivity: z.enum(['C0', 'C1']),
  status: z.enum(['active', 'superseded', 'deleted']),
  conflictKey: z.string().min(1).max(200).nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()
export type AgentMemoryRecord = z.infer<typeof agentMemoryRecordSchema>

export const agentMemoryCandidateSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_SCHEMA_VERSION),
  candidateId: z.string().min(1),
  scope: agentMemoryScopeSchema,
  kind: agentMemoryKindSchema,
  content: memoryContentSchema,
  sourceRunId: z.string().min(1),
  sourceLabel: z.string().min(1).max(200),
  conflictKey: z.string().min(1).max(200).nullable(),
  status: z.enum(['pending', 'confirmed', 'rejected', 'expired']),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
}).strict()
export type AgentMemoryCandidate = z.infer<typeof agentMemoryCandidateSchema>

export const agentMemoryStateSchema = z.object({
  settings: agentMemorySettingsSchema,
  memories: z.array(agentMemoryRecordSchema).max(200),
  candidates: z.array(agentMemoryCandidateSchema).max(100),
}).strict()
export type AgentMemoryState = z.infer<typeof agentMemoryStateSchema>

export const agentMemorySettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  defaultTtlDays: z.number().int().min(1).max(365).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '至少更新一项记忆设置')
export type AgentMemorySettingsUpdate = z.infer<typeof agentMemorySettingsUpdateSchema>

export const agentMemoryProposalSchema = z.object({
  content: memoryContentSchema,
  scope: agentMemoryScopeSchema,
  kind: agentMemoryKindSchema,
  conflictKey: z.string().min(1).max(200).optional(),
  ttlDays: z.number().int().min(1).max(365).optional(),
}).strict()
export type AgentMemoryProposal = z.infer<typeof agentMemoryProposalSchema>

export const agentMemoryUpdateSchema = z.object({
  memoryId: z.string().min(1),
  content: memoryContentSchema.optional(),
  ttlDays: z.number().int().min(1).max(365).nullable().optional(),
}).strict().refine((value) => value.content !== undefined || value.ttlDays !== undefined, '至少更新一项记忆内容')
export type AgentMemoryUpdate = z.infer<typeof agentMemoryUpdateSchema>

export const agentMemoryIdSchema = z.object({
  memoryId: z.string().min(1),
}).strict()

export const agentMemoryCandidateIdSchema = z.object({
  candidateId: z.string().min(1),
}).strict()

export const agentMemoryClearSchema = z.object({
  scope: agentMemoryScopeSchema.optional(),
}).strict()

export const agentMemoryContextEntrySchema = agentMemoryRecordSchema.pick({
  memoryId: true,
  scope: true,
  kind: true,
  content: true,
  sourceLabel: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
}).extend({
  layer: agentMemoryLayerSchema.optional(),
  score: z.number().finite().optional(),
  retrievalReasons: z.array(z.string().min(1).max(200)).max(8).optional(),
}).strict()
export type AgentMemoryContextEntry = z.infer<typeof agentMemoryContextEntrySchema>

export const agentMemoryRetrievalQuerySchema = z.object({
  goal: z.string().min(1).max(32 * 1024),
  workspaceId: z.string().min(1).max(300),
  projectId: z.string().min(1).max(300).nullable(),
  intent: z.string().min(1).max(100).optional(),
  toolDomains: z.array(z.string().min(1).max(100)).max(8).default([]),
  stepSignals: z.array(z.string().min(1).max(300)).max(12).default([]),
  limit: z.number().int().min(1).max(10).default(6),
}).strict()
export type AgentMemoryRetrievalQuery = z.infer<typeof agentMemoryRetrievalQuerySchema>

export const agentMemoryRetrievalResultSchema = z.object({
  entries: z.array(agentMemoryContextEntrySchema).max(10),
  consideredCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  exclusionReasons: z.array(z.string().min(1).max(300)).max(8),
  retrievedAt: z.string().datetime(),
}).strict()
export type AgentMemoryRetrievalResult = z.infer<typeof agentMemoryRetrievalResultSchema>
