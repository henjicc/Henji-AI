import { z } from 'zod'

import {
  AGENT_ARTIFACT_PAGE_MAX_BYTES,
  agentArtifactDescriptorSchema,
  agentArtifactPageSchema,
  agentArtifactReadRequestSchema,
  type AgentArtifactDescribeRequest,
  type AgentArtifactDescriptor,
  type AgentArtifactPage,
  type AgentArtifactReadRequest,
} from '../../../../../../src/core/assistant/artifacts'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'

export interface AgentArtifactToolAccess {
  describe: (request: AgentArtifactDescribeRequest) => Promise<AgentArtifactDescriptor> | AgentArtifactDescriptor
  read: (request: AgentArtifactReadRequest) => Promise<AgentArtifactPage> | AgentArtifactPage
}

export function createAgentArtifactTools(
  access: AgentArtifactToolAccess
): AgentToolDefinition[] {
  const readArtifact = defineAgentTool({
    name: 'read_agent_artifact',
    version: 1,
    title: '分页读取助手产物',
    description: '按当前运行产生的 artifactRef 分页读取已脱敏的大型工具结果。只接受受控游标和顶层字段名，不接受文件路径、SQL、JSONPath 或任意查询表达式。',
    semantics: {
      whenToUse: ['上下文中的大型工具结果已被替换为 artifactRef，且必须查看其中未展示的事实时使用。'],
      avoidWhen: ['已有摘要足以继续时不要读取；不得尝试读取其他 run 或 thread 的引用。'],
      outputs: ['返回最多 4 KiB 的 UTF-8 JSON 片段、稳定 nextCursor、总字节数和是否还有后续页。'],
      successEvidence: ['artifactRef 与当前 run/thread 匹配，且返回内容通过数据分级、字段和分页边界校验。'],
      completionKind: 'observed',
      parallelSafe: true,
    },
    category: 'artifacts',
    side: 'backend',
    risk: 'R0',
    permission: 'artifact:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 1, baseDelayMs: 50 },
    supportsPreview: true,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({
      artifactRef: z.string().min(1).max(500),
      cursor: z.string().min(1).max(200).optional(),
      limitBytes: z.number().int().min(256).max(AGENT_ARTIFACT_PAGE_MAX_BYTES)
        .default(AGENT_ARTIFACT_PAGE_MAX_BYTES),
      fields: z.array(z.string().min(1).max(500)).min(1).max(32).optional(),
    }).strict(),
    outputSchema: agentArtifactPageSchema,
    aiInputSchema: {
      type: 'object',
      properties: {
        artifactRef: { type: 'string' },
        cursor: { type: 'string' },
        limitBytes: {
          type: 'integer',
          minimum: 256,
          maximum: AGENT_ARTIFACT_PAGE_MAX_BYTES,
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 32,
        },
      },
      required: ['artifactRef'],
      additionalProperties: false,
    },
    preview: async (input, context) => {
      const descriptor = agentArtifactDescriptorSchema.parse(await access.describe({
        runId: context.runId,
        threadId: context.threadId,
        artifactRef: input.artifactRef,
      }))
      return {
        title: '读取助手产物',
        summary: `读取 ${descriptor.artifactRef} 的受控分页内容；原始大小 ${descriptor.originalBytes} 字节。`,
        targetIds: { artifactRef: descriptor.artifactRef },
        reversible: false,
        dataClasses: descriptor.dataClasses,
        ...(descriptor.dataClasses.includes('C2')
          ? { destination: '当前 Agent 模型上下文' }
          : {}),
      }
    },
    execute: async (input, context) => agentArtifactPageSchema.parse(await access.read(
      agentArtifactReadRequestSchema.parse({
        runId: context.runId,
        threadId: context.threadId,
        ...input,
      })
    )),
    concurrencyKey: (input) => `artifact:${input.artifactRef}`,
    targetIds: (input) => ({ artifactRef: input.artifactRef }),
    dataClasses: (output) => output.dataClasses,
    summarize: (output) => (
      `已读取 Artifact ${output.artifactRef} 的 ${output.returnedBytes}/${output.totalBytes} 字节${output.hasMore ? '，仍有后续页' : '，已到末页'}。`
    ),
  })

  return [readArtifact as unknown as AgentToolDefinition]
}
