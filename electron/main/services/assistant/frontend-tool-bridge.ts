import { webContents, type WebContents } from 'electron'

import {
  AGENT_CONTRACT_VERSION,
  frontendToolAcknowledgementSchema,
  frontendToolRequestSchema,
  frontendToolResultSchema,
  getFrontendToolOperationName,
  parseHostContextSnapshot,
  type FrontendToolAcknowledgement,
  type FrontendToolRequest,
  type FrontendToolResult,
  type ApplicationCapabilityResult,
  type HostContextSnapshot,
  type HostErrorCode,
} from '../../../../src/core/assistant/hostContracts'
import { createMainLogger } from '../logging'
import type { OperationTransportBinding } from '../../../../src/core/assistant/operations'
import type { ApplicationExecutionPreparation } from '../../../../src/core/application-control/transactions'

const logger = createMainLogger('main.assistant_frontend_tools')
const completedLimit = 500

interface PendingFrontendCall {
  request: FrontendToolRequest
  webContentsId: number
  acknowledged: boolean
  rendererSessionId: string
  promise: Promise<ApplicationCapabilityResult>
  resolve: (result: ApplicationCapabilityResult) => void
  timeout: NodeJS.Timeout
}

const contexts = new Map<number, HostContextSnapshot>()
const pendingCalls = new Map<string, PendingFrontendCall>()
const completedCalls = new Map<string, ApplicationCapabilityResult>()
const completedIdempotencyKeys = new Map<string, ApplicationCapabilityResult>()
const finishedBindings = new Map<string, { request: FrontendToolRequest; webContentsId: number; rendererSessionId: string }>()

interface OperationReceiptPersistence {
  bind: (binding: OperationTransportBinding) => void
  getBinding: (callId: string) => OperationTransportBinding | null
  record: (binding: OperationTransportBinding, result: ApplicationCapabilityResult) => void
  prepare?: (binding: OperationTransportBinding, preparation: ApplicationExecutionPreparation) => void
}
let operationReceipts: OperationReceiptPersistence | undefined
export function configureAssistantOperationReceipts(persistence: OperationReceiptPersistence): () => void {
  operationReceipts = persistence
  return () => { if (operationReceipts === persistence) operationReceipts = undefined }
}

function failure(
  code: HostErrorCode,
  message: string,
  recoverable = true
): ApplicationCapabilityResult {
  return { ok: false, error: { code, message, recoverable } }
}

function rememberCompleted(
  request: FrontendToolRequest,
  result: ApplicationCapabilityResult
): void {
  completedCalls.set(request.callId, result)
  completedIdempotencyKeys.set(request.idempotencyKey, result)
  while (completedCalls.size > completedLimit) {
    const oldest = completedCalls.keys().next().value
    if (typeof oldest === 'string') completedCalls.delete(oldest)
  }
  while (completedIdempotencyKeys.size > completedLimit) {
    const oldest = completedIdempotencyKeys.keys().next().value
    if (typeof oldest === 'string') completedIdempotencyKeys.delete(oldest)
  }
}

