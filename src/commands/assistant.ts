import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '@/core/assistant/hostContracts'
import type { AgentRunState } from '@/core/assistant/events'
import {
  assistantUserInstructionsUpdateSchema,
  type AssistantUserInstructions,
  type AssistantUserInstructionsUpdate,
} from '@/core/assistant/userInstructions'
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  agentApprovalResponseSchema,
  agentCancelRunRequestSchema,
  agentRunControlRequestSchema,
  agentStartRunRequestSchema,
  type AgentApprovalResponse,
  type AgentRuntimeEventPayload,
  type AgentRunSnapshot,
  type AgentStartRunRequest,
  type AgentStartRunResult,
} from '@/core/assistant/runtimeContracts'
import {
  agentListRunsRequestSchema,
  agentRetryRunRequestSchema,
  type AgentRunSummary,
} from '@/core/assistant/persistence'
import {
  agentMemoryClearSchema,
  agentMemoryCandidateIdSchema,
  agentMemoryIdSchema,
  agentMemorySettingsUpdateSchema,
  agentMemoryUpdateSchema,
  type AgentMemoryRecord,
  type AgentMemoryScope,
  type AgentMemorySettings,
  type AgentMemorySettingsUpdate,
  type AgentMemoryState,
  type AgentMemoryUpdate,
} from '@/core/assistant/memory'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export async function getAssistantUserInstructions(): Promise<AssistantUserInstructions> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  return await getPlatform().assistant.getUserInstructions()
}

export async function updateAssistantUserInstructions(
  update: AssistantUserInstructionsUpdate
): Promise<AssistantUserInstructions> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  const parsed = assistantUserInstructionsUpdateSchema.parse(update)
  return await getPlatform().assistant.updateUserInstructions(parsed)
}

export async function resetAssistantUserInstructions(): Promise<AssistantUserInstructions> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  return await getPlatform().assistant.resetUserInstructions()
}

export async function openAssistantUserInstructionsFile(): Promise<string> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  return await getPlatform().assistant.openUserInstructionsFile()
}

export async function getAgentMemoryState(): Promise<AgentMemoryState> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  return await getPlatform().assistant.getMemoryState()
}

export async function updateAgentMemorySettings(
  update: AgentMemorySettingsUpdate
): Promise<AgentMemorySettings> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  return await getPlatform().assistant.updateMemorySettings(
    agentMemorySettingsUpdateSchema.parse(update)
  )
}

export async function updateAgentMemoryRecord(
  update: AgentMemoryUpdate
): Promise<AgentMemoryRecord> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  return await getPlatform().assistant.updateMemory(agentMemoryUpdateSchema.parse(update))
}

export async function deleteAgentMemory(memoryId: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryIdSchema.parse({ memoryId })
  await getPlatform().assistant.deleteMemory(parsed.memoryId)
}

export async function confirmAgentMemoryCandidate(
  candidateId: string
): Promise<AgentMemoryRecord> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryCandidateIdSchema.parse({ candidateId })
  return await getPlatform().assistant.confirmMemoryCandidate(parsed.candidateId)
}

export async function rejectAgentMemoryCandidate(candidateId: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryCandidateIdSchema.parse({ candidateId })
  await getPlatform().assistant.rejectMemoryCandidate(parsed.candidateId)
}

export async function clearAgentMemory(scope?: AgentMemoryScope): Promise<number> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryClearSchema.parse({ scope })
  return await getPlatform().assistant.clearMemories(parsed.scope)
}

export async function publishHostContext(snapshot: HostContextSnapshot): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().assistant.publishHostContext(snapshot)
}

export async function acknowledgeFrontendTool(acknowledgement: FrontendToolAcknowledgement): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().assistant.acknowledgeFrontendTool(acknowledgement)
}

export async function completeFrontendTool(result: FrontendToolResult): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().assistant.completeFrontendTool(result)
}

export function onFrontendToolRequest(handler: (request: FrontendToolRequest) => void): () => void {
  if (!isDesktopRuntime()) return () => undefined
  return getPlatform().assistant.onFrontendToolRequest(handler)
}

export function onFrontendToolCancel(handler: (cancel: FrontendToolCancel) => void): () => void {
  if (!isDesktopRuntime()) return () => undefined
  return getPlatform().assistant.onFrontendToolCancel(handler)
}

export async function startAgentRun(
  request: Omit<AgentStartRunRequest, 'schemaVersion'>
): Promise<AgentStartRunResult> {
  if (!isDesktopRuntime()) throw new Error('智能助手运行时仅在桌面应用中可用')
  const parsed = agentStartRunRequestSchema.parse({ ...request, schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION })
  return await getPlatform().assistant.startRun(parsed)
}

export async function cancelAgentRun(runId: string, reason = '用户取消'): Promise<AgentRunState> {
  const request = agentCancelRunRequestSchema.parse({ schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, runId, reason })
  return await getPlatform().assistant.cancelRun(request)
}

export async function pauseAgentRun(runId: string): Promise<AgentRunState> {
  const request = agentRunControlRequestSchema.parse({ schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, runId })
  return await getPlatform().assistant.pauseRun(request)
}

export async function resumeAgentRun(runId: string): Promise<AgentRunState> {
  const request = agentRunControlRequestSchema.parse({ schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, runId })
  return await getPlatform().assistant.resumeRun(request)
}

export async function respondAgentApproval(
  runId: string,
  approvalId: string,
  decision: AgentApprovalResponse['decision']
): Promise<AgentRunState> {
  const request = agentApprovalResponseSchema.parse({
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    runId,
    approvalId,
    decision,
  })
  return await getPlatform().assistant.respondApproval(request)
}

export async function getAgentRunState(runId: string): Promise<AgentRunState> {
  const request = agentRunControlRequestSchema.parse({ schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, runId })
  return await getPlatform().assistant.getRunState(request)
}

export async function getAgentRunSnapshot(runId: string): Promise<AgentRunSnapshot> {
  const request = agentRunControlRequestSchema.parse({ schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, runId })
  return await getPlatform().assistant.getRunSnapshot(request)
}

export async function listAgentRuns(
  threadId?: string,
  limit = 30
): Promise<AgentRunSummary[]> {
  const request = agentListRunsRequestSchema.parse({
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId,
    limit,
  })
  return await getPlatform().assistant.listRuns(request)
}

export async function retryAgentRun(runId: string): Promise<AgentStartRunResult> {
  const request = agentRetryRunRequestSchema.parse({
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    runId,
  })
  return await getPlatform().assistant.retryRun(request)
}

export function onAgentEvent(handler: (payload: AgentRuntimeEventPayload) => void): () => void {
  if (!isDesktopRuntime()) return () => undefined
  return getPlatform().assistant.subscribeEvents(handler)
}
