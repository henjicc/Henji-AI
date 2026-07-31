import {
  agentArtifactDescriptorSchema,
  agentArtifactPageSchema,
  agentArtifactReadRequestSchema,
  type AgentArtifactDescribeRequest,
  type AgentArtifactDescriptor,
  type AgentArtifactPage,
  type AgentArtifactReadRequest,
} from '../../../../../../src/core/assistant/artifacts'
import {
  readAgentArtifactCapability,
} from '../../../../../../src/core/assistant/capabilities/assistantRuntimeApplicationCapabilities'
import { createBackendCapabilityTool } from '../backend-capability-tool'
import type { AgentToolDefinition } from '../types'

export interface AgentArtifactToolAccess {
  describe: (request: AgentArtifactDescribeRequest) => Promise<AgentArtifactDescriptor> | AgentArtifactDescriptor
  read: (request: AgentArtifactReadRequest) => Promise<AgentArtifactPage> | AgentArtifactPage
}

export function createAgentArtifactTools(
  access: AgentArtifactToolAccess
): AgentToolDefinition[] {
  return [createBackendCapabilityTool(readAgentArtifactCapability, {
    preview: async (input, context) => {
      const descriptor = agentArtifactDescriptorSchema.parse(await access.describe({
        runId: context.runId,
        threadId: context.threadId,
        artifactRef: input.artifactRef,
      }))
      return {
        title: '读取助手产物',
        summary: `读取当前任务中 ${descriptor.originalBytes} 字节的大型结果。`,
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
  }) as AgentToolDefinition]
}
