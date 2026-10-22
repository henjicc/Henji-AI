import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ load: vi.fn(), flush: vi.fn(), tile: vi.fn(), cancel: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: { spectralTile: mocks.tile, spectralCancel: mocks.cancel } }) }))
vi.mock('./audioEditProjectInstances', () => ({ loadAudioEditProject: mocks.load, flushAudioEditProject: mocks.flush,
  editAudioEditProject: vi.fn(), withAudioEditProjectOperation: vi.fn() }))
import { getAudioEditSpectralTile, cancelAudioEditSpectralTile } from './audioEditRegions'
afterEach(() => { vi.resetAllMocks() })
const request = { projectId: 'p', requestId: 'tile', mode: 'source' as const, level: 0, tile: 0 }
it('保存尚未结束时取消，不会在稍后重新发起已过期的频谱请求', async () => {
  let saved: (() => void) | undefined
  mocks.flush.mockImplementation(() => new Promise<void>(resolve => { saved = resolve }))
  const pending = getAudioEditSpectralTile(request)
  const cancelled = expect(pending).rejects.toThrow('取消')
  await vi.waitFor(() => expect(saved).toBeTypeOf('function'))
  await cancelAudioEditSpectralTile(request.requestId)
  saved?.()
  await cancelled
  expect(mocks.tile).not.toHaveBeenCalled()
})
it('禁止并发复用 requestId，结束后清理本地登记', async () => {
  let finish: (() => void) | undefined
  mocks.tile.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = getAudioEditSpectralTile(request)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await expect(getAudioEditSpectralTile(request)).rejects.toThrow('已在使用')
  finish?.(); await pending
  mocks.tile.mockResolvedValue({ values: new Uint8Array([1, 2]) })
  expect(await getAudioEditSpectralTile(request)).toEqual({ values: new Uint8Array([1, 2]) })
})
