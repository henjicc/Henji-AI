import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '@/core/assistant/hostContracts'
import type { AgentRunState } from '@/core/assistant/events'
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
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

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

export function onAgentEvent(handler: (payload: AgentRuntimeEventPayload) => void): () => void {
  if (!isDesktopRuntime()) return () => undefined
  return getPlatform().assistant.subscribeEvents(handler)
}
