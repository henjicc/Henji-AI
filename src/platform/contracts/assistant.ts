import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '@/core/assistant/hostContracts'
import type { AgentRunState } from '@/core/assistant/events'
import type {
  AssistantModelPreferences,
  AssistantModelPreferencesUpdate,
} from '@/core/assistant/modelPreferences'
import type {
  AgentApprovalResponse,
  AgentCancelRunRequest,
  AgentRunControlRequest,
  AgentRuntimeEventPayload,
  AgentRunSnapshot,
  AgentStartRunRequest,
  AgentStartRunResult,
} from '@/core/assistant/runtimeContracts'

export interface AssistantPlatform {
  getModelPreferences(): Promise<AssistantModelPreferences>
  updateModelPreferences(update: AssistantModelPreferencesUpdate): Promise<AssistantModelPreferences>
  resetModelPreferences(): Promise<AssistantModelPreferences>
  openModelPreferencesFile(): Promise<string>
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
  subscribeEvents(handler: (payload: AgentRuntimeEventPayload) => void): () => void
}
