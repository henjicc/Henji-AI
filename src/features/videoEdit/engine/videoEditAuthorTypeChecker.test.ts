import { afterEach, expect, it, vi } from 'vitest'
import type { CodeTypeCheckResult } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import { VideoEditAuthorTypeChecker, type AuthorTypeCheckRequest, type AuthorTypeCheckWorker } from './videoEditAuthorTypeChecker'

const files = { entry: 'main.ts', files: { 'main.ts': 'export default {name:"x",draw(){}}' } }
const result: CodeTypeCheckResult = { checkedFiles: ['main.ts'], diagnostics: [], total: 0, elapsedMs: 1 }
function fakeWorkers() {
  const workers: Array<AuthorTypeCheckWorker & { requests: AuthorTypeCheckRequest[]; terminated: boolean; reply(id: number): void }> = []
  const create = (): AuthorTypeCheckWorker => {
    const worker = { onmessage: null, onerror: null, onmessageerror: null, requests: [] as AuthorTypeCheckRequest[], terminated: false,
      postMessage(message: AuthorTypeCheckRequest) { worker.requests.push(message) },
      terminate() { worker.terminated = true },
      reply(id: number) { worker.onmessage?.({ data: { id, typeCheck: result } } as MessageEvent) } } as (typeof workers)[number]
    workers.push(worker); return worker
  }
  return { workers, create }
}
afterEach(() => { vi.useRealTimers() })

it('检查线程常驻复用：取消只放弃这次结果，空闲后才释放', async () => {
  vi.useFakeTimers()
  const { workers, create } = fakeWorkers()
  const checker = new VideoEditAuthorTypeChecker(create, 20_000, 1000)
  const controller = new AbortController()
  const cancelled = checker.check(files, ['main.ts'], controller.signal)
  controller.abort(new Error('不要了'))
  await expect(cancelled).rejects.toThrow('不要了')
  const next = checker.check(files, ['main.ts'])
  expect(workers).toHaveLength(1)
  expect(workers[0].terminated).toBe(false)
  workers[0].reply(workers[0].requests[0].id)
  workers[0].reply(workers[0].requests[1].id)
  await expect(next).resolves.toEqual(result)
  vi.advanceTimersByTime(999); expect(workers[0].terminated).toBe(false)
  vi.advanceTimersByTime(1); expect(workers[0].terminated).toBe(true)
  const restarted = checker.check(files, ['main.ts'])
  expect(workers).toHaveLength(2)
  workers[1].reply(workers[1].requests[0].id)
  await expect(restarted).resolves.toEqual(result)
  checker.dispose()
})

it('超时或线程出错时结束线程并让所有等待者得到错误，下一次重新启动', async () => {
  vi.useFakeTimers()
  const { workers, create } = fakeWorkers()
  const checker = new VideoEditAuthorTypeChecker(create, 5000, 60_000)
  const first = checker.check(files, ['main.ts']), second = checker.check(files, ['main.ts'])
  vi.advanceTimersByTime(5000)
  await expect(first).rejects.toThrow('类型检查超过 5 秒未完成')
  await expect(second).rejects.toThrow('类型检查超过 5 秒未完成')
  expect(workers[0].terminated).toBe(true)
  const crashed = checker.check(files, ['main.ts'])
  workers[1].onerror?.({ message: '内存不足', preventDefault() {} } as ErrorEvent)
  await expect(crashed).rejects.toThrow('类型检查线程失败：内存不足')
  expect(workers[1].terminated).toBe(true)
  checker.dispose()
})
