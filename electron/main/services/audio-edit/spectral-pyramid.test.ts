import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { spectralColumnCount, spectralHighBins, spectralLowBins } from '../../../../src/core/audioEdit/spectralPyramid'
import { audioRenderKey } from './render-cache'
const state = vi.hoisted(() => ({ directory: '', digest: 'one', edited: 'repair.wav', calls: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), hold: false, holdBuild: false, failBuild: false, failDerive: false, frames: 9000, capabilities: { deriveGroupLevel: 9 } as { deriveGroupLevel?: number }, active: new Set<string>(), releaseBuild: undefined as (() => void) | undefined, release: undefined as (() => void) | undefined }))
vi.mock('./render', () => ({ prepareAudioEditRenderSource: async () => state.edited }))
vi.mock('./project-store', () => ({ requireAudioEditProject: async (id: string) => ({ id, revision: 7, source: { sourcePath: 'source', sampleRate: 48000, channels: 2, durationFrames: state.frames } }) }))
vi.mock('./media', () => ({ audioEditSpectralCacheDirectory: () => state.directory, verifyAudioEditSource: async () => undefined, identifyAudioEditSource: async () => ({ digest: state.digest }), prepareAudioEditAudio: async () => 'decoded.wav' }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: state.info, warn: state.warn, error: state.error }) }))
vi.mock('../audio/cache-budget', () => ({ audioDiskBudgetBytes: () => 1024 ** 3 }))
vi.mock('./task-store', () => ({ registerAudioEditTaskController: (id: string) => { state.active.add(id); return () => state.active.delete(id) }, runAudioEditTask: () => { throw new Error('频谱不得进入任务表') } }))
vi.mock('./spectral-worker-client', () => ({ spectralWorker: { capabilities: async () => state.capabilities, request: async (command: { type: string; output_path: string; output_directory: string; parent_directory: string; level: number; column_start: number }, signal?: AbortSignal, progress?: (p: { coveredFrames: number; durationFrames: number; done: boolean }) => void) => {
  state.calls(command, signal)
  if (command.type === 'spectral_derive') {
    // 与原生派生一致：新目录不得已存在，复制上一版后发布完成清单
    await fs.mkdir(command.output_directory)
    if (state.failDerive) throw new Error('上一版频谱没有第 9 层未量化列')
    for (const name of await fs.readdir(command.parent_directory)) await fs.copyFile(path.join(command.parent_directory, name), path.join(command.output_directory, name))
    return { recomputedFrames: 1024 }
  }
  if (command.type === 'spectral_build') {
    await fs.mkdir(command.output_directory, { recursive: true })
    if (state.holdBuild) await new Promise<void>(resolve => { state.releaseBuild = resolve })
    if (state.failBuild) {
      // 失败前已算完一部分：清单记录覆盖位置，未完成。
      await fs.writeFile(path.join(command.output_directory, 'manifest.json'), JSON.stringify({ format: 'spectral-pyramid-v1', sampleRate: 48000, channels: 2, durationFrames: state.frames, lowBins: 205, highBins: 1025,
        available: Array.from({ length: 16 }, () => 0), coveredFrames: 4000, done: false }))
      throw new Error('模拟整文件失败')
    }
    for (const coveredFrames of [1, 2, 3]) progress?.({ coveredFrames, durationFrames: state.frames, done: false })
    const manifest = { format: 'spectral-pyramid-v1', sampleRate: 48000, channels: 2, durationFrames: state.frames, lowBins: 205, highBins: 1025,
      available: Array.from({ length: 16 }, (_, level) => level < 3 ? 0 : spectralColumnCount(level, state.frames)), coveredFrames: state.frames, done: true }
    for (let level = 3; level < 16; level++) for (let channel = 0; channel < 2; channel++) {
      await fs.writeFile(path.join(command.output_directory, `level-${level}-channel-${channel}.rg`), new Uint8Array(manifest.available[level] * 2460).fill(channel + 7))
    }
    await fs.writeFile(path.join(command.output_directory, 'manifest.json'), JSON.stringify(manifest))
    progress?.({ coveredFrames: state.frames, durationFrames: state.frames, done: true })
    return manifest
  }
  if (state.hold) await new Promise<void>((resolve, reject) => {
    state.release = resolve
    signal?.addEventListener('abort', () => reject(new Error('已取消')), { once: true })
  })
  signal?.throwIfAborted()
  const count = Math.min(1024, spectralColumnCount(command.level, state.frames) - command.column_start)
  const lowBins = spectralLowBins(48000, command.level), highBins = spectralHighBins(command.level)
  await fs.writeFile(command.output_path, new Uint8Array(count * 2 * (lowBins + highBins) * 2).fill(71))
  return { sampleRate: 48000, channels: 2, durationFrames: state.frames, lowBins, highBins, columnCount: count }
} } }))
import { getAudioEditSpectralTile, cancelAudioEditSpectralTile, subscribeAudioEditSpectralProgress } from './spectral-pyramid'
import { recordAudioLineage } from '../audio/lineage'
const request = { projectId: 'p', mode: 'source' as const, level: 0, tile: 0, requestId: 'one' }
beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pyramid-service-')); state.digest = 'one'; state.edited = 'repair.wav'; state.hold = false; state.holdBuild = false; state.failBuild = false; state.failDerive = false; state.frames = 9000; state.capabilities = { deriveGroupLevel: 9 }; state.release = undefined; state.releaseBuild = undefined; vi.clearAllMocks() })
const logged = (event: string): Array<Record<string, unknown>> => state.info.mock.calls.filter(call => call[1].event === event).map(call => call[1].context)
afterEach(async () => {
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed').length + state.error.mock.calls.length).toBe(logged('audio_edit.spectral.start').length))
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
it('负层忽略固定窗旧块，按实际频点返回，整文件缓存仍可复用', async () => {
  const key = audioRenderKey(['spectral-pyramid-v1', { digest: state.digest }, undefined, 48000, 2, 9000, 'source', undefined])
  const oldFile = path.join(state.directory, `${audioRenderKey([key, -5, 0])}.rg`)
  await fs.writeFile(oldFile, new Uint8Array(128).fill(99))
  const fine = await getAudioEditSpectralTile({ ...request, level: -5 })
  expect([fine.lowBins, fine.highBins]).toEqual([spectralLowBins(48000, -5), spectralHighBins(-5)])
  expect(fine.values.length).toBe(fine.columnCount * fine.channels * (fine.lowBins + fine.highBins) * 2)
  expect(fine.values[0]).toBe(71)
  await getAudioEditSpectralTile({ ...request, level: -5 })
  await getAudioEditSpectralTile({ ...request, level: -3 })
  expect(state.calls.mock.calls.filter(call => call[0].type === 'spectral_tile')).toHaveLength(2)
  expect(state.calls.mock.calls.filter(call => call[0].type === 'spectral_build')).toHaveLength(1)
  expect((await fs.readFile(oldFile))[0]).toBe(99)
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
it('整文件失败不发布完成指针、保留已算部分，后续请求在同一目录续算', async () => {
  state.holdBuild = true; state.failBuild = true
  expect(await getAudioEditSpectralTile({ ...request, level: 3 })).toMatchObject({ complete: false })
  await vi.waitFor(() => expect(state.releaseBuild).toBeTypeOf('function'))
  state.releaseBuild?.()
  await vi.waitFor(() => expect(state.active.size).toBe(0))
  expect(state.error).toHaveBeenCalledTimes(1)
  expect((await fs.readdir(state.directory)).filter(name => name.endsWith('.pyramid'))).toHaveLength(0)
  const builds = (): string[] => state.calls.mock.calls.filter(call => call[0].type === 'spectral_build').map(call => call[0].output_directory)
  expect((await fs.readdir(builds()[0])).includes('manifest.json')).toBe(true)
  state.holdBuild = false; state.failBuild = false
  await getAudioEditSpectralTile({ ...request, level: 3 })
  await vi.waitFor(() => expect(state.info.mock.calls.some(call => call[1].event === 'audio_edit.spectral.completed')).toBe(true))
  expect(await getAudioEditSpectralTile({ ...request, level: 3 })).toMatchObject({ complete: true })
  expect(builds()).toHaveLength(2)
  expect(builds()[1]).toBe(builds()[0])
})
it('同素材并发读取只由一个读取者清理残留目录：续算覆盖最多的那份，其余删除，计算目录不被误删', async () => {
  state.holdBuild = true
  const key = audioRenderKey(['spectral-pyramid-v1', { digest: state.digest }, undefined, 48000, 2, 9000, 'source', undefined])
  const partial = path.join(state.directory, `${key}-11111111-1111-1111-1111-111111111111`)
  const stale = path.join(state.directory, `${key}-22222222-2222-2222-2222-222222222222`)
  await fs.mkdir(partial); await fs.mkdir(stale)
  await fs.writeFile(path.join(partial, 'manifest.json'), JSON.stringify({ format: 'spectral-pyramid-v1', sampleRate: 48000, channels: 2, durationFrames: 9000, lowBins: 205, highBins: 1025,
    available: Array.from({ length: 16 }, () => 0), coveredFrames: 4000, done: false }))
  const reads = Array.from({ length: 4 }, (_, index) => getAudioEditSpectralTile({ ...request, level: 3, requestId: `r${index}` }))
  await Promise.all(reads)
  await vi.waitFor(() => expect(state.releaseBuild).toBeTypeOf('function'))
  const builds = state.calls.mock.calls.filter(call => call[0].type === 'spectral_build')
  expect(builds).toHaveLength(1)
  expect(builds[0][0].output_directory).toBe(partial)
  await expect(fs.stat(stale)).rejects.toThrow()
  expect((await fs.stat(partial)).isDirectory()).toBe(true)
  state.releaseBuild?.()
  await vi.waitFor(() => expect(state.info.mock.calls.some(call => call[1].event === 'audio_edit.spectral.completed')).toBe(true))
})

it('编辑后声音按来历派生：找到上一版已算完的目录，只重算改动波及的列，不整段计算；派生失败在同一目录整段计算', async () => {
  // 一分钟的声音：改动只碰到一两组（每组约 5.5 秒），值得派生
  state.frames = 48000 * 60
  const edited = { ...request, mode: 'edited' as const, level: 3 }
  const versions = ['first.wav', 'second.wav', 'third.wav'].map(name => path.join(state.directory, name))
  for (const file of versions) await fs.writeFile(file, file)
  state.edited = versions[0]
  await getAudioEditSpectralTile(edited)
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(1))
  await recordAudioLineage(versions[1], state.frames, { file: versions[0], dirty: [[1000, 2000]] })
  state.edited = versions[1]
  await getAudioEditSpectralTile({ ...edited, requestId: 'second' })
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(2))
  const commands = state.calls.mock.calls.map(call => call[0])
  expect(commands.filter(command => command.type === 'spectral_build')).toHaveLength(1)
  const derive = commands.find(command => command.type === 'spectral_derive')
  expect(derive).toMatchObject({ input_path: versions[1], parent_directory: commands[0].output_directory, dirty: [[1000, 2000]] })
  expect(logged('audio_edit.spectral.completed')[1]).toMatchObject({ derived: true, recomputedFrames: 1024, durationFrames: state.frames, hops: 1 })
  expect(await getAudioEditSpectralTile({ ...edited, requestId: 'third' })).toMatchObject({ complete: true, columnCount: 704 })
  // 派生不成：记一条退回日志，同一目录整段计算
  state.failDerive = true
  await recordAudioLineage(versions[2], state.frames, { file: versions[1], dirty: [[5000, 6000]] })
  state.edited = versions[2]
  await getAudioEditSpectralTile({ ...edited, requestId: 'fourth' })
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(3))
  expect(state.warn.mock.calls.map(call => call[1].event)).toEqual(['audio_edit.spectral.derive_fallback'])
  const last = state.calls.mock.calls.map(call => call[0]).slice(-2)
  expect(last.map(command => command.type)).toEqual(['spectral_derive', 'spectral_build'])
  expect(last[1].output_directory).toBe(last[0].output_directory)
  expect(logged('audio_edit.spectral.completed')[2]).toMatchObject({ derived: false, recomputedFrames: state.frames })
  // 改动散布到一半以上的组：不派生，直接整段计算
  state.failDerive = false
  const fourth = path.join(state.directory, 'fourth.wav')
  await fs.writeFile(fourth, fourth)
  await recordAudioLineage(fourth, state.frames, { file: versions[2], dirty: Array.from({ length: 10 }, (_, index) => [index * 290_000, index * 290_000 + 100] as [number, number]) })
  state.edited = fourth
  await getAudioEditSpectralTile({ ...edited, requestId: 'fifth' })
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(4))
  expect(state.calls.mock.calls.map(call => call[0].type).at(-1)).toBe('spectral_build')
})

