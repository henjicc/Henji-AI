import {
  getUserInstructionsCapability,
  updateUserInstructionsCapability,
} from '../../../../../../src/core/assistant/capabilities/assistantRuntimeApplicationCapabilities'
import {
  getAssistantUserInstructions,
  updateAssistantUserInstructions,
} from '../../../assistant/user-instructions'
import { createBackendCapabilityTool } from '../backend-capability-tool'
import type { AgentToolDefinition } from '../types'

export function createUserInstructionTools(): AgentToolDefinition[] {
  return [
    createBackendCapabilityTool(getUserInstructionsCapability, {
      execute: () => getAssistantUserInstructions(),
    }),
    createBackendCapabilityTool(updateUserInstructionsCapability, {
      execute: (input) => updateAssistantUserInstructions(input),
    }),
  ] as AgentToolDefinition[]
}
