import {
  AGENT_MEMORY_LIST_LIMIT,
  AGENT_MEMORY_SCHEMA_VERSION,
} from '../../../../../../src/core/assistant/memory'
import {
  confirmAgentMemoryCapability,
  listAgentMemoriesCapability,
  proposeAgentMemoryCapability,
  rejectAgentMemoryCapability,
} from '../../../../../../src/core/assistant/capabilities/assistantRuntimeApplicationCapabilities'
import { getAgentMemoryStore } from '../../../assistant/memory'
import { createBackendCapabilityTool } from '../backend-capability-tool'
import type { AgentToolDefinition } from '../types'

export function createAgentMemoryTools(): AgentToolDefinition[] {
  return [
    createBackendCapabilityTool(listAgentMemoriesCapability, {
      execute: async () => {
        const state = getAgentMemoryStore().getState()
        return {
          enabled: state.settings.enabled,
          memories: state.memories.slice(0, AGENT_MEMORY_LIST_LIMIT),
          candidates: state.candidates.slice(0, AGENT_MEMORY_LIST_LIMIT),
        }
      },
    }),
    createBackendCapabilityTool(proposeAgentMemoryCapability, {
      execute: async (input, context) => ({
        schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
        candidate: getAgentMemoryStore().propose(
          context.runId,
          '用户明确要求助手长期记住',
          input
        ),
      }),
    }),
    createBackendCapabilityTool(confirmAgentMemoryCapability, {
      execute: async (input) => ({
        memory: getAgentMemoryStore().confirm(input.candidateId),
      }),
    }),
    createBackendCapabilityTool(rejectAgentMemoryCapability, {
      execute: async (input) => {
        getAgentMemoryStore().reject(input.candidateId)
        return { candidateId: input.candidateId, status: 'rejected' as const }
      },
    }),
  ] as AgentToolDefinition[]
}
