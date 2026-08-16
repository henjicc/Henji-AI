import { z } from 'zod'

import { agentDataClassSchema } from './toolContracts'

export const AGENT_ARTIFACT_SCHEMA_VERSION = 'agent-artifact/v1' as const
/**
 * 单页 4KB 在实测里是灾难：一份 80KB 的实体结构文档要读 20 轮，而整次运行的轮次预算才 32。
 * 模型读到一半就理性放弃，于是"想改关键帧但拿不到属性结构"变成必然。
 * 32KB 一页把同一份文档压到 3 轮，仍然远小于任何现代模型的单条消息上限。
 */
export const AGENT_ARTIFACT_PAGE_MAX_BYTES = 32 * 1024

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
  /**
   * 请求了但这份 Artifact 里没有的顶层字段。
   *
   * 模型并不知道 artifact 的确切形状，猜错字段名是必然会发生的事。整单拒绝会让它换一串
   * 继续猜——实测某个模型因此重复 10 次直到运行被判死。如实回报缺哪些，它一次就能修正。
   */
  missingFields: z.array(z.string().min(1).max(500)).max(32).default([]),
}).strict()
export type AgentArtifactPage = z.infer<typeof agentArtifactPageSchema>
