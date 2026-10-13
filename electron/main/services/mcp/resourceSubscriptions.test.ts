import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationResourceSubscriptions } from './resourceSubscriptions'
const uri = 'henji://entity/settings.registry/singleton'
const body = { method: 'subscriptions/listen', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' }, notifications: { resourceSubscriptions: [uri] } } }
afterEach(() => { vi.useRealTimers() })
it('后台工程的领域通知独立于当前工程写入基线，仍触发资源核验', async () => {
  vi.useFakeTimers()
  const read = vi.fn(async () => ({ contents: [{ uri, text: JSON.stringify({ revisions: { canvas: 7 } }) }] }))
  const bus = new ApplicationResourceSubscriptions(() => {}, read)
  let unsubscribe = () => {}
  await bus.run('a', body, new AbortController().signal, async () => { unsubscribe = bus.subscribe(vi.fn()) })
  bus.contextChanged({ canvas: 0 }, { canvas: 1 })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(2)
  unsubscribe()
})
it('仅相关作用域推进才核验资源，时间戳变化不会产生更新通知', async () => {
  vi.useFakeTimers()
  let revision = 0
  const read = vi.fn(async () => ({ contents: [{ uri, text: JSON.stringify({ revisions: { settings: revision }, capturedAt: new Date().toISOString() }) }] }))
  const send = vi.fn()
  const bus = new ApplicationResourceSubscriptions(() => {}, read)
  let unsubscribe = () => {}
  await bus.run('a', body, new AbortController().signal, async () => { unsubscribe = bus.subscribe(send) })
  bus.contextChanged({ canvas: 1, settings: 0, navigation: 1 })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledOnce()
  bus.contextChanged({ canvas: 1, settings: 1, navigation: 2 })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(2)
  expect(send).not.toHaveBeenCalled()
  revision = 2
  for (let i = 2; i <= 10; i++) bus.contextChanged({ settings: i })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(3)
  expect(send).toHaveBeenCalledOnce()
  unsubscribe()
})
it('目录变更不冒充资源更新；相同内容不通知，高频变化合并且在途变化不丢失', async () => {
  vi.useFakeTimers()
  let revision = 1
  const value = () => ({ contents: [{ uri, text: JSON.stringify({ revisions: { settings: revision }, properties: { name: `v${revision}` }, capturedAt: new Date().toISOString() }) }] })
  const read = vi.fn(async () => value())
  const send = vi.fn()
  const bus = new ApplicationResourceSubscriptions(() => {}, read)
  let unsubscribe = () => {}
  await bus.run('a', body, new AbortController().signal, async () => { unsubscribe = bus.subscribe(send) })
  bus.publish({ kind: 'resources_list_changed' })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(1)
  send.mockClear()
  for (let i = 0; i < 10; i++) bus.publish({ kind: 'resource_updated', uri })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(2)
  expect(send).not.toHaveBeenCalled()
  let complete!: (result: ReturnType<typeof value>) => void
  read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  revision = 2
  bus.publish({ kind: 'resource_updated', uri })
  await vi.advanceTimersByTimeAsync(300)
  const inFlight = value()
  revision = 3
  for (let i = 0; i < 10; i++) bus.publish({ kind: 'resource_updated', uri })
  complete(inFlight)
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(4)
  expect(send).toHaveBeenCalledTimes(2)
  unsubscribe()
  bus.publish({ kind: 'resource_updated', uri })
  await vi.advanceTimersByTimeAsync(300)
  expect(read).toHaveBeenCalledTimes(4)
})
