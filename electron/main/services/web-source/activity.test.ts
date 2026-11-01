import { afterEach, expect, it, vi } from 'vitest'
import type { VideoDecoderLifecycleEvent } from '../video-decoder/client'
import type { VideoFrameTarget } from '../video-decoder/texture-bridge'
import { WebCacheActivity } from './activity'
import { WebCacheSubmissions } from './submissions'

afterEach(() => { vi.useRealTimers() })

function fixture() {
  let lifecycle!: (event: VideoDecoderLifecycleEvent) => void
  const service = { ensureStarted: vi.fn(async () => ({})), onLifecycle: vi.fn(listener => { lifecycle = listener; return vi.fn() }),
    webCacheForeground: vi.fn(async (_active: boolean) => undefined), webCacheSubmission: vi.fn(async (_lease: string) => ({ acquired: true })),
    webCacheSubmissionRelease: vi.fn(async (_lease: string) => undefined) }
  const activity = new WebCacheActivity(service as unknown as ConstructorParameters<typeof WebCacheActivity>[0], { warn: vi.fn() })
  const target = (id: number) => {
    let gone!: () => void
    return { value: { id, mainFrame: {} as VideoFrameTarget['mainFrame'], send: vi.fn(), isDestroyed: () => false, onGone: listener => { gone = () => listener('destroyed'); return vi.fn() } } as VideoFrameTarget, gone: () => gone() }
  }
  return { service, activity, target, lifecycle: (event: VideoDecoderLifecycleEvent) => lifecycle(event) }
}

it('宿主活动重叠与瞬时精确观察全部结束才放行；宿主消失不会泄漏活动', async () => {
  vi.useFakeTimers()
  const { activity, service, target } = fixture(), first = target(1), second = target(2)
  await activity.setForeground(first.value, true); await activity.setForeground(second.value, true)
  const work = vi.fn(async () => 'ready'), gate = new WebCacheSubmissions({ info: vi.fn() }, activity)
  const pending = gate.run(work)
  await activity.setForeground(first.value, false)
  await vi.advanceTimersByTimeAsync(100)
  expect(work).not.toHaveBeenCalled()
  second.gone()
  let end!: () => void
  const foreground = activity.foreground(() => new Promise<void>(resolve => { end = resolve }))
  await vi.advanceTimersByTimeAsync(100)
  expect(work).not.toHaveBeenCalled()
  end(); await foreground
  await vi.advanceTimersByTimeAsync(25)
  expect(await pending).toBe('ready')
  expect(service.webCacheSubmissionRelease).toHaveBeenCalledOnce()
  await activity.dispose()
})

it('领取回复期间取消或再次抢占先归还额度；重启后的旧许可失效且不释放新进程', async () => {
  const { activity, service, lifecycle } = fixture()
  let reply!: (result: { acquired: boolean }) => void
  service.webCacheSubmission.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
  const controller = new AbortController()
  const pending = activity.acquire(controller.signal)
  const rejected = expect(pending).rejects.toThrow('cancel')
  await vi.waitFor(() => expect(reply).toBeDefined())
  controller.abort(new Error('cancel')); reply({ acquired: true }); await rejected
  expect(service.webCacheSubmissionRelease).toHaveBeenCalledWith(service.webCacheSubmission.mock.calls[0][0])
  const permit = await activity.acquire()
  lifecycle({ type: 'exited', pid: 1 })
  expect(permit.current()).toBe(false)
  service.webCacheSubmissionRelease.mockClear()
  await permit.release()
  expect(service.webCacheSubmissionRelease).not.toHaveBeenCalled()
  await activity.dispose()
})

it('全局额度等待期间的本地抢占不会漏交工作，也不带着额度等待恢复', async () => {
  let grant!: (permit: { current(): boolean; release(): Promise<void> }) => void
  const release = vi.fn(async () => undefined)
  const coordinator = { acquire: vi.fn(() => new Promise<{ current(): boolean; release(): Promise<void> }>(resolve => { grant = resolve })) }
  const gate = new WebCacheSubmissions({ info: vi.fn() }, coordinator), work = vi.fn(async () => 1)
  const pending = gate.run(work), hold = gate.hold('playing')
  grant({ current: () => true, release })
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  expect(work).not.toHaveBeenCalled()
  hold.resume()
  await vi.waitFor(() => expect(coordinator.acquire).toHaveBeenCalledTimes(2))
  grant({ current: () => true, release })
  expect(await pending).toBe(1)
})