it('细层块：用到的声音与上一版完全相同时直接用上一版算好的块，碰到改动的块才重算', async () => {
  state.frames = 48000 * 60
  const edited = { ...request, mode: 'edited' as const, level: -5 }
  const versions = ['first.wav', 'second.wav'].map(name => path.join(state.directory, name))
  for (const file of versions) await fs.writeFile(file, file)
  state.edited = versions[0]
  const before = await getAudioEditSpectralTile({ ...edited, tile: 10 })
  await getAudioEditSpectralTile({ ...edited, tile: 0, requestId: 'zero' })
  await recordAudioLineage(versions[1], state.frames, { file: versions[0], dirty: [[1000, 2000]] })
  state.edited = versions[1]
  const tiles = (): number => state.calls.mock.calls.filter(call => call[0].type === 'spectral_tile').length
  expect(tiles()).toBe(2)
  // 第 10 块（约 3.4 秒处）离改动很远：沿用；第 0 块盖着改动：重算
  expect(Buffer.from((await getAudioEditSpectralTile({ ...edited, tile: 10, requestId: 'reused' })).values).equals(Buffer.from(before.values))).toBe(true)
  expect(tiles()).toBe(2)
  await getAudioEditSpectralTile({ ...edited, tile: 0, requestId: 'changed' })
  expect(tiles()).toBe(3)
})

