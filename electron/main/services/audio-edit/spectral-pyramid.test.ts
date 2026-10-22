import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { spectralColumnCount } from '../../../../src/core/audioEdit/spectralPyramid'
const state = vi.hoisted(() => ({ directory: '', digest: 'one', edited: 'repair.wav', calls: vi.fn(), info: vi.fn(), error: vi.fn(), hold: false, holdBuild: false, failBuild: false, active: new Set<string>(), releaseBuild: undefined as (() => void) | undefined, release: undefined as (() => void) | undefined }))
vi.mock('./render', () => ({ prepareAudioEditRenderSource: async () => state.edited }))
vi.mock('./project-store', () => ({ requireAudioEditProject: async (id: string) => ({ id, revision: 7, source: { sourcePath: 'source', sampleRate: 48000, channels: 2, durationFrames: 9000 } }) }))
vi.mock('./media', () => ({ audioEditSpectralCacheDirectory: () => state.directory, verifyAudioEditSource: async () => undefined, identifyAudioEditSource: async () => ({ digest: state.digest }), prepareAudioEditAudio: async () => 'decoded.wav' }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: state.info, error: state.error }) }))
vi.mock('./task-store', () => ({ registerAudioEditTaskController: (id: string) => { state.active.add(id); return () => state.active.delete(id) }, runAudioEditTask: () => { throw new Error('频谱不得进入任务表') } }))
vi.mock('./spectral-worker-client', () => ({ spectralWorker: { request: async (command: { type: string; output_path: string; output_directory: string; level: number; column_start: number }, signal?: AbortSignal, progress?: (p: { coveredFrames: number; durationFrames: number; done: boolean }) => void) => {
  state.calls(command, signal)
  if (command.type === 'spectral_build') {
    await fs.mkdir(command.output_directory)
    if (state.holdBuild) await new Promise<void>(resolve => { state.releaseBuild = resolve })
    if (state.failBuild) throw new Error('模拟整文件失败')
    for (const coveredFrames of [1, 2, 3]) progress?.({ coveredFrames, durationFrames: 9000, done: false })
    const manifest = { format: 'spectral-pyramid-v1', sampleRate: 48000, channels: 2, durationFrames: 9000, lowBins: 205, highBins: 1025,
      available: Array.from({ length: 16 }, (_, level) => level < 3 ? 0 : spectralColumnCount(level, 9000)), coveredFrames: 9000, done: true }
    for (let level = 3; level < 16; level++) for (let channel = 0; channel < 2; channel++) {
      await fs.writeFile(path.join(command.output_directory, `level-${level}-channel-${channel}.rg`), new Uint8Array(manifest.available[level] * 2460).fill(channel + 7))
    }
    await fs.writeFile(path.join(command.output_directory, 'manifest.json'), JSON.stringify(manifest))
    progress?.({ coveredFrames: 9000, durationFrames: 9000, done: true })
    return manifest
  }
  if (state.hold) await new Promise<void>((resolve, reject) => {
    state.release = resolve
    signal?.addEventListener('abort', () => reject(new Error('已取消')), { once: true })
  })
  signal?.throwIfAborted()
  const count = Math.min(1024, spectralColumnCount(command.level, 9000) - command.column_start)
  await fs.writeFile(command.output_path, new Uint8Array(count * 4920).fill(71))
  return { sampleRate: 48000, channels: 2, durationFrames: 9000, lowBins: 205, highBins: 1025, columnCount: count }
} } }))
import { getAudioEditSpectralTile, cancelAudioEditSpectralTile, subscribeAudioEditSpectralProgress } from './spectral-pyramid'
const request = { projectId: 'p', mode: 'source' as const, level: 0, tile: 0, requestId: 'one' }
beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pyramid-service-')); state.digest = 'one'; state.edited = 'repair.wav'; state.hold = false; state.holdBuild = false; state.failBuild = false; state.release = undefined; state.releaseBuild = undefined; vi.clearAllMocks() })
afterEach(async () => {
  await vi.waitFor(() => expect(state.info.mock.calls.filter(call => call[1].event === 'audio_edit.spectral.completed').length + state.error.mock.calls.length).toBe(state.calls.mock.calls.filter(call => call[0].type === 'spectral_build').length))
  await vi.waitFor(() => expect(state.active.size).toBe(0))
  await fs.rm(state.directory, { recursive: true, force: true })
})
it('即时块命中磁盘缓存，整文件只启动一次并广播最终进度', async () => {
  const events = vi.fn()
  const stop = subscribeAudioEditSpectralProgress(events)
  const first = await getAudioEditSpectralTile(request)
  expect(first.values).toBeInstanceOf(Uint8Array)
  expect(first).toMatchObject({ revision: 0, complete: true, columnCount: spectralColumnCount(0, 9000) })
  await getAudioEditSpectralTile({ ...request, requestId: 'two' })
  await getAudioEditSpectralTile({ ...request, projectId: 'another-project', requestId: 'another' })
  expect(state.calls.mock.calls.filter(call => call[0].type === 'spectral_tile')).toHaveLength(1)
  await vi.waitFor(() => expect(events).toHaveBeenCalledWith({ projectId: 'p', mode: 'source', revision: 0, coveredFrames: 9000, durationFrames: 9000, done: true }))
  await vi.waitFor(() => expect(state.info).toHaveBeenCalledTimes(2))
  const persisted = await getAudioEditSpectralTile({ ...request, requestId: 'three', level: 3 })
  expect(persisted).toMatchObject({ complete: true, columnCount: 3 })
  expect(persisted.values[0]).toBe(7)
  expect(persisted.values[3 * 2460]).toBe(8)
  expect(state.calls).toHaveBeenCalledTimes(2)
  expect(events.mock.calls.filter(call => !call[0].done)).toHaveLength(1)
  stop()
})
it('identity、mode、edited 渲染键隔离缓存，返回实际作品版本', async () => {
  await getAudioEditSpectralTile(request)
  state.digest = 'two'; await getAudioEditSpectralTile(request)
  expect(await getAudioEditSpectralTile({ ...request, mode: 'edited' })).toMatchObject({ revision: 7 })
  state.edited = 'other.wav'; await getAudioEditSpectralTile({ ...request, mode: 'edited' })
  expect(state.calls.mock.calls.filter(call => call[0].type === 'spectral_tile')).toHaveLength(4)
})
it('取消单个共享读者不影响其他读者，最后一个取消会通知 worker', async () => {
  state.hold = true
  const first = getAudioEditSpectralTile(request)
  const assertion = expect(first).rejects.toThrow()
  const second = getAudioEditSpectralTile({ ...request, requestId: 'two' })
  await vi.waitFor(() => expect(state.release).toBeTypeOf('function'))
  cancelAudioEditSpectralTile('one'); await assertion
  const workerSignal = state.calls.mock.calls.find(call => call[0].type === 'spectral_tile')?.[1] as AbortSignal
  expect(workerSignal.aborted).toBe(false)
  state.release?.(); await second
  state.release = undefined
  const third = getAudioEditSpectralTile({ ...request, level: -1, requestId: 'three' })
  const cancelled = expect(third).rejects.toThrow()
  await vi.waitFor(() => expect(state.release).toBeTypeOf('function'))
  cancelAudioEditSpectralTile('three'); await cancelled
  const lastSignal = state.calls.mock.calls.filter(call => call[0].type === 'spectral_tile').at(-1)?.[1] as AbortSignal
  expect(lastSignal.aborted).toBe(true)
  await vi.waitFor(async () => expect((await fs.readdir(state.directory)).filter(name => name.endsWith('.rg'))).toHaveLength(1))
})
it('请求校验在任何文件或进程操作前拒绝非法输入', async () => {
  for (const invalid of [{ level: 16 }, { level: -6 }, { level: 0.5 }, { tile: -1 }, { mode: 'other' }, { requestId: '' }, { extra: true }]) {
    await expect(getAudioEditSpectralTile({ ...request, ...invalid } as typeof request)).rejects.toThrow()
  }
  expect(state.calls).not.toHaveBeenCalled()
})
it('持久层未计算时返回零列，同素材跨文档并发只启动一次并各自收到进度', async () => {
  state.holdBuild = true
  const events = vi.fn(); const stop = subscribeAudioEditSpectralProgress(events)
  const [a, b] = await Promise.all([
    getAudioEditSpectralTile({ ...request, level: 3 }),
    getAudioEditSpectralTile({ ...request, projectId: 'second', level: 3, requestId: 'second' }),
  ])
  expect(a).toMatchObject({ columnCount: 0, complete: false })
  expect(b).toMatchObject({ columnCount: 0, complete: false })
  await vi.waitFor(() => expect(state.releaseBuild).toBeTypeOf('function'))
  expect(state.calls).toHaveBeenCalledTimes(1)
  expect(state.active.size).toBe(1)
  state.releaseBuild?.()
  await vi.waitFor(() => expect(events.mock.calls.filter(call => call[0].done)).toHaveLength(2))
  expect(await getAudioEditSpectralTile({ ...request, level: 3 })).toMatchObject({ columnCount: 3, complete: true })
  stop()
})
it('整文件失败不发布完成指针，后续请求可以重试', async () => {
  state.holdBuild = true; state.failBuild = true
  expect(await getAudioEditSpectralTile({ ...request, level: 3 })).toMatchObject({ complete: false })
  await vi.waitFor(() => expect(state.releaseBuild).toBeTypeOf('function'))
  state.releaseBuild?.()
  await vi.waitFor(() => expect(state.active.size).toBe(0))
  expect(state.error).toHaveBeenCalledTimes(1)
  expect((await fs.readdir(state.directory)).filter(name => name.endsWith('.pyramid'))).toHaveLength(0)
  state.holdBuild = false; state.failBuild = false
  await getAudioEditSpectralTile({ ...request, level: 3 })
  await vi.waitFor(() => expect(state.info.mock.calls.some(call => call[1].event === 'audio_edit.spectral.completed')).toBe(true))
  expect(await getAudioEditSpectralTile({ ...request, level: 3 })).toMatchObject({ complete: true })
})
