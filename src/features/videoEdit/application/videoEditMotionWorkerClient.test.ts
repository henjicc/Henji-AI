import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMotionFixture } from '@/core/creativeIntent/fixtures/motionFixtures'
import type { MotionWorkerRequest, MotionWorkerResponse } from '../engine/videoEditMotionWorkerProtocol'
import { optimizeVideoEditMotionOffThread } from './videoEditMotionWorkerClient'

const host = vi.hoisted(() => ({ owners: [{ document: { id: 'fixture:doc' } }], listeners: new Set<() => void>() }))
vi.mock('./videoEditService', () => ({ listVideoEditInstances: () => host.owners, subscribeVideoEditDomain: (listener: () => void) => { host.listeners.add(listener); return () => host.listeners.delete(listener) } }))
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent<MotionWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: MotionWorkerRequest[] = []
  terminate = vi.fn()
  constructor() { TestWorker.instances.push(this) }
  postMessage(message: MotionWorkerRequest): void { this.messages.push(message); if (message.kind !== 'compile') queueMicrotask(() => this.respond({ kind: 'received' })) }
  respond(data: MotionWorkerResponse): void { this.onmessage?.(new MessageEvent('message', { data })) }
}
const result = { result: { candidates: [], unavailable: [] } }
const tick = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }
beforeEach(() => { vi.useFakeTimers(); TestWorker.instances = []; host.owners = [{ document: { id: 'fixture:doc' } }]; vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { host.owners = []; for (const listener of host.listeners) listener(); expect(host.listeners.size).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals() })

it('流式页按 ACK 送入，完成后复用空闲 Worker，旧取消不影响新任务，关闭立即释放', async () => {
  const input = createMotionFixture('S01').input
  const firstController = new AbortController()
  const pages = async function* () { yield input.samples.slice(0, 2); yield input.samples.slice(2) }
  const first = optimizeVideoEditMotionOffThread({ ...input, samples: [] }, firstController.signal, pages())
  await tick(); await tick()
  const worker = TestWorker.instances[0]
  expect(worker.messages.map(message => message.kind)).toEqual(['begin', 'page', 'page', 'compile'])
  worker.respond(result); await expect(first).resolves.toEqual(result)
  expect(worker.terminate).not.toHaveBeenCalled()
  const second = optimizeVideoEditMotionOffThread(input, new AbortController().signal)
  firstController.abort(); await tick()
  expect(TestWorker.instances).toHaveLength(1); expect(worker.terminate).not.toHaveBeenCalled()
  worker.respond(result); await second
  host.owners = []; for (const listener of host.listeners) listener()
  expect(worker.terminate).toHaveBeenCalledOnce()
})

it('取消独占任务即终止 Worker，迟到结果不回收，后续任务正常重建', async () => {
  const input = createMotionFixture('S01').input; const controller = new AbortController()
  const operation = optimizeVideoEditMotionOffThread(input, controller.signal)
  const outcome = expect(operation).rejects.toThrow('cancelled')
  await tick(); const worker = TestWorker.instances[0]; const late = worker.onmessage
  controller.abort(new Error('cancelled')); await outcome
  late?.(new MessageEvent('message', { data: result }))
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(host.listeners.size).toBe(0)
  const next = optimizeVideoEditMotionOffThread(input, new AbortController().signal); await tick()
  expect(TestWorker.instances).toHaveLength(2)
  TestWorker.instances[1].respond(result); await next
})

it('计算失败不回收进程；成功后的闲置预算到期释放，不保留原稿', async () => {
  const input = createMotionFixture('S01').input
  const failed = optimizeVideoEditMotionOffThread(input, new AbortController().signal)
  const outcome = expect(failed).rejects.toThrow('bad'); await tick()
  TestWorker.instances[0].respond({ error: 'bad', refs: [] }); await outcome
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
  const next = optimizeVideoEditMotionOffThread(input, new AbortController().signal); await tick()
  TestWorker.instances[1].respond(result); await next
  await vi.advanceTimersByTimeAsync(10000)
  expect(TestWorker.instances[1].terminate).toHaveBeenCalledOnce(); expect(host.listeners.size).toBe(0)
})