function finishPending(callId: string, result: ApplicationCapabilityResult): void {
  const pending = pendingCalls.get(callId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingCalls.delete(callId)
  finishedBindings.set(callId, { request: pending.request, webContentsId: pending.webContentsId, rendererSessionId: pending.rendererSessionId })
  while (finishedBindings.size > completedLimit) finishedBindings.delete(finishedBindings.keys().next().value!)
  rememberCompleted(pending.request, result)
  pending.resolve(result)
}

function failCallsForRenderer(webContentsId: number, code: HostErrorCode, message: string): void {
  for (const [callId, pending] of pendingCalls) {
    if (pending.webContentsId === webContentsId) finishPending(callId, failure(code, message))
  }
}

export function publishAssistantHostContext(webContentsId: number, rawSnapshot: unknown): void {
  const snapshot = parseHostContextSnapshot(rawSnapshot)
  const previous = contexts.get(webContentsId)
  if (previous && previous.rendererSessionId !== snapshot.rendererSessionId) {
    failCallsForRenderer(webContentsId, 'RENDERER_RELOADED', '渲染进程已重载，前端工具调用状态未知')
  }
  contexts.set(webContentsId, snapshot)
}

export function acknowledgeAssistantFrontendTool(webContentsId: number, rawAcknowledgement: unknown): void {
  const acknowledgement: FrontendToolAcknowledgement = frontendToolAcknowledgementSchema.parse(rawAcknowledgement)
  const pending = pendingCalls.get(acknowledgement.callId)
  if (!pending || pending.webContentsId !== webContentsId) throw new Error('UNKNOWN_CALL')
  const context = contexts.get(webContentsId)
  if (!context || context.rendererSessionId !== acknowledgement.rendererSessionId) throw new Error('RENDERER_RELOADED')
  if (acknowledgement.executionPreparation) {
    const binding = operationReceipts?.getBinding(acknowledgement.callId)
    if (!binding || !operationReceipts?.prepare || binding.webContentsId !== webContentsId
      || binding.rendererSessionId !== acknowledgement.rendererSessionId) throw new Error('OPERATION_OWNER_INVALID')
    operationReceipts.prepare(binding, acknowledgement.executionPreparation)
  }
  pending.acknowledged = true
}

export function completeAssistantFrontendTool(webContentsId: number, rawResult: unknown): void {
  const frontendResult: FrontendToolResult = frontendToolResultSchema.parse(rawResult)
  const pending = pendingCalls.get(frontendResult.callId)
  const known = pending ?? finishedBindings.get(frontendResult.callId)
  const stored = operationReceipts?.getBinding(frontendResult.callId)
  const binding = known ? { ...known.request, webContentsId: known.webContentsId, rendererSessionId: known.rendererSessionId } : stored
  if (!binding || binding.webContentsId !== webContentsId) throw new Error('UNKNOWN_CALL')
  if (
    frontendResult.runId !== binding.runId
    || frontendResult.toolCallId !== binding.toolCallId
    || frontendResult.idempotencyKey !== binding.idempotencyKey
    || frontendResult.rendererSessionId !== binding.rendererSessionId
  ) {
    throw new Error('Frontend tool result correlation mismatch')
  }
  // 校验原宿主关联，不要求当前页面仍属于原会话；重载前已完成的迟到回执仍是事实。
  if (stored) operationReceipts?.record(stored, frontendResult.result)
  if (pending) finishPending(frontendResult.callId, frontendResult.result)
  else if (known) rememberCompleted(known.request, frontendResult.result)
  logger.info('前端工具调用完成', {
    event: frontendResult.result.ok ? 'assistant.frontend_tool.completed' : 'assistant.frontend_tool.failed',
    requestId: frontendResult.runId,
    taskId: frontendResult.toolCallId,
    context: { callId: frontendResult.callId, late: !pending },
  })
}

export function getAssistantHostContext(webContentsId: number): HostContextSnapshot | null {
  return contexts.get(webContentsId) ?? null
}

export function getReadyAssistantRenderer(): WebContents | null {
  const readyContexts = [...contexts.entries()]
    .filter(([, snapshot]) => snapshot.uiReady)
    .sort((left, right) => right[1].capturedAt.localeCompare(left[1].capturedAt))
  const selectedId = readyContexts[0]?.[0]
  return selectedId === undefined ? null : webContents.fromId(selectedId) ?? null
}

export function requestAssistantFrontendTool(
  sender: WebContents,
  rawRequest: unknown
): Promise<ApplicationCapabilityResult> {
  const request = frontendToolRequestSchema.parse(rawRequest)
  const completedByCall = completedCalls.get(request.callId)
  if (completedByCall) return Promise.resolve(completedByCall)
  const completedByKey = completedIdempotencyKeys.get(request.idempotencyKey)
  if (completedByKey) return Promise.resolve(completedByKey)
  const pending = pendingCalls.get(request.callId)
  if (pending) return pending.promise

  const context = contexts.get(sender.id)
  if (!context?.uiReady || sender.isDestroyed()) {
    return Promise.resolve(failure('CAPABILITY_NOT_READY', '宿主界面尚未就绪'))
  }
  if (request.deadline <= Date.now()) {
    return Promise.resolve(failure('DEADLINE_EXCEEDED', '前端工具调用已超过截止时间'))
  }
  if (request.operationId) {
    if (!operationReceipts) throw new Error('OPERATION_PERSISTENCE_UNAVAILABLE')
    operationReceipts.bind({ operationId: request.operationId, callId: request.callId,
      runId: request.runId, toolCallId: request.toolCallId, idempotencyKey: request.idempotencyKey,
      webContentsId: sender.id, rendererSessionId: context.rendererSessionId })
  }

  let resolveCall: (result: ApplicationCapabilityResult) => void = () => undefined
  const promise = new Promise<ApplicationCapabilityResult>((resolve) => { resolveCall = resolve })
  const timeout = setTimeout(() => {
    const current = pendingCalls.get(request.callId)
    if (!current) return
    const message = current.acknowledged
      ? '前端已认领调用，但未在截止时间前返回结果；写操作状态未知'
      : '前端未在截止时间前认领调用'
    finishPending(request.callId, failure('DEADLINE_EXCEEDED', message))
  }, Math.max(1, request.deadline - Date.now()))

  pendingCalls.set(request.callId, {
    request,
    webContentsId: sender.id,
    acknowledged: false,
    rendererSessionId: context.rendererSessionId,
    promise,
    resolve: resolveCall,
    timeout,
  })
  try { sender.send('assistant:frontendTool:request', request) }
  catch (error) {
    // 发送失败也结束本次等待并保留关联；不能遗留定时器或假定业务从未执行。
    finishPending(request.callId, failure('RENDERER_RELOADED', '宿主连接中断，原调用需要核对'))
    logger.error('前端工具请求发送失败', { event: 'assistant.frontend_tool.send.failed',
      requestId: request.runId, taskId: request.toolCallId, error })
    return promise
  }
  logger.info('前端工具调用已请求', {
    event: 'assistant.frontend_tool.requested',
    requestId: request.runId,
    taskId: request.toolCallId,
    context: { callId: request.callId, command: getFrontendToolOperationName(request.operation) },
  })
  return promise
}

export function cancelAssistantFrontendTool(callId: string, reason: string): boolean {
  const pending = pendingCalls.get(callId)
  if (!pending) return false
  const sender = webContents.fromId(pending.webContentsId)
  if (sender && !sender.isDestroyed()) sender.send('assistant:frontendTool:cancel', { callId, reason })
  finishPending(callId, failure('ABORTED', reason))
  return true
}

export function createFrontendToolRequest(
  request: Omit<FrontendToolRequest, 'schemaVersion'>
): FrontendToolRequest {
  return frontendToolRequestSchema.parse({ ...request, schemaVersion: AGENT_CONTRACT_VERSION })
}
