import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPaidFailureFacts } from '@/core/application-control/paidApproval'
import { createElectronAiRuntime } from './aiRuntime'
import { createElectronLlmRuntime } from './llmRuntime'
import { createElectronAudioEdit } from './audioEdit'

afterEach(() => { vi.unstubAllGlobals() })

describe('付费 PAL 错误恢复', () => {
  it('所有付费适配器从普通错误信封恢复费用事实，成功生成解包', async () => {
    const reply = { ok: false, error: { name: 'AiRuntimeError', code: 'billing', message: '未提交', paidFailureFacts: { billing: 'not_charged' } } }
    const invoke = vi.fn(async () => structuredClone(reply))
    vi.stubGlobal('window', { henjiNative: {
      ai: { generate: invoke, continuePolling: invoke },
      llm: { chatStream: invoke, modelStep: invoke, verifyModelCapabilities: invoke },
      audio: { recording: { transcribe: invoke } },
    } })
    const request = { requestId: 'request', providerId: 'test', modelId: 'test', messages: [] }
    const ai = createElectronAiRuntime(); const llm = createElectronLlmRuntime()
    const calls = [
      () => ai.generate({ modelId: 'test', params: {} }),
      () => ai.continuePolling({ modelId: 'test', taskId: 'task' }),
      () => llm.chatStream(request, vi.fn()),
      () => llm.modelStep({ ...request, runId: 'run', stepId: 'step', output: { mode: 'text' }, capabilities: { image: false, video: false, audio: false, streaming: true, toolCall: false, parallelTools: false, structuredOutputMode: 'none', reasoning: false, sampling: true, usage: true } }, vi.fn()),
      () => llm.verifyModelCapabilities({ ...request, structuredOutputMode: 'json' }),
      () => createElectronAudioEdit().recording.transcribe({ action: 'transcribe', sessionId: crypto.randomUUID(), chunkId: crypto.randomUUID(), requestId: crypto.randomUUID(), audioUploadReceipt: crypto.randomUUID(), modelId: 'test', resume: false }),
    ]
    for (const call of calls) {
      const error = await call().catch((error: unknown) => error)
      expect(error).toMatchObject({ name: 'AiRuntimeError', code: 'billing', message: '未提交' })
      expect(readPaidFailureFacts(error)).toEqual({ billing: 'not_charged' })
    }
    const response = { status: 'completed', urls: [], filePaths: [] }
    vi.stubGlobal('window', { henjiNative: { ai: { generate: async () => ({ ok: true, data: response }) } } })
    await expect(ai.generate({ modelId: 'test', params: {} })).resolves.toEqual(response)
  })
})
