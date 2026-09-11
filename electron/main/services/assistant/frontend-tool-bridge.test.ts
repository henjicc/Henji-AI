import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { contextSnapshot } from '../agent-runtime/context/context-test-fixtures'
import type { OperationTransportBinding } from '../../../../src/core/assistant/operations'
import type { ApplicationCapabilityResult, FrontendToolRequest } from '../../../../src/core/assistant/hostContracts'

vi.mock('electron', () => ({ webContents: { fromId: () => null } }))

import {
  completeAssistantFrontendTool, configureAssistantOperationReceipts, createFrontendToolRequest,
  publishAssistantHostContext, requestAssistantFrontendTool, acknowledgeAssistantFrontendTool,
} from './frontend-tool-bridge'

afterEach(() => { vi.useRealTimers() })

function fixture(callId: string, webContentsId: number) {
  const bindings = new Map<string, OperationTransportBinding>()
  const receipts: ApplicationCapabilityResult[] = []
  const prepare = vi.fn()
  configureAssistantOperationReceipts({
    bind: (binding) => bindings.set(binding.callId, binding),
    getBinding: (id) => bindings.get(id) ?? null,
    record: (_binding, result) => { receipts.push(result) },
    prepare,
  })
  const sender = { id: webContentsId, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
  publishAssistantHostContext(webContentsId, contextSnapshot())
  const request: FrontendToolRequest = createFrontendToolRequest({
    operationId: `operation-${callId}`, runId: 'run', toolCallId: 'tool', callId,
    idempotencyKey: `operation-${callId}`, deadline: Date.now() + 50,
    operation: { kind: 'capability', capability: { id: 'change_application_entities', version: 1, input: {} } },
  })
  const result = { schemaVersion: request.schemaVersion, runId: request.runId, toolCallId: request.toolCallId,
    callId, idempotencyKey: request.idempotencyKey, rendererSessionId: 'renderer-1', completedAt: new Date().toISOString(),
    result: { ok: true as const, data: { saved: true }, resultingRevision: 4, resultingScopeRevisions: contextSnapshot().scopeRevisions } }
  return { sender, request, result, receipts, bindings, prepare }
}

describe('frontend tool durable receipt correlation', () => {
  it('验证条件沿原调用认领通道保存；错误会话和保存失败都不能确认准备完成', async () => {
    const current = fixture('prepare-call', 19005)
    const waiting = requestAssistantFrontendTool(current.sender, current.request)
    const acknowledgement = { schemaVersion: current.request.schemaVersion, callId: current.request.callId,
      rendererSessionId: 'renderer-1', acknowledgedAt: new Date().toISOString(), executionPreparation: {
        planRef: 'plan:12345678901234567890', conditions: [{ kind: 'entity_exists', target: { kind: 'canvas.node', id: 'A' } }],
        preparedAt: new Date().toISOString(),
      } }
    expect(() => acknowledgeAssistantFrontendTool(current.sender.id, { ...acknowledgement, rendererSessionId: 'other' })).toThrow('RENDERER_RELOADED')
    expect(current.prepare).not.toHaveBeenCalled()
    current.prepare.mockImplementationOnce(() => { throw new Error('save failed') })
    expect(() => acknowledgeAssistantFrontendTool(current.sender.id, acknowledgement)).toThrow('save failed')
    acknowledgeAssistantFrontendTool(current.sender.id, acknowledgement)
    expect(current.prepare).toHaveBeenLastCalledWith(current.bindings.get(current.request.callId), acknowledgement.executionPreparation)
    completeAssistantFrontendTool(current.sender.id, current.result)
    await waiting
  })
  it('发送异常立即结束等待并清理计时器，原关联仍可接收迟到回执', async () => {
    vi.useFakeTimers()
    const current = fixture('send-failed', 19004)
    vi.mocked(current.sender.send).mockImplementation(() => { throw new Error('renderer closed') })
    expect(await requestAssistantFrontendTool(current.sender, current.request)).toMatchObject({ ok: false,
      error: { code: 'RENDERER_RELOADED' } })
    expect(vi.getTimerCount()).toBe(0)
    completeAssistantFrontendTool(current.sender.id, current.result)
    expect(current.receipts).toEqual([current.result.result])
  })
  it('超时仅结束等待，迟到回执校验后保存，重复请求取得实际成功结果', async () => {
    vi.useFakeTimers()
    const current = fixture('late-call', 19001)
    const waiting = requestAssistantFrontendTool(current.sender, current.request)
    expect(current.bindings.has('late-call')).toBe(true)
    await vi.advanceTimersByTimeAsync(51)
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'DEADLINE_EXCEEDED' } })
    completeAssistantFrontendTool(current.sender.id, current.result)
    expect(current.receipts).toEqual([current.result.result])
    expect(await requestAssistantFrontendTool(current.sender, current.request)).toMatchObject({ ok: true, data: { saved: true } })
    expect(current.sender.send).toHaveBeenCalledTimes(1)
    expect(() => completeAssistantFrontendTool(current.sender.id, { ...current.result, toolCallId: 'wrong' })).toThrow('correlation mismatch')
  })

  it('界面重载后仍接受原会话匹配的回执，拒绝冒用新会话和其他宿主', async () => {
    const current = fixture('reload-call', 19002)
    const waiting = requestAssistantFrontendTool(current.sender, current.request)
    publishAssistantHostContext(current.sender.id, { ...contextSnapshot(), rendererSessionId: 'renderer-2' })
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'RENDERER_RELOADED' } })
    expect(() => completeAssistantFrontendTool(current.sender.id, { ...current.result, rendererSessionId: 'renderer-2' })).toThrow('correlation mismatch')
    expect(() => completeAssistantFrontendTool(19003, current.result)).toThrow('UNKNOWN_CALL')
    completeAssistantFrontendTool(current.sender.id, current.result)
    expect(current.receipts).toHaveLength(1)
  })
})
