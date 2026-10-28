import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VideoEditInstance } from './videoEditService'

const state = vi.hoisted(() => ({ read: vi.fn(), ensure: vi.fn() }))
vi.mock('./videoEditCodeState', () => {
  class VideoEditCodeMetadataPending extends Error { constructor(readonly ready: Promise<void>) { super('正在读取代码参数…') } }
  return { VideoEditCodeMetadataPending, readVideoEditCodeMetadata: () => state.read, ensureVideoEditCodeParameterMetadata: state.ensure }
})
const { settleVideoEditCodeDeclarations, subscribeVideoEditCodeDeclarations, videoEditCodeDeclarationReader } = await import('./videoEditCodeDeclarations')
const { VideoEditCodeMetadataPending } = await import('./videoEditCodeState')

const instance = { definitionId: 'film', versionId: 'v5', parameters: {} }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
afterEach(() => { vi.restoreAllMocks(); state.read.mockReset(); state.ensure.mockReset() })

describe('应用层的代码声明读取器', () => {
  it('第一次读不出来以后按整份计入继续，不再回到读取中；过了重试间隔在后台重读，失败只刷新失败时刻，读好了通知更新', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const owner = { document: {} } as VideoEditInstance
    const failed = Promise.reject(new Error('编译不过')); failed.catch(() => undefined)
    state.read.mockImplementation(() => { throw new VideoEditCodeMetadataPending(failed) })
    const notified = vi.fn(), unsubscribe = subscribeVideoEditCodeDeclarations(notified)
    try {
      const read = videoEditCodeDeclarationReader(owner)
      // 第一次：读取中，等它的调用方拿到的是“读不出来”
      expect(await settleVideoEditCodeDeclarations(() => read(instance))).toBeUndefined()
      expect(state.read).toHaveBeenCalledTimes(1)
      // 重试间隔内：直接按退路，不读、不重编译
      now += 10_000
      expect(read(instance)).toBeUndefined()
      expect(state.read).toHaveBeenCalledTimes(1); expect(state.ensure).not.toHaveBeenCalled()
      // 过了间隔：仍按退路返回，后台重读一次；重读进行中不重复发起
      let fail!: (error: Error) => void
      state.ensure.mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject }))
      now += 30_000
      expect(read(instance)).toBeUndefined(); expect(read(instance)).toBeUndefined()
      expect(state.ensure).toHaveBeenCalledTimes(1)
      // 后台重读失败：刷新失败时刻，再等一个间隔才重读
      fail(new Error('还是编译不过')); await settle()
      now += 10_000
      expect(read(instance)).toBeUndefined()
      expect(state.ensure).toHaveBeenCalledTimes(1)
      expect(notified).not.toHaveBeenCalled()
      // 再过一个间隔：重读成功，通知订阅方，之后照常读声明
      state.ensure.mockResolvedValueOnce(undefined)
      now += 30_000
      expect(read(instance)).toBeUndefined()
      await settle()
      expect(notified).toHaveBeenCalledTimes(1)
      const parameters = [{ key: 'film', type: 'scene' }]
      state.read.mockImplementation(() => ({ parameters }))
      expect(read(instance)).toBe(parameters)
      expect(state.read).toHaveBeenCalledTimes(2)
    } finally { unsubscribe() }
  })
})
