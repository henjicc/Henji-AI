// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import type { OperationRecord } from '../services/application-runtime/operationStore'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (input: unknown) => Promise<unknown>>(),
  record: undefined as OperationRecord | undefined,
  generate: vi.fn(async () => ({ status: 'submitted' })),
  poll: vi.fn(async () => ({ status: 'completed' })),
}))
vi.mock('./registry', () => ({
  parseRecord: (input: unknown) => input,
  parseStringField: (input: { value: string }) => input.value,
  parseVoid: () => undefined,
  registerIpcHandler: (name: string, parse: (input: unknown) => unknown, handler: (input: unknown) => Promise<unknown>) => {
    state.handlers.set(name, async input => handler(parse(input)))
  },
}))
vi.mock('../services/ai-runtime/runtime', () => ({
  generate: state.generate, continuePolling: state.poll, cancelRuntimeTask: vi.fn(), getEstimate: vi.fn(),
  getProviderKeyStatus: vi.fn(), parseJsonObject: (input: unknown) => input, recordSample: vi.fn(), recoverSavedGenerationResult: vi.fn(),
}))
vi.mock('../services/ai-runtime/pending-results', () => ({ consumePendingResult: vi.fn() }))
vi.mock('../services/ai-runtime/sdk-runtime', () => ({ sdkRuntimeContext: {} }))
vi.mock('../services/documents/runtime', () => ({ resolveContainerGeneratedFolder: vi.fn() }))
vi.mock('../services/settings/store', () => ({ getSettingsStore: () => ({ get: () => undefined }) }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
vi.mock('../services/application-runtime/runtime', () => ({ getApplicationRuntime: () => ({ operations: { store: {
  get: (id: string, caller: string) => id === state.record?.operationId && caller === state.record.callerId ? state.record : undefined,
  save: (record: OperationRecord) => { state.record = record },
} } }) }))
import { registerAiRuntimeIpc } from './ai-runtime'

beforeEach(() => { vi.clearAllMocks(); state.handlers.clear(); state.record = undefined; registerAiRuntimeIpc() })

it('生成 IPC 必须消费原任务付费收据，收据不进入 SDK，轮询不重复确认', async () => {
  const generate = state.handlers.get('ai:generate')!
  const input = { modelId: 'fixture', requestId: 'task', params: { prompt: '图片' } }
  await expect(generate(input)).rejects.toThrow('PAID_CONFIRMATION_REQUIRED')
  expect(state.generate).not.toHaveBeenCalled()
  const paidReceipt = { operationId: crypto.randomUUID(), callerId: crypto.randomUUID() }
  state.record = { ...paidReceipt, capabilityId: 'create_visible_generation_task', state: 'completed', input: {}, inputDigest: '',
    approval: { decision: 'auto', reason: '额度内' },
    paidReservations: [{ category: 'generation', estimatedCny: 1, reservedAt: Date.now(), approval: { decision: 'auto', reason: '额度内' } }],
  }
  await generate({ ...input, paidReceipt })
  expect(state.generate).toHaveBeenCalledWith(input, {})
  await expect(generate({ ...input, requestId: 'another-task', paidReceipt })).rejects.toThrow('PAID_CONFIRMATION_REQUIRED')
  expect(state.generate).toHaveBeenCalledTimes(1)
  await state.handlers.get('ai:continuePolling')!({ ...input, taskId: 'provider-task' })
  expect(state.poll).toHaveBeenCalledOnce()
})
