import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditSpectralProgress, AudioEditSpectralTile, AudioEditSpectralTileRequest } from '@/core/audioEdit/spectralPyramid'
import { SpectralTileStore } from '@/core/audio/spectralTiles'
const mocks = vi.hoisted(() => ({ load: vi.fn(), flush: vi.fn(), current: vi.fn(), tile: vi.fn(), cancel: vi.fn(), progress: vi.fn(), editedSource: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: { spectralTile: mocks.tile, spectralCancel: mocks.cancel, onSpectralProgress: mocks.progress, editedSource: mocks.editedSource } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }) }))
vi.mock('./audioEditProjectInstances', () => ({ loadAudioEditProject: mocks.load, flushAudioEditProject: mocks.flush, getAudioEditProjectInstance: mocks.current,
  editAudioEditProject: vi.fn(), withAudioEditProjectOperation: vi.fn() }))
import { getAudioEditSpectralTile, cancelAudioEditSpectralTile, audioEditSpectralClient, getAudioEditEditedSource } from './audioEditRegions'
import { SpectralTileScheduler } from '../spectral/useAudioEditSpectral'

/** 内存版本每改一次加一，文件版本每保存一次加一：打开时都是 3，之后改了 9 次、只保存了 1 次。 */
function instance(memory = 12, file = 4) {
  return { document: { revision: memory }, persistedRevision: file }
}
let current: ReturnType<typeof instance>
beforeEach(() => {
  current = instance()
  mocks.load.mockImplementation(async () => current)
  mocks.current.mockImplementation(() => current)
  // 保存屏障：写入一次，文件版本加一
  mocks.flush.mockImplementation(async () => { current.persistedRevision += 1 })
})
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
  mocks.tile.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ values: new Uint8Array() }) }))
  const pending = getAudioEditSpectralTile(request)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await expect(getAudioEditSpectralTile(request)).rejects.toThrow('已在使用')
  finish?.(); await pending
  mocks.tile.mockResolvedValue({ values: new Uint8Array([1, 2]) })
  expect(await getAudioEditSpectralTile(request)).toEqual({ values: new Uint8Array([1, 2]) })
})

const edited = (overrides: Partial<AudioEditSpectralTileRequest> = {}): AudioEditSpectralTileRequest => ({ projectId: 'p', requestId: crypto.randomUUID(), mode: 'edited', level: 0, tile: 0, ...overrides })
const hostTile = (request: AudioEditSpectralTileRequest, revision: number): AudioEditSpectralTile => ({ mode: request.mode, revision, level: request.level, tile: request.tile, sampleRate: 48000, channels: 1,
  durationFrames: 48000, lowBins: 1, highBins: 1, columnStart: 0, columnCount: 1, complete: true, values: new Uint8Array(4) })

it('宿主按文件版本标的剪后块换算成内存版本：连着改几次只保存一次后，新声音的块不会被当成过期丢掉', async () => {
  mocks.tile.mockImplementation(async (tileRequest: AudioEditSpectralTileRequest) => hostTile(tileRequest, current.persistedRevision))
  // 改完声音那一刻的内存版本是 12，宿主读到的是这次保存后的文件版本 5
  const store = new SpectralTileStore()
  const scheduler = new SpectralTileScheduler(audioEditSpectralClient, store, { projectId: 'p', mode: 'edited', revision: 12 }, () => {}, () => {})
  scheduler.setNeeds([{ level: 0, tile: 0 }])
  await vi.waitFor(() => expect(store.version).toBe(1))
  expect(store.get(0, 0)?.revision).toBe(12)
  scheduler.dispose()
})

it('整段进度同样换算：当前声音的进度认，改声音之前那遍计算的进度不认', async () => {
  let emit: (progress: AudioEditSpectralProgress) => void = () => {}
  mocks.progress.mockImplementation((listener: typeof emit) => { emit = listener; return () => {} })
  mocks.tile.mockImplementation(async (tileRequest: AudioEditSpectralTileRequest) => hostTile(tileRequest, current.persistedRevision))
  await getAudioEditSpectralTile(edited())
  const received: AudioEditSpectralProgress[] = []
  audioEditSpectralClient.subscribe(progress => received.push(progress))
  emit({ projectId: 'p', mode: 'edited', revision: 5, coveredFrames: 10, durationFrames: 48000, done: false })
  emit({ projectId: 'p', mode: 'edited', revision: 4, coveredFrames: 48000, durationFrames: 48000, done: true })
  emit({ projectId: 'p', mode: 'source', revision: 0, coveredFrames: 10, durationFrames: 48000, done: false })
  expect(received.map(progress => progress.revision)).toEqual([12, -1, 0])
  // 重新打开（新实例）后旧记录作废，内存版本从文件版本重新数起
  current = instance(5, 5)
  emit({ projectId: 'p', mode: 'edited', revision: 5, coveredFrames: 10, durationFrames: 48000, done: false })
  expect(received.at(-1)?.revision).toBe(-1)
})

it('波形要剪后声音前先保存，主进程拿到的是这次改完的作品', async () => {
  const order: string[] = []
  mocks.flush.mockImplementation(async () => { order.push('flush') })
  mocks.editedSource.mockImplementation(async () => { order.push('editedSource'); return { audioPath: 'edited.wav' } })
  expect(await getAudioEditEditedSource('p')).toEqual({ audioPath: 'edited.wav' })
  expect(order).toEqual(['flush', 'editedSource'])
})