it('来历跨两代：中间一版的频谱没算过时从再上一版派生，改动的帧两代合并；频谱进程不支持派生就直接整段', async () => {
  state.frames = 48000 * 60
  const edited = { ...request, mode: 'edited' as const, level: 3 }
  const versions = ['a.wav', 'b.wav', 'c.wav', 'd.wav'].map(name => path.join(state.directory, name))
  for (const file of versions) await fs.writeFile(file, file)
  state.edited = versions[0]
  await getAudioEditSpectralTile(edited)
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(1))
  await recordAudioLineage(versions[1], state.frames, { file: versions[0], dirty: [[1000, 2000]] })
  await recordAudioLineage(versions[2], state.frames, { file: versions[1], dirty: [[5000, 6000]] })
  state.edited = versions[2]
  await getAudioEditSpectralTile({ ...edited, requestId: 'c' })
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(2))
  const derive = state.calls.mock.calls.map(call => call[0]).find(command => command.type === 'spectral_derive')
  expect(derive).toMatchObject({ input_path: versions[2], dirty: [[1000, 2000], [5000, 6000]] })
  expect(logged('audio_edit.spectral.completed')[1]).toMatchObject({ derived: true, hops: 2 })
  // 旧的频谱可执行文件不报派生能力：不发它认不出的命令
  state.capabilities = {}
  await recordAudioLineage(versions[3], state.frames, { file: versions[2], dirty: [[7000, 8000]] })
  state.edited = versions[3]
  await getAudioEditSpectralTile({ ...edited, requestId: 'd' })
  await vi.waitFor(() => expect(logged('audio_edit.spectral.completed')).toHaveLength(3))
  expect(state.calls.mock.calls.map(call => call[0].type).filter(type => type === 'spectral_derive')).toHaveLength(1)
  expect(logged('audio_edit.spectral.completed')[2]).toMatchObject({ derived: false })
})
