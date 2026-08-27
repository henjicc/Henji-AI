import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '@henjicc/ai-sdk'
import type { AgentToolRegistry } from '../tools/registry'
import { AgentModelOutputGuard } from './model-output-guard'
import type { AgentRuntimeModel } from './models'
import { AgentThreadTitleCoordinator } from './thread-title-coordinator'
import type { AgentModelStepExecutor, AgentRunnerDependencies } from './types'

export function createRunnerModelOutputGuard(input: {
  registry: AgentToolRegistry
  emit: (event: AgentEventInput) => void
  onObservation: (call: ModelStepToolCall, observation: AgentToolObservation) => void
  onRecoveryMessage: (message: string) => void
}): AgentModelOutputGuard {
  return new AgentModelOutputGuard(input)
}

export function createRunnerThreadTitleCoordinator(input: {
  runId: string
  threadId: string
  model: AgentRuntimeModel
  runModelStep: AgentModelStepExecutor
  getContext: AgentRunnerDependencies['getThreadTitleContext']
  updateTitle: AgentRunnerDependencies['updateThreadTitle']
}): AgentThreadTitleCoordinator {
  return new AgentThreadTitleCoordinator(input)
}
