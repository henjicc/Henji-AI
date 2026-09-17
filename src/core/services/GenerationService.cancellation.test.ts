// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { aiCancelTask, aiContinuePolling, aiGenerate } from '@/commands/aiRuntime'
import { GenerationService } from './GenerationService'

vi.mock('@/commands/aiRuntime', () => ({
  aiCancelTask: vi.fn(async () => undefined), aiGenerate: vi.fn(), aiContinuePolling: vi.fn(),
  aiGetProgressEstimate: vi.fn(async () => null), aiRecordProgressSample: vi.fn(async () => null),
}))
const service = GenerationService.getInstance()
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(service, 'getProgressEstimate').mockResolvedValue(null)
  registry.register({ meta: { id: 'cancel-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '测试', en: 'Test' } },
    params: [], endpoints: '/fixture', pricing: { currency: '$', fixed: 0.01 }, request: { builder: params => params } })
})
afterEach(() => { registry.unregister('cancel-fixture'); vi.restoreAllMocks() })

it('媒体准备期间取消不会提交供应商请求', async () => {
  let release!: () => void
  vi.mocked(service.getProgressEstimate).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null) }))
  const controller = new AbortController()
  const run = service.generate('cancel-fixture', { prompt: 'test' }, undefined, { requestId: 'original-request', signal: controller.signal })
  const assertion = expect(run).rejects.toThrow('停止')
  await vi.waitFor(() => expect(service.getProgressEstimate).toHaveBeenCalled())
  controller.abort(new Error('停止'))
  release()
  await assertion
  expect(aiGenerate).not.toHaveBeenCalled()
  expect(aiCancelTask).not.toHaveBeenCalled()
})

it.each(['generate', 'poll'] as const)('%s 只取消实际运行标识，不把信号发送到 IPC', async phase => {
  let release!: () => void
  const response = { status: 'completed' as const, url: 'C:/result.png', metadata: {} }
  const pending = new Promise<typeof response>(resolve => { release = () => resolve(response) })
  vi.mocked(aiGenerate).mockReturnValue(pending)
  vi.mocked(aiContinuePolling).mockReturnValue(pending)
  const controller = new AbortController()
  const run = phase === 'generate'
    ? service.generate('cancel-fixture', { prompt: 'test' }, undefined, { requestId: 'original-request', signal: controller.signal })
    : service.continuePolling('cancel-fixture', 'provider-task', {}, undefined, { requestId: 'original-request', signal: controller.signal })
  const dispatch = phase === 'generate' ? aiGenerate : aiContinuePolling
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
  controller.abort()
  await vi.waitFor(() => expect(aiCancelTask).toHaveBeenCalledWith(phase === 'generate' ? 'original-request' : 'provider-task'))
  release()
  await run
  expect(aiCancelTask).toHaveBeenCalledTimes(1)
  expect(vi.mocked(dispatch).mock.calls[0][0]).not.toHaveProperty('signal')
})

it('正常结束后信号不再取消已完成请求', async () => {
  vi.mocked(aiGenerate).mockResolvedValue({ status: 'completed', url: 'C:/result.png', metadata: {} })
  const controller = new AbortController()
  await service.generate('cancel-fixture', { prompt: 'test' }, undefined, { requestId: 'completed', signal: controller.signal })
  controller.abort()
  expect(aiCancelTask).not.toHaveBeenCalled()
})
