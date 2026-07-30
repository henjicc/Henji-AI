import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '@/core/assistant/hostContracts'
import type { AgentRunState } from '@/core/assistant/events'
import type {
  AssistantUserInstructions,
  AssistantUserInstructionsUpdate,
} from '@/core/assistant/userInstructions'
import type {
  AgentApprovalResponse,
  AgentCancelRunRequest,
  AgentRunControlRequest,
  AgentRunEventsPage,
  AgentRunEventsRequest,
  AgentRuntimeEventPayload,
  AgentRunSnapshot,
  AgentStartRunRequest,
  AgentStartRunResult,
} from '@/core/assistant/runtimeContracts'
import type {
  AgentListRunsRequest,
  AgentRetryRunRequest,
  AgentRunSummary,
} from '@/core/assistant/persistence'
import type {
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySettings,
  AgentMemorySettingsUpdate,
  AgentMemoryState,
  AgentMemoryUpdate,
} from '@/core/assistant/memory'

export interface AssistantPlatform {
  getUserInstructions(): Promise<AssistantUserInstructions>
  updateUserInstructions(update: AssistantUserInstructionsUpdate): Promise<AssistantUserInstructions>
  resetUserInstructions(): Promise<AssistantUserInstructions>
  openUserInstructionsFile(): Promise<string>
  getMemoryState(): Promise<AgentMemoryState>
  updateMemorySettings(update: AgentMemorySettingsUpdate): Promise<AgentMemorySettings>
  updateMemory(update: AgentMemoryUpdate): Promise<AgentMemoryRecord>
  confirmMemoryCandidate(candidateId: string): Promise<AgentMemoryRecord>
  rejectMemoryCandidate(candidateId: string): Promise<void>
  deleteMemory(memoryId: string): Promise<void>
  clearMemories(scope?: AgentMemoryScope): Promise<number>
  publishHostContext(snapshot: HostContextSnapshot): Promise<void>
  acknowledgeFrontendTool(acknowledgement: FrontendToolAcknowledgement): Promise<void>
  completeFrontendTool(result: FrontendToolResult): Promise<void>
  onFrontendToolRequest(handler: (request: FrontendToolRequest) => void): () => void
  onFrontendToolCancel(handler: (cancel: FrontendToolCancel) => void): () => void
  startRun(request: AgentStartRunRequest): Promise<AgentStartRunResult>
  cancelRun(request: AgentCancelRunRequest): Promise<AgentRunState>
  pauseRun(request: AgentRunControlRequest): Promise<AgentRunState>
  resumeRun(request: AgentRunControlRequest): Promise<AgentRunState>
  respondApproval(request: AgentApprovalResponse): Promise<AgentRunState>
  getRunState(request: AgentRunControlRequest): Promise<AgentRunState>
  getRunSnapshot(request: AgentRunControlRequest): Promise<AgentRunSnapshot>
  getRunEvents(request: AgentRunEventsRequest): Promise<AgentRunEventsPage>
  listRuns(request: AgentListRunsRequest): Promise<AgentRunSummary[]>
  retryRun(request: AgentRetryRunRequest): Promise<AgentStartRunResult>
  subscribeEvents(handler: (payload: AgentRuntimeEventPayload) => void): () => void
}
