import { afterEach, describe, expect, it, vi } from 'vitest'
import { frontendToolRequestSchema, type ApplicationCapabilityResult, type FrontendToolRequest } from '@/core/assistant/hostContracts'
import type { ApplicationExecutionPreparation } from '@/core/application-control/transactions'
import { FrontendToolExecutionCoordinator } from './executionCoordinator'

afterEach(() => { vi.useRealTimers() })

function fixture() {
  const result: ApplicationCapabilityResult = { ok: true, data: { saved: true }, resultingRevision: 1,
    resultingScopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1, settings: 1 } }
  const request = frontendToolRequestSchema.parse({ schemaVersion: 'agent-contract/v2',
    runId: 'run', toolCallId: 'write-A', callId: 'call', idempotencyKey: 'operation-A', operationId: 'operation-A',
    deadline: Date.now() + 60_000,
    operation: { kind: 'capability', capability: { id: 'change_application_entities', version: 1, input: {} } } })
  const dependencies = { rendererSessionId: 'original-session', acknowledge: vi.fn(async () => {}),
    complete: vi.fn(async () => {}), execute: vi.fn(async (): Promise<ApplicationCapabilityResult> => result), reportError: vi.fn() }
  return { result, request, dependencies, coordinator: new FrontendToolExecutionCoordinator(dependencies) }
}

describe('FrontendToolExecutionCoordinator', () => {
  it('执行器的准备记录复用原调用关联，保存确认返回前不能继续修改', async () => {
    const current = fixture()
    const preparation = { planRef: 'plan:12345678901234567890', conditions: [], preparedAt: new Date().toISOString() }
    const order: string[] = []
    const acknowledge = vi.fn(async (_request: FrontendToolRequest, value?: ApplicationExecutionPreparation) => { if (value) order.push('saved') })
    const coordinator = new FrontendToolExecutionCoordinator({ ...current.dependencies, acknowledge,
      execute: async (_request, context) => {
        expect(context.operationId).toBe(current.request.operationId)
        await context.recordExecutionPreparation!(preparation)
        order.push('write')
        return current.result
      },
    })
    await coordinator.receive(current.request)
    expect(acknowledge).toHaveBeenLastCalledWith(current.request, preparation)
    expect(order).toEqual(['saved', 'write'])
    coordinator.dispose()
    current.coordinator.dispose()
  })
  it('执行器同步抛错后保留原尝试，重传不会重复未知写入', async () => {
    const current = fixture()
    current.dependencies.execute.mockImplementation(() => { throw new Error('write receipt missing') })
    await expect(current.coordinator.receive(current.request)).rejects.toThrow('write receipt missing')
    await expect(current.coordinator.receive({ ...current.request, callId: 'retry' })).rejects.toThrow('write receipt missing')
    expect(current.dependencies.execute).toHaveBeenCalledTimes(1)
    current.coordinator.dispose()
  })
  it('业务成功后回执传输失败只重发原回执，不重新执行业务', async () => {
    vi.useFakeTimers()
    const current = fixture()
    current.dependencies.complete.mockRejectedValueOnce(new Error('bridge disconnected'))
    await current.coordinator.receive(current.request)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(current.dependencies.execute).toHaveBeenCalledTimes(1)
    expect(current.dependencies.complete).toHaveBeenCalledTimes(2)
    expect(current.dependencies.complete.mock.calls[0]).toEqual(current.dependencies.complete.mock.calls[1])
    current.coordinator.dispose()
  })

  it('同操作并发重传合并执行，不能用相同身份换业务参数', async () => {
    const current = fixture()
    let finish!: (result: ApplicationCapabilityResult) => void
    let started!: () => void
    const executing = new Promise<void>((resolve) => { started = resolve })
    current.dependencies.execute.mockImplementation(() => new Promise((resolve) => { finish = resolve; started() }))
    const first = current.coordinator.receive(current.request)
    const second = current.coordinator.receive({ ...current.request, callId: 'second-call' })
    await executing
    finish(current.result)
    await Promise.all([first, second])
    expect(current.dependencies.execute).toHaveBeenCalledTimes(1)
    expect(current.dependencies.complete).toHaveBeenCalledTimes(2)
    await expect(current.coordinator.receive({ ...current.request,
      operation: { ...current.request.operation, capability: { ...current.request.operation.capability, input: { changed: true } } },
    })).rejects.toThrow('OPERATION_CONFLICT')
    current.coordinator.dispose()
  })

  it('认领期间取消不会漏过取消信号，执行中的迟到结果仍保存', async () => {
    const current = fixture()
    let acknowledged!: () => void
    current.dependencies.acknowledge.mockImplementation(() => new Promise<void>((resolve) => { acknowledged = resolve }))
    const receiving = current.coordinator.receive(current.request)
    current.coordinator.cancel(current.request.callId)
    acknowledged()
    await receiving
    expect(current.dependencies.execute).not.toHaveBeenCalled()
    expect(current.dependencies.complete).toHaveBeenCalledWith(expect.objectContaining({ result: { ok: false,
      error: expect.objectContaining({ code: 'ABORTED' }) } }))
    current.coordinator.dispose()

    const late = fixture()
    let finish!: (result: ApplicationCapabilityResult) => void
    let started!: () => void
    const executing = new Promise<void>((resolve) => { started = resolve })
    late.dependencies.execute.mockImplementation(() => new Promise((resolve) => { finish = resolve; started() }))
    const waiting = late.coordinator.receive(late.request)
    await executing
    late.coordinator.dispose()
    finish(late.result)
    await waiting
    expect(late.dependencies.complete).toHaveBeenCalledWith(expect.objectContaining({ result: late.result, rendererSessionId: 'original-session' }))
  })
})
