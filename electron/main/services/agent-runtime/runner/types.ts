import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import type { AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentArtifactStore } from '../context/offload'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'

export type AgentModelStepExecutor = (
  input: ModelStepInput,
  emit: (event: ModelStepEvent) => void
) => Promise<ModelStepResult>

export interface AgentRunnerDependencies {
  registry: AgentToolRegistry
  gateway: AgentToolGateway
  getHostContext: (runId: string) => HostContextSnapshot | null
  runModelStep: AgentModelStepExecutor
  cancelModelStep: (requestId: string) => void
  artifactStore?: AgentArtifactStore
  onEvent?: (event: AgentEvent) => void
  onCheckpoint?: (state: AgentRunState) => void
  onTerminal?: (state: AgentRunState) => void
}

export interface AgentRunnerOptions {
  runId: string
  request: AgentStartRunRequest
  memoryContext?: AgentMemoryContextEntry[]
  dependencies: AgentRunnerDependencies
}
