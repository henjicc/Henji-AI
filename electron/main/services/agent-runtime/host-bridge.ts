import { randomUUID } from 'node:crypto'
import { webContents } from 'electron'

import type {
  FrontendToolOperation,
  HostCommandResult,
  HostContextSnapshot,
} from '../../../../src/core/assistant/hostContracts'
import {
  cancelAssistantFrontendTool,
  createFrontendToolRequest,
  getAssistantHostContext,
  requestAssistantFrontendTool,
} from '../assistant/frontend-tool-bridge'
import type { AgentToolRegistry } from './tools/registry'
import { toolExecutionPayloadSchema } from './runtime-schemas'

export interface AgentRuntimeHostOwner {
  ownerWebContentsId: number
  rendererSessionId: string
  threadId: string
}

type ResolveRun = (runId: string) => AgentRuntimeHostOwner | undefined

export function getAgentRunHostContext(
  runId: string,
  resolveRun: ResolveRun
): HostContextSnapshot | null {
  const record = resolveRun(runId)
  if (!record) return null
  const context = getAssistantHostContext(record.ownerWebContentsId)
  return context?.rendererSessionId === record.rendererSessionId ? context : null
}

export async function executeAgentToolInMain(
  payload: unknown,
  signal: AbortSignal,
  registry: AgentToolRegistry,
  resolveRun: ResolveRun
): Promise<unknown> {
  const parsed = toolExecutionPayloadSchema.parse(payload)
  const record = resolveRun(parsed.runId)
  if (!record || record.threadId !== parsed.threadId) {
    throw new Error('[PERMISSION_DENIED] 工具调用不属于当前 run/thread')
  }
  const definition = registry.get(parsed.toolName)
  if (!definition) throw new Error(`[unknown_tool] 未注册工具：${parsed.toolName}`)
  const input = definition.inputSchema.parse(parsed.input)
  const output = await definition.execute(input, {
    runId: parsed.runId,
    threadId: parsed.threadId,
    toolCallId: parsed.toolCallId,
    signal,
    hostContext: getAgentRunHostContext(parsed.runId, resolveRun),
  })
  return {
    output: definition.outputSchema.parse(output),
    hostContext: getAgentRunHostContext(parsed.runId, resolveRun),
  }
}

export async function invokeAgentFrontendTool(
  operation: FrontendToolOperation,
  context: { runId: string; toolCallId: string; signal: AbortSignal },
  resolveRun: ResolveRun
): Promise<HostCommandResult> {
  const record = resolveRun(context.runId)
  if (!record) throw new Error('[run_not_found] Agent run not found')
  const sender = webContents.fromId(record.ownerWebContentsId)
  if (!sender || sender.isDestroyed()) throw new Error('[renderer_gone] Renderer is unavailable')
  const callId = randomUUID()
  const onAbort = (): void => { cancelAssistantFrontendTool(callId, 'Agent 工具调用已取消') }
  context.signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await requestAssistantFrontendTool(sender, createFrontendToolRequest({
      runId: context.runId,
      toolCallId: context.toolCallId,
      callId,
      idempotencyKey: `${context.runId}:${context.toolCallId}`,
      deadline: Date.now() + 60_000,
      operation,
    }))
  } finally {
    context.signal.removeEventListener('abort', onAbort)
  }
}
