import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '../../src/core/assistant/hostContracts'
import type { AgentRunState } from '../../src/core/assistant/events'
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
} from '../../src/core/assistant/runtimeContracts'
import type {
  AgentListRunsRequest,
  AgentRetryRunRequest,
  AgentRunSummary,
} from '../../src/core/assistant/persistence'
import type {
  AgentListThreadsRequest,
  AgentThreadSummary,
  AgentTranscriptPage,
  AgentTranscriptRequest,
  AgentEnqueueMessageRequest,
  AgentEnqueueMessageResult,
  AgentCancelQueuedMessageRequest,
  AgentSessionEntry,
  AgentDeleteThreadsRequest,
  AgentDeleteThreadsResult,
} from '../../src/core/assistant/session'
import type {
  AssistantUserInstructions,
  AssistantUserInstructionsUpdate,
} from '../../src/core/assistant/userInstructions'
import type {
  AssistantSkillDetail,
  AssistantSkillEnabledUpdate,
  AssistantSkillInstallRequest,
  AssistantSkillInstallResult,
  AssistantSkillManifest,
  AssistantSkillReadRequest,
} from '../../src/core/assistant/skills'
import type {
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySettings,
  AgentMemorySettingsUpdate,
  AgentMemoryState,
  AgentMemoryUpdate,
} from '../../src/core/assistant/memory'
import type {
  AgentCancelExternalWaitRequest,
  GenerationStatusReportRequest,
} from '../../src/core/assistant/externalWait'

export interface HenjiIpcErrorEnvelope {
  name: string
  message: string
  code: string
  stack?: string
}

export interface HenjiAssistantApi {
  getUserInstructions(): Promise<AssistantUserInstructions>
  updateUserInstructions(update: AssistantUserInstructionsUpdate): Promise<AssistantUserInstructions>
  resetUserInstructions(): Promise<AssistantUserInstructions>
  openUserInstructionsFile(): Promise<string>
  listSkills(): Promise<AssistantSkillManifest>
  readSkill(request: AssistantSkillReadRequest): Promise<AssistantSkillDetail>
  installSkill(request: AssistantSkillInstallRequest): Promise<AssistantSkillInstallResult>
  uninstallSkill(name: string): Promise<void>
  setSkillEnabled(update: AssistantSkillEnabledUpdate): Promise<AssistantSkillManifest>
  openSkillsDirectory(): Promise<string>
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
  listThreads(request: AgentListThreadsRequest): Promise<AgentThreadSummary[]>
  deleteThreads(request: AgentDeleteThreadsRequest): Promise<AgentDeleteThreadsResult>
  getTranscript(request: AgentTranscriptRequest): Promise<AgentTranscriptPage>
  enqueueMessage(request: AgentEnqueueMessageRequest): Promise<AgentEnqueueMessageResult>
  cancelQueuedMessage(request: AgentCancelQueuedMessageRequest): Promise<AgentSessionEntry>
  reportGenerationStatus(request: GenerationStatusReportRequest): Promise<void>
  cancelExternalWait(request: AgentCancelExternalWaitRequest): Promise<AgentRunState>
  retryRun(request: AgentRetryRunRequest): Promise<AgentStartRunResult>
  subscribeEvents(handler: (payload: AgentRuntimeEventPayload) => void): () => void
}
