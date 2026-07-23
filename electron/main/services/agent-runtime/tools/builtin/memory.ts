import { z } from 'zod'

import {
  AGENT_MEMORY_SCHEMA_VERSION,
  agentMemoryCandidateSchema,
  agentMemoryProposalSchema,
  agentMemoryRecordSchema,
} from '../../../../../../src/core/assistant/memory'
import { getAgentMemoryStore } from '../../../assistant/memory'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

export function createAgentMemoryTools(): AgentToolDefinition[] {
  const list = defineAgentTool({
    name: 'list_agent_memories',
    version: 1,
    title: '查看助手记忆',
    description: '查看用户已确认的少量长期记忆和待确认候选；不会返回已删除或过期内容。',
    category: 'memory',
    side: 'backend',
    risk: 'R0',
    permission: 'memory:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 1, baseDelayMs: 50 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({
      enabled: z.boolean(),
      memories: z.array(agentMemoryRecordSchema).max(20),
      candidates: z.array(agentMemoryCandidateSchema).max(20),
    }).strict(),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => {
      const state = getAgentMemoryStore().getState()
      return Promise.resolve({
        enabled: state.settings.enabled,
        memories: state.memories.slice(0, 20),
        candidates: state.candidates.slice(0, 20),
      })
    },
    concurrencyKey: () => 'memory:read',
    targetIds: () => ({}),
    dataClasses: () => ['C1'],
    summarize: (output) => `长期记忆 ${output.memories.length} 条，待确认 ${output.candidates.length} 条。`,
  })

  const propose = defineAgentTool({
    name: 'propose_agent_memory',
    version: 1,
    title: '提出记忆候选',
    description: '仅在用户明确要求长期记住偏好、事实或工作习惯时创建候选；临时要求、模型推断、密钥、完整日志/文件/prompt 禁止写入。',
    category: 'memory',
    side: 'backend',
    risk: 'R1',
    permission: 'memory:propose',
    readOnly: false,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    maxCallsPerRun: 3,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: agentMemoryProposalSchema,
    outputSchema: z.object({
      schemaVersion: z.literal(AGENT_MEMORY_SCHEMA_VERSION),
      candidate: agentMemoryCandidateSchema,
    }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', maxLength: 1000 },
        scope: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['global', 'workspace', 'project'] },
            id: { type: ['string', 'null'] },
          },
          required: ['type', 'id'],
          additionalProperties: false,
        },
        kind: { type: 'string', enum: ['preference', 'fact', 'workflow'] },
        conflictKey: { type: 'string', maxLength: 200 },
        ttlDays: { type: 'integer', minimum: 1, maximum: 365 },
      },
      required: ['content', 'scope', 'kind'],
      additionalProperties: false,
    },
    execute: (input, context) => Promise.resolve({
      schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
      candidate: getAgentMemoryStore().propose(
        context.runId,
        '用户明确要求助手长期记住',
        input
      ),
    }),
    concurrencyKey: () => 'memory:write',
    targetIds: (input) => ({ scope: `${input.scope.type}:${input.scope.id ?? 'global'}` }),
    dataClasses: () => ['C1'],
    summarize: (output) => `已创建记忆候选 ${output.candidate.candidateId}，尚未永久保存。`,
  })

  const confirm = defineAgentTool({
    name: 'confirm_agent_memory',
    version: 1,
    title: '确认长期记忆',
    description: '在用户批准后把明确候选保存为长期记忆；同一 conflictKey 的旧记忆会安全标记为已取代。',
    category: 'memory',
    side: 'backend',
    risk: 'R2',
    permission: 'memory:confirm',
    readOnly: false,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    maxCallsPerRun: 3,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({ candidateId: z.string().min(1) }).strict(),
    outputSchema: z.object({ memory: agentMemoryRecordSchema }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: { candidateId: { type: 'string' } },
      required: ['candidateId'],
      additionalProperties: false,
    },
    preview: (input) => ({
      title: '保存长期记忆',
      summary: `确认保存记忆候选 ${input.candidateId}。`,
      targetIds: { candidateId: input.candidateId },
      reversible: false,
      dataClasses: ['C1'],
    }),
    execute: (input) => Promise.resolve({
      memory: getAgentMemoryStore().confirm(input.candidateId),
    }),
    concurrencyKey: () => 'memory:write',
    targetIds: (input) => ({ candidateId: input.candidateId }),
    dataClasses: () => ['C1'],
    summarize: (output) => `长期记忆 ${output.memory.memoryId} 已保存。`,
  })

  const reject = defineAgentTool({
    name: 'reject_agent_memory',
    version: 1,
    title: '拒绝记忆候选',
    description: '拒绝并关闭明确的记忆候选。',
    category: 'memory',
    side: 'backend',
    risk: 'R1',
    permission: 'memory:reject',
    readOnly: false,
    destructive: true,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({ candidateId: z.string().min(1) }).strict(),
    outputSchema: z.object({ candidateId: z.string(), status: z.literal('rejected') }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: { candidateId: { type: 'string' } },
      required: ['candidateId'],
      additionalProperties: false,
    },
    execute: (input) => {
      getAgentMemoryStore().reject(input.candidateId)
      return Promise.resolve({ candidateId: input.candidateId, status: 'rejected' as const })
    },
    concurrencyKey: () => 'memory:write',
    targetIds: (input) => ({ candidateId: input.candidateId }),
    dataClasses: () => ['C0'],
    summarize: (output) => `记忆候选 ${output.candidateId} 已拒绝。`,
  })

  return [
    eraseToolDefinition(list),
    eraseToolDefinition(propose),
    eraseToolDefinition(confirm),
    eraseToolDefinition(reject),
  ]
}
