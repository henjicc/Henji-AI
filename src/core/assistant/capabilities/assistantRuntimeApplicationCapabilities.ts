import { z } from 'zod'

import {
  AGENT_ARTIFACT_PAGE_MAX_BYTES,
  agentArtifactPageSchema,
} from '../artifacts'
import {
  AGENT_MEMORY_SCHEMA_VERSION,
  agentMemoryCandidateSchema,
  agentMemoryProposalSchema,
  agentMemoryRecordSchema,
} from '../memory'
import {
  ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS,
  assistantUserInstructionsSchema,
  assistantUserInstructionsUpdateSchema,
} from '../userInstructions'
import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { defineApplicationCapability } from './defineApplicationCapability'

export const diagnosticQueryInputSchema = z.object({
  subjectRequestId: z.string().min(1).max(500).optional(),
  domain: z.string().min(1).max(300).optional(),
  keyword: z.string().min(1).max(200).optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  levels: z.array(z.enum(['trace', 'debug', 'info', 'warn', 'error'])).max(5).optional(),
  limit: z.number().int().min(1).max(16).default(10),
}).strict().superRefine((input, context) => {
  const duration = Date.parse(input.to) - Date.parse(input.from)
  if (duration < 0 || duration > 30 * 60 * 1_000) {
    context.addIssue({ code: 'custom', message: '诊断时间窗必须在 0～30 分钟内' })
  }
})

const diagnosticEvidenceSchema = z.object({
  evidenceId: z.string(),
  timestamp: z.string().datetime(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
  domain: z.string(),
  event: z.string(),
  requestId: z.string().optional(),
  taskId: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  summary: z.string().max(500),
  details: z.record(z.string(), z.string().max(300)).optional(),
}).strict()

export const diagnosticQueryOutputSchema = z.object({
  evidence: z.array(diagnosticEvidenceSchema).max(16),
  truncated: z.boolean(),
  excludedCurrentRun: z.literal(true),
  correlation: z.object({
    strategy: z.enum(['request_id', 'domain_time', 'time_only']),
    confidence: z.enum(['high', 'medium', 'low']),
    scannedPages: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export const readAgentArtifactCapability = defineApplicationCapability({
  id: 'read_agent_artifact',
  version: 1,
  title: '读取助手产物',
  description: '分页读取当前任务中已脱敏的大型结果；有 nextCursor 时继续读取，不确定顶层字段时省略 fields。',
  domain: 'artifacts',
  aliases: ['读取大型结果', '继续读取产物', 'artifact'],
  side: 'backend',
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'artifact:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({
    artifactRef: z.string().min(1).max(500),
    cursor: z.string().min(1).max(200).optional(),
    limitBytes: z.number().int().min(256).max(AGENT_ARTIFACT_PAGE_MAX_BYTES)
      .default(AGENT_ARTIFACT_PAGE_MAX_BYTES),
    fields: z.array(z.string().min(1).max(500)).min(1).max(32).optional()
      .describe('仅允许 Artifact 顶层对象字段；不确定可用字段时省略此参数读取默认内容。'),
  }).strict(),
  outputSchema: agentArtifactPageSchema,
  concurrencyKey: 'artifact:read',
  successEvidence: ['产物引用与当前任务匹配，返回内容已通过脱敏和分页校验。'],
  failureRecovery: [
    '字段无效时只使用错误中列出的可用顶层字段，或省略 fields；引用失效时重新执行产生该引用的查询。',
  ],
  resolveConcurrencyKey: (input) => `artifact:${input.artifactRef}`,
  resolveTargetIds: (input) => ({ artifactRef: input.artifactRef }),
  resolveDataClasses: (output) => output.dataClasses,
  summarize: (output) => `已读取 ${output.returnedBytes}/${output.totalBytes} 字节${output.hasMore ? '，仍有后续内容' : '，已到末页'}。`,
})

export const queryDiagnosticEventsCapability = defineApplicationCapability({
  id: 'query_diagnostic_events',
  version: 1,
  title: '查询诊断事件',
  description: '在明确时间范围内读取与故障有关的脱敏日志证据。',
  domain: 'diagnostics',
  aliases: ['查询日志', '排查失败', '错误原因', 'diagnostics'],
  side: 'backend',
  readOnly: true,
  risk: 'R2',
  dataClasses: ['C2'],
  permission: 'diagnostics:read',
  idempotent: true,
  destructive: false,
  openWorld: true,
  maxCallsPerRun: 1,
  timeoutMs: 10_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: diagnosticQueryInputSchema,
  outputSchema: diagnosticQueryOutputSchema,
  concurrencyKey: 'diagnostics:read',
  successEvidence: ['返回带时间、来源和关联置信度的脱敏诊断证据。'],
  failureRecovery: ['缩小时间范围或提供明确的任务标识后重试。'],
  summarize: (output) => `已读取 ${output.evidence.length} 条诊断证据。`,
})

export const getUserInstructionsCapability = defineApplicationCapability({
  id: 'get_user_instructions',
  version: 1,
  title: '读取用户指令',
  description: '读取用户主动维护的长期偏好与工作习惯。',
  domain: 'user_instructions',
  aliases: ['我的偏好', '用户指令', '工作习惯'],
  side: 'backend',
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'assistant_user_instructions:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({}).strict(),
  outputSchema: assistantUserInstructionsSchema,
  concurrencyKey: 'assistant_user_instructions',
  summarize: (output) => output.content ? '已读取用户指令。' : '用户尚未填写助手指令。',
})

export const updateUserInstructionsCapability = defineApplicationCapability({
  id: 'update_user_instructions',
  version: 1,
  title: '更新用户指令',
  description: '在用户明确要求后更新长期偏好，并保留无关条目。',
  domain: 'user_instructions',
  aliases: ['记住我的偏好', '更新用户指令', '长期习惯'],
  side: 'backend',
  readOnly: false,
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'assistant_user_instructions:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: assistantUserInstructionsUpdateSchema,
  outputSchema: assistantUserInstructionsSchema,
  concurrencyKey: 'assistant_user_instructions',
  aiInputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', maxLength: ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS },
    },
    required: ['content'],
    additionalProperties: false,
  },
  preview: (input) => ({
    title: '更新用户指令',
    summary: `保存 ${input.content.length} 个字符的长期偏好。`,
    targetIds: { instructions: 'assistant-user-instructions' },
    reversible: false,
    dataClasses: ['C1'],
  }),
  resolveTargetIds: () => ({ instructions: 'assistant-user-instructions' }),
  summarize: (output) => output.content ? '已更新用户指令。' : '已清空用户指令。',
})

export const listAgentMemoriesCapability = defineApplicationCapability({
  id: 'list_agent_memories',
  version: 1,
  title: '查看助手记忆',
  description: '查看已确认的长期记忆和等待确认的候选。',
  domain: 'memory',
  aliases: ['查看记忆', '长期记忆', '待确认记忆'],
  side: 'backend',
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'memory:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({
    enabled: z.boolean(),
    memories: z.array(agentMemoryRecordSchema).max(20),
    candidates: z.array(agentMemoryCandidateSchema).max(20),
  }).strict(),
  concurrencyKey: 'memory:read',
  summarize: (output) => `长期记忆 ${output.memories.length} 条，待确认 ${output.candidates.length} 条。`,
})

