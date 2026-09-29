import { afterEach, expect, it, vi } from 'vitest'
import { aiGetCachedTtsVoices, aiListTtsVoices, aiSetProviderApiKey } from './aiRuntime'
const runtime = vi.hoisted(() => ({ listTtsVoices: vi.fn(), setProviderApiKey: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => ({ aiRuntime: runtime }) }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

it('复用列表与并发请求，过期或手动刷新再读取，换凭据隔离旧请求', async () => {
  vi.useFakeTimers()
  const voices = [{ id: 'one', name: '声音' }]
  runtime.listTtsVoices.mockResolvedValue(voices)
  await Promise.all([aiListTtsVoices('m'), aiListTtsVoices('m')])
  await aiListTtsVoices('m')
  expect(runtime.listTtsVoices).toHaveBeenCalledTimes(1)
  expect(aiGetCachedTtsVoices('m')).toEqual(voices)
  vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1)
  await aiListTtsVoices('m')
  expect(runtime.listTtsVoices).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1)
  await aiListTtsVoices('m')
  await aiListTtsVoices('m', true)
  expect(runtime.listTtsVoices).toHaveBeenCalledTimes(3)
  let finish!: (value: typeof voices) => void
  runtime.listTtsVoices.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = aiListTtsVoices('m', true)
  await aiSetProviderApiKey('provider', 'replacement')
  finish(voices)
  await pending
  expect(aiGetCachedTtsVoices('m')).toBeUndefined()
  await aiListTtsVoices('m')
  expect(runtime.listTtsVoices).toHaveBeenCalledTimes(5)
})

it('失败不缓存，重试可以恢复', async () => {
  runtime.listTtsVoices.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  await expect(aiListTtsVoices('retry')).rejects.toThrow('offline')
  expect(aiGetCachedTtsVoices('retry')).toBeUndefined()
  await expect(aiListTtsVoices('retry')).resolves.toEqual([])
})
