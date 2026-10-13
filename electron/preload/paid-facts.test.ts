import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HenjiNativeApi } from './api'
import { readPaidFailureFacts } from '../../src/core/application-control/paidApproval'
import { unwrapIpcResult } from '../../src/platform/adapters/electron/ipcResult'
import type { HenjiIpcResultEnvelope } from './api-assistant'
import { registerIpcHandler, parseRecord } from '../main/ipc/registry'

const bridge = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  exposed: undefined as unknown,
  transportError: undefined as Error | undefined,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  lastReply: undefined as unknown,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => bridge.handlers.set(channel, handler) },
  ipcRenderer: {
    invoke: async (channel: string, input: unknown) => {
      if (bridge.transportError) throw bridge.transportError
      const handler = bridge.handlers.get(channel)
      if (!handler) throw new Error(`Missing handler: ${channel}`)
      bridge.lastReply = structuredClone(await handler({}, structuredClone(input)))
      return bridge.lastReply
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => bridge.listeners.set(channel, listener),
    removeListener: (channel: string) => bridge.listeners.delete(channel), postMessage: vi.fn(),
  },
  contextBridge: { exposeInMainWorld: (_key: string, api: unknown) => { bridge.exposed = api } },
  webUtils: { getPathForFile: vi.fn() },
  sharedTexture: { setSharedTextureReceiver: vi.fn() },
}))

// contextBridge 不保证传递 Error 自定义属性；普通值必须先跨桥再恢复错误。
async function crossBridge<T>(call: () => Promise<T>): Promise<T> {
  try { return structuredClone(await call()) }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error)) }
}

beforeEach(async () => {
  bridge.handlers.clear()
  bridge.transportError = undefined
  bridge.listeners.clear()
  await import('./index')
})

function native() { return bridge.exposed as HenjiNativeApi }
async function roundtrip<T>(call: () => Promise<HenjiIpcResultEnvelope<T>>): Promise<T> {
  return unwrapIpcResult(await crossBridge(call))
}
const stepOptions = { runId: 'run', stepId: 'step', output: { mode: 'text' as const }, capabilities: { image: false, video: false, audio: false, streaming: true, toolCall: false, parallelTools: false, structuredOutputMode: 'none' as const, reasoning: false, sampling: true, usage: true } }

describe('生成 IPC 计费事实往返', () => {
  it.each(['not_charged', 'submitted', 'completed', 'unknown'] as const)('生成错误经两次序列化后保留 %s', async billing => {
    registerIpcHandler('ai:generate', parseRecord, () => {
      throw Object.assign(new Error('供应商拒绝'), { details: { billing, privateResponse: '不得透传' } })
    })
    const failure = await roundtrip(() => native().ai.generate({ modelId: 'test', params: {} })).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ message: '供应商拒绝' })
    expect(readPaidFailureFacts(failure)).toEqual({ billing })
    expect(failure).not.toHaveProperty('details.privateResponse')
    expect(JSON.stringify(bridge.lastReply)).not.toContain('不得透传')
  })

  it('续查保留外层已提交事实，不被 cause 的未计费覆盖', async () => {
    registerIpcHandler('ai:continuePolling', parseRecord, () => {
      throw Object.assign(new Error('轮询失败'), { execution: { billing: 'submitted' }, cause: { details: { billing: 'not_charged' } } })
    })
    const failure = await roundtrip(() => native().ai.continuePolling({ modelId: 'test', taskId: 'task' })).catch((error: unknown) => error)
    expect(readPaidFailureFacts(failure)).toEqual({ billing: 'submitted' })
  })

  it.each([undefined, { billing: 'invalid' }])('无明确事实的 4xx 不推断未计费：%j', async details => {
    registerIpcHandler('ai:generate', parseRecord, () => { throw Object.assign(new Error('余额不足 HTTP 400'), { details }) })
    const failure = await roundtrip(() => native().ai.generate({ modelId: 'test', params: {} })).catch((error: unknown) => error)
    expect(readPaidFailureFacts(failure)).toEqual({ billing: 'unknown' })
  })

  it('成功响应仍解包为原业务结果，传输中断仍拒绝且费用未知', async () => {
    const response = { status: 'completed', urls: [], filePaths: [] }
    registerIpcHandler('ai:generate', parseRecord, () => response)
    await expect(roundtrip(() => native().ai.generate({ modelId: 'test', params: {} }))).resolves.toEqual(response)
    bridge.transportError = new Error('transport disconnected')
    await expect(roundtrip(() => native().ai.generate({ modelId: 'test', params: {} }))).rejects.toThrow('transport disconnected')
  })

  it('同源付费 LLM 和讲解转录不丢弃明确未计费事实', async () => {
    for (const channel of ['llm:chatStream', 'llm:modelStep', 'llm:verifyModelCapabilities', 'audioEdit:explanation']) {
      registerIpcHandler(channel, parseRecord, () => { throw Object.assign(new Error('未提交'), { details: { billing: 'not_charged' } }) })
    }
    const llm = native().llm
    const request = { requestId: 'request', providerId: 'test', modelId: 'test', messages: [] }
    const calls = [
      () => roundtrip(() => llm.chatStream(request, vi.fn())),
      () => roundtrip(() => llm.modelStep({ ...request, ...stepOptions }, vi.fn())),
      () => roundtrip(() => llm.verifyModelCapabilities({ ...request, structuredOutputMode: 'json' })),
      () => roundtrip(() => native().audio.recording.transcribe({ action: 'transcribe', sessionId: crypto.randomUUID(), chunkId: crypto.randomUUID(), requestId: crypto.randomUUID(), audioUploadReceipt: crypto.randomUUID(), modelId: 'test', resume: false })),
    ]
    for (const call of calls) {
      const failure = await call().catch((error: unknown) => error)
      expect.soft(readPaidFailureFacts(failure)).toEqual({ billing: 'not_charged' })
    }
    expect(bridge.listeners.has('llm:chatStream:event')).toBe(false)
    expect(bridge.listeners.has('llm:modelStep:event')).toBe(false)
  })

  it('LLM 流事件和成功结果保持原语义，结束后释放订阅', async () => {
    const request = { requestId: 'request', providerId: 'test', modelId: 'test', messages: [] }
    const events = vi.fn()
    registerIpcHandler('llm:chatStream', parseRecord, input => {
      const emit = bridge.listeners.get('llm:chatStream:event')!
      emit({}, { streamId: 'other', event: { type: 'Token', data: 'ignore' } })
      emit({}, { streamId: input.streamId, event: { type: 'Token', data: '完成' } })
      emit({}, { streamId: input.streamId, event: { type: 'Done' } })
    })
    await expect(roundtrip(() => native().llm.chatStream(request, events))).resolves.toBeUndefined()
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['Token', 'Done'])
    expect(bridge.listeners.has('llm:chatStream:event')).toBe(false)

    const response = { text: '完成' }
    registerIpcHandler('llm:modelStep', parseRecord, () => response)
    await expect(roundtrip(() => native().llm.modelStep({ ...request, ...stepOptions }, vi.fn()))).resolves.toEqual(response)
    expect(bridge.listeners.has('llm:modelStep:event')).toBe(false)
  })
})
