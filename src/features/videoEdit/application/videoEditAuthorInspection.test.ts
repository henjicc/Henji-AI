import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import type { VideoEditRenderTransport } from '../engine/videoEditRenderTransport'
import { inspectVideoEditAuthor } from './videoEditAuthorInspection'

const state = vi.hoisted(() => ({ starts: 0, reads: vi.fn(), release: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined) }))
vi.mock('../engine/videoEditRenderTransport', () => ({ VideoEditRenderTransport: class {
  constructor() { state.starts++ }
  async replaceContent() {}
  readAuthorMetadata = state.reads
  releaseAuthor = state.release
  dispose = state.dispose
} }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { memoryInfo: async () => ({ availableBytes: 4 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 }) } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('作者检查不等待正在准备字体的文档租约；复用检查线程并在空闲时释放', async () => {
  vi.useFakeTimers()
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:author', revokeObjectURL: revoke })
  state.reads.mockResolvedValue({ name: 'author', kind: 'generator', mode: 'dynamic', parameters: [] })
  const document = createVideoEditTestDocument('inspection')
  const lease = await videoEditOffscreenPool.acquire(videoEditComposition(document, document.sequences[0].id), new AbortController().signal,
    async () => ({ dispose: async () => undefined }) as unknown as VideoEditRenderTransport)
  try {
    const bundle = { code: 'export default {}', map: '', locations: { layers: {} } }
    expect((await inspectVideoEditAuthor(bundle)).name).toBe('author')
    // 参数声明按编译输入的作者接口解析；没有指定时仍是 v4。
    expect(state.reads.mock.lastCall?.[2]).toBeUndefined()
    expect(await inspectVideoEditAuthor({ ...bundle, apiVersion: 5 })).toMatchObject({ apiVersion: 5 })
    expect(state.reads.mock.lastCall?.[2]).toBe(5)
    expect(state.starts).toBe(1)
    expect(state.release).toHaveBeenCalledTimes(2)
    expect(revoke).toHaveBeenCalledTimes(2)
    expect(state.dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state.dispose).toHaveBeenCalledOnce()
  } finally { await lease.release(true) }
})
