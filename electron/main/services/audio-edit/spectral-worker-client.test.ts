import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), once: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./audio-worker-client', () => ({ audioWorkerExecutablePath: () => 'worker' }))
vi.mock('electron', () => ({ app: { once: mocks.once } }))
import { SpectralWorkerClient } from './spectral-worker-client'
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
function child() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
}
function requests(process: ReturnType<typeof child>): Array<{ id: string; type: string; request_id?: string }> {
  return process.stdin.read().toString().trim().split('\n').map((s: string) => JSON.parse(s))
}
function respond(process: ReturnType<typeof child>, id: string, result: unknown): void { process.stdout.write(`${JSON.stringify({ version: 1, id, ok: true, result })}\n`) }
it('懒启动、复用进程、按 id 路由乱序回执与进度，退出时终止', async () => {
  const process = child(); mocks.spawn.mockReturnValue(process)
  const client = new SpectralWorkerClient()
  expect(mocks.spawn).not.toHaveBeenCalled()
  const progress = vi.fn()
  const a = client.request({ type: 'spectral_build' }, undefined, progress)
  const b = client.request({ type: 'spectral_tile' })
  const [one, two] = requests(process)
  process.stdout.write(`${JSON.stringify({ version: 1, id: one.id, event: 'progress', progress: { coveredFrames: 10, durationFrames: 100, done: false } })}\n`)
  respond(process, two.id, 'tile'); respond(process, one.id, 'done')
  expect(await b).toBe('tile'); expect(await a).toBe('done')
  expect(progress).toHaveBeenCalledTimes(1)
  expect(mocks.spawn).toHaveBeenCalledTimes(1)
  expect(mocks.spawn.mock.calls[0][1]).toEqual(['--spectral-server'])
  const quit = mocks.once.mock.calls[0][1] as () => void
  quit(); expect(process.kill).toHaveBeenCalled()
  expect(() => client.request({ type: 'ping' })).toThrow('退出')
})
it('崩溃明确失败所有在途请求，下次请求自动重启', async () => {
  const old = child(); const next = child(); mocks.spawn.mockReturnValueOnce(old).mockReturnValueOnce(next)
  const client = new SpectralWorkerClient()
  const a = expect(client.request({ type: 'spectral_tile' })).rejects.toThrow('退出')
  const b = expect(client.request({ type: 'spectral_build' })).rejects.toThrow('退出')
  old.emit('close', 9)
  await Promise.all([a, b])
  const retry = client.request({ type: 'spectral_tile' })
  respond(next, requests(next)[0].id, 'recovered')
  expect(await retry).toBe('recovered')
  client.dispose()
})
it('取消发送目标 id，等待停止回执后才结束，其他请求仍正常', async () => {
  const process = child(); mocks.spawn.mockReturnValue(process)
  const client = new SpectralWorkerClient(); const controller = new AbortController()
  const result = client.request({ type: 'spectral_tile' }, controller.signal)
  const assertion = expect(result).rejects.toThrow('取消')
  const id = requests(process)[0].id
  controller.abort()
  expect(requests(process)[0]).toMatchObject({ type: 'cancel', request_id: id })
  respond(process, id, 'late')
  await assertion
  expect(process.kill).not.toHaveBeenCalled()
  client.dispose()
})
it('排队中被取消的请求收到“已取消”回执即按取消结束，不触发宽限终止，其他在途请求不受影响', async () => {
  vi.useFakeTimers()
  const process = child(); mocks.spawn.mockReturnValue(process)
  const client = new SpectralWorkerClient(); const controller = new AbortController()
  const running = client.request({ type: 'spectral_tile' })
  const queued = client.request({ type: 'spectral_tile' }, controller.signal)
  const assertion = expect(queued).rejects.toThrow('频谱读取已取消')
  const [first, second] = requests(process)
  controller.abort()
  expect(requests(process)[0]).toMatchObject({ type: 'cancel', request_id: second.id })
  // worker 拿闸前发现已取消，立即回执失败“已取消”：主进程按取消处理，而不是计算失败。
  process.stdout.write(`${JSON.stringify({ version: 1, id: second.id, ok: false, error: '频谱计算已取消' })}
`)
  await assertion
  await vi.advanceTimersByTimeAsync(5000)
  expect(process.kill).not.toHaveBeenCalled()
  respond(process, first.id, 'tile')
  expect(await running).toBe('tile')
  client.dispose()
})
it('请求超时先取消，无回执则关闭进程，所有等待明确失败', async () => {
  vi.useFakeTimers()
  const process = child(); mocks.spawn.mockReturnValue(process)
  const client = new SpectralWorkerClient()
  const assertion = expect(client.request({ type: 'spectral_tile' }, undefined, undefined, 100)).rejects.toThrow('TIMEOUT')
  const id = requests(process)[0].id
  await vi.advanceTimersByTimeAsync(100)
  expect(requests(process)[0]).toMatchObject({ type: 'cancel', request_id: id })
  await vi.advanceTimersByTimeAsync(2000)
  process.emit('close', 1)
  await assertion
  expect(process.kill).toHaveBeenCalled()
  client.dispose()
})