export const proposeAgentMemoryCapability = defineApplicationCapability({
  id: 'propose_agent_memory',
  version: 1,
  title: '提出记忆候选',
  description: '仅在用户明确要求长期记住内容时创建待确认候选。',
  domain: 'memory',
  aliases: ['记住这件事', '保存偏好候选', '长期记忆候选'],
  side: 'backend',
  readOnly: false,
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'memory:propose',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: agentMemoryProposalSchema,
  outputSchema: z.object({
    schemaVersion: z.literal(AGENT_MEMORY_SCHEMA_VERSION),
    candidate: agentMemoryCandidateSchema,
  }).strict(),
  concurrencyKey: 'memory:write',
  resolveTargetIds: (input) => ({ scope: `${input.scope.type}:${input.scope.id ?? 'global'}` }),
  summarize: () => '已创建待确认的记忆候选。',
})

export const confirmAgentMemoryCapability = defineApplicationCapability({
  id: 'confirm_agent_memory',
  version: 1,
  title: '确认长期记忆',
  description: '在用户批准后将明确的候选保存为长期记忆。',
  domain: 'memory',
  aliases: ['确认记忆', '保存长期记忆'],
  side: 'backend',
  readOnly: false,
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'memory:confirm',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({ candidateId: z.string().min(1) }).strict(),
  outputSchema: z.object({ memory: agentMemoryRecordSchema }).strict(),
  concurrencyKey: 'memory:write',
  preview: (input) => ({
    title: '保存长期记忆',
    summary: '确认保存这条记忆候选。',
    targetIds: { candidateId: input.candidateId },
    reversible: false,
    dataClasses: ['C1'],
  }),
  resolveTargetIds: (input) => ({ candidateId: input.candidateId }),
  summarize: () => '长期记忆已保存。',
})

export const rejectAgentMemoryCapability = defineApplicationCapability({
  id: 'reject_agent_memory',
  version: 1,
  title: '拒绝记忆候选',
  description: '拒绝并关闭明确的记忆候选。',
  domain: 'memory',
  aliases: ['不要记住', '拒绝记忆'],
  side: 'backend',
  readOnly: false,
  risk: 'R1',
  dataClasses: ['C0'],
  permission: 'memory:reject',
  idempotent: true,
  destructive: true,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({ candidateId: z.string().min(1) }).strict(),
  outputSchema: z.object({
    candidateId: z.string(),
    status: z.literal('rejected'),
  }).strict(),
  concurrencyKey: 'memory:write',
  resolveTargetIds: (input) => ({ candidateId: input.candidateId }),
  summarize: () => '记忆候选已拒绝。',
})

export const ASSISTANT_RUNTIME_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  readAgentArtifactCapability,
  queryDiagnosticEventsCapability,
  getUserInstructionsCapability,
  updateUserInstructionsCapability,
  listAgentMemoriesCapability,
  proposeAgentMemoryCapability,
  confirmAgentMemoryCapability,
  rejectAgentMemoryCapability,
]
