import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import type {
  AgentBudgetContinuation,
  AgentStartRunRequest,
} from '../../../../../src/core/assistant/runtimeContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentArtifactStore } from '../context/offload'
import type {
  AgentMemoryContextEntry,
  AgentMemoryRetrievalQuery,
  AgentMemoryRetrievalResult,
} from '../../../../../src/core/assistant/memory'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type {
  AgentSessionCompactionAppend,
  AgentSessionInternalAppend,
} from '../../../../../src/core/assistant/session'
import type { AgentSessionEntry } from '../../../../../src/core/assistant/session'
import type { AgentSavePoint, AgentSavePointAppend } from '../../../../../src/core/assistant/turn'
import type {
  AgentExternalWaitRecord,
  AgentExternalWaitRegister,
} from '../../../../../src/core/assistant/externalWait'
import type {
  AgentThreadTitleContext,
  AgentThreadTitleContextRequest,
  AgentThreadTitleUpdate,
  AgentThreadTitleUpdateResult,
} from '../../../../../src/core/assistant/threadTitle'

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
  retrieveMemory?: (
    query: AgentMemoryRetrievalQuery,
    signal: AbortSignal
  ) => Promise<AgentMemoryRetrievalResult>
  artifactStore?: AgentArtifactStore
  appendSessionCompaction?: (
    input: AgentSessionCompactionAppend
  ) => Promise<AgentSessionEntry | void>
  appendSessionInternal?: (input: AgentSessionInternalAppend) => Promise<AgentSessionEntry>
  appendSavePoint?: (input: AgentSavePointAppend) => Promise<AgentSavePoint>
  consumeCurrentTaskMessages?: (runId: string) => Promise<AgentSessionEntry[]>
  registerExternalWait?: (input: AgentExternalWaitRegister) => Promise<AgentExternalWaitRecord>
  getThreadTitleContext?: (
    input: AgentThreadTitleContextRequest
  ) => Promise<AgentThreadTitleContext>
  updateThreadTitle?: (
    input: AgentThreadTitleUpdate
  ) => Promise<AgentThreadTitleUpdateResult>
  onEvent?: (event: AgentEvent) => void
  onCheckpoint?: (state: AgentRunState) => void
  onTerminal?: (state: AgentRunState) => void
}

export interface AgentRunnerOptions {
  runId: string
  request: AgentStartRunRequest
  memoryContext?: AgentMemoryContextEntry[]
  conversationHistory?: ModelStepMessage[]
  conversationHistorySequences?: number[]
  recoveryContext?: AgentWorkingSummary
  budgetContinuation?: AgentBudgetContinuation
  dependencies: AgentRunnerDependencies
}
