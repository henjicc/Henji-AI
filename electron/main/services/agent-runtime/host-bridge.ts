import { randomUUID } from 'node:crypto'
import { webContents } from 'electron'

import type {
  FrontendToolOperation,
  ApplicationCapabilityResult,
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
import type { AgentOperationStore } from './persistence/operation-store'
import { createToolObservation } from './tools/observation'
import { digestJson } from './tools/security'
import { toGatewayError } from './tools/gateway-support'
import { failureObservedEffects } from '../../../../src/core/assistant/applicationTransactionFailureFacts'

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
  resolveRun: ResolveRun,
  operations?: AgentOperationStore
): Promise<unknown> {
  const parsed = toolExecutionPayloadSchema.parse(payload)
  const record = resolveRun(parsed.runId)
  if (!record || record.threadId !== parsed.threadId) {
    throw new Error('[PERMISSION_DENIED] 工具调用不属于当前 run/thread')
  }
  const definition = registry.get(parsed.toolName)
  if (!definition) throw new Error(`[unknown_tool] 未注册工具：${parsed.toolName}`)
  const input = definition.inputSchema.parse(parsed.input)
  const operation = parsed.operationId ? operations?.get(parsed.operationId) : null
  if (parsed.operationId && (!operation || !operations?.owns(parsed.runId, parsed.operationId) || operation.toolCallId !== parsed.toolCallId
    || operation.toolName !== parsed.toolName || operation.toolVersion !== definition.version || operation.inputDigest !== digestJson(input))) {
    throw new Error('[OPERATION_OWNER_INVALID] 执行调用与持久化操作不一致')
  }
  if (operation?.state === 'completed') return { output: operation.output, hostContext: getAgentRunHostContext(parsed.runId, resolveRun) }
  if (operation && operations) operations.claimExecution(parsed.runId, operation.operationId)
  const output = await definition.execute(input, {
    operationId: parsed.operationId,
    runId: parsed.runId,
    threadId: parsed.threadId,
    toolCallId: parsed.toolCallId,
    signal,
    hostContext: getAgentRunHostContext(parsed.runId, resolveRun),
  }).catch((error: unknown) => {
    if (operation && operations) {
      const failure = toGatewayError(error)
      const effects = failure.transaction ? failureObservedEffects(failure.transaction) : []
      operations.execute({ action: 'fail', runId: parsed.runId, operationId: operation.operationId,
        state: definition.readOnly || failure.transaction?.executionState === 'not_started' ? 'not_executed' : effects.length || failure.transaction?.persistence ? 'partial' : 'unknown',
        error: failure.message.slice(0, 2000), effects, transaction: failure.transaction })
    }
    throw error
  })
  if (operation && operations) operations.execute({ action: 'complete', runId: parsed.runId,
    operationId: operation.operationId, observation: createToolObservation(definition, input, output, parsed.toolCallId) })
  return {
    output: definition.outputSchema.parse(output),
    hostContext: getAgentRunHostContext(parsed.runId, resolveRun),
  }
}

export async function invokeAgentFrontendTool(
  operation: FrontendToolOperation,
  context: { runId: string; toolCallId: string; signal: AbortSignal; operationId?: string },
  resolveRun: ResolveRun
): Promise<ApplicationCapabilityResult> {
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
      operationId: context.operationId,
      callId,
      idempotencyKey: context.operationId ?? `${context.runId}:${context.toolCallId}`,
      deadline: Date.now() + 60_000,
      operation,
    }))
  } finally {
    context.signal.removeEventListener('abort', onAbort)
  }
}
