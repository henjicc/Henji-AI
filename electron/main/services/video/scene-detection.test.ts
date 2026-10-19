import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContentDiskCache } from '../media/content-disk-cache'
import { SceneDetectionService } from './scene-detection'
import { ScreenChangeAccumulator } from '../../../../src/core/videoEdit/screenChanges'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-scenes-unit-')); directories.push(directory)
  const source = path.join(directory, 'video'); await fs.writeFile(source, 'initial-video-content')
  const cache = createContentDiskCache({ directory: () => path.join(directory, 'cache'), extension: '.json' })
  return { source, cache, request: { requestId: 'test', source, startSeconds: 1, endSeconds: 5, sensitivity: 50 } }
}
it('局部变化使用同一内容缓存与并发槽位，模式分开，不把候选变成镜头切点', async () => {
  const { cache, request, source } = await fixture()
  const accumulator = new ScreenChangeAccumulator({ width: 2, height: 1, channels: 1, fps: 5, startSeconds: 1, endSeconds: 5 })
  for (let frame = 0; frame < 20; frame++) accumulator.push(Uint8Array.of(frame === 3 ? 255 : 0, 0))
  const screenResult = { coarse: accumulator.finish(), refinements: [], omittedCandidates: 1 }
  const run = vi.fn(async () => [2]); const screen = vi.fn(async () => structuredClone(screenResult))
  const service = new SceneDetectionService(cache, run, screen)
  const input = { ...request, analysis: 'screen_changes' as const }
  expect(await service.detect(input, new AbortController().signal, () => undefined)).toMatchObject({ cutsSeconds: [], screenChanges: { coarse: { candidates: [{ kind: 'transient' }] } } })
  await service.detect({ ...input, sensitivity: 90 }, new AbortController().signal, () => undefined)
  expect(screen).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled()
  await service.detect(request, new AbortController().signal, () => undefined); expect(run).toHaveBeenCalledOnce()
  const read = cache.read.bind(cache)
  vi.spyOn(cache, 'read').mockImplementationOnce(async key => {
    const data = JSON.parse(Buffer.from((await read(key))!).toString())
    data.screenChanges.coarse.lastSampleSeconds = 100
    return Buffer.from(JSON.stringify(data))
  })
  await service.detect(input, new AbortController().signal, () => undefined); expect(screen).toHaveBeenCalledTimes(2)
  await fs.writeFile(source, 'new-file'); await service.detect(input, new AbortController().signal, () => undefined)
  expect(screen).toHaveBeenCalledTimes(3)
  await expect(service.detect({ ...input, includeStillness: true }, new AbortController().signal, () => undefined)).rejects.toThrow('分别查询')
})
it('同一实际来源共享分析，交付前仍核对各调用方入口，拒绝被改指向的目录链接', async () => {
  const { cache, request, source } = await fixture()
  const alias = path.join(path.dirname(source), 'alias'); const alternate = path.join(path.dirname(source), 'alternate')
  await fs.mkdir(alternate); await fs.writeFile(path.join(alternate, 'video'), 'another-video')
  await fs.symlink(path.dirname(source), alias, 'junction')
  let release: () => void = () => undefined
  const run = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); return [2] })
  const service = new SceneDetectionService(cache, run)
  const first = service.detect(request, new AbortController().signal, () => undefined)
  const secondProgress = vi.fn()
  const second = service.detect({ ...request, source: path.join(alias, 'video') }, new AbortController().signal, secondProgress).catch(error => error)
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  // Both entrances initially resolve to the same source; only the second entrance changes.
  await vi.waitFor(() => expect(secondProgress).toHaveBeenCalledWith(0))
  await fs.unlink(alias); await fs.symlink(alternate, alias, 'junction'); release()
  expect(await first).toMatchObject({ cutsSeconds: [2] })
  expect(await second).toMatchObject({ message: expect.stringContaining('原视频已改变') })
})
it('内容身份、源范围及灵敏度各自失效；中途改文件不缓存；损坏缓存重算', async () => {
  const { source, cache, request } = await fixture(); const run = vi.fn(async () => [2, 4]); const service = new SceneDetectionService(cache, run)
  await service.detect(request, new AbortController().signal, () => undefined)
  await service.detect(request, new AbortController().signal, () => undefined); expect(run).toHaveBeenCalledTimes(1)
  await service.detect({ ...request, sensitivity: 60 }, new AbortController().signal, () => undefined)
  await service.detect({ ...request, endSeconds: 6 }, new AbortController().signal, () => undefined)
  await fs.writeFile(source, 'replacement-video-content-longer')
  await service.detect(request, new AbortController().signal, () => undefined); expect(run).toHaveBeenCalledTimes(4)
  const mutating = new SceneDetectionService(cache, async () => { await fs.writeFile(source, 'changed during analysis'); return [2] })
  await expect(mutating.detect({ ...request, sensitivity: 70 }, new AbortController().signal, () => undefined)).rejects.toThrow('已改变')
  vi.spyOn(cache, 'read').mockResolvedValueOnce(Buffer.from('{broken'))
  await service.detect(request, new AbortController().signal, () => undefined); expect(run).toHaveBeenCalledTimes(5)
})
it('取消不缓存半成品；最多两个后台任务，失败后释放槽位', async () => {
  const { cache, request } = await fixture()
  const controller = new AbortController(); const write = vi.spyOn(cache, 'write')
  const service = new SceneDetectionService(cache, async () => { controller.abort(new Error('取消')); return [2] })
  await expect(service.detect(request, controller.signal, () => undefined)).rejects.toThrow('取消'); expect(write).not.toHaveBeenCalled()
  const releases: Array<() => void> = []
  const concurrent = new SceneDetectionService(cache, async () => { await new Promise<void>(resolve => releases.push(resolve)); return [] })
  const first = concurrent.detect(request, new AbortController().signal, () => undefined)
  const second = concurrent.detect({ ...request, sensitivity: 51 }, new AbortController().signal, () => undefined)
  await vi.waitFor(() => expect(releases).toHaveLength(2))
  await expect(concurrent.detect({ ...request, sensitivity: 52 }, new AbortController().signal, () => undefined)).rejects.toThrow('两段')
  releases.splice(0).forEach(release => release()); await Promise.all([first, second])
})
it('同内容与参数并发只分析一次，取消一个调用方不影响另一个', async () => {
  const { cache, request } = await fixture(); let finish: () => void = () => undefined
  let report: (value: number) => void = () => undefined
  const run = vi.fn(async (_request, signal: AbortSignal, progress: (value: number) => void) => { report = progress; await new Promise<void>(resolve => { finish = resolve }); signal.throwIfAborted(); return [2] })
  const service = new SceneDetectionService(cache, run); const controller = new AbortController()
  const first = service.detect(request, controller.signal, () => undefined).catch(error => error)
  const secondProgress = vi.fn()
  const second = service.detect({ ...request, requestId: 'second' }, new AbortController().signal, secondProgress)
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  await vi.waitFor(() => { report(.5); expect(secondProgress).toHaveBeenCalled() })
  controller.abort(new Error('取消第一位')); finish()
  expect(await first).toBeInstanceOf(Error); expect(await second).toMatchObject({ cutsSeconds: [2] }); expect(run).toHaveBeenCalledOnce()
})

it('读取缓存期间原素材改变时拒绝旧证据，不拿旧缓存或旧键重新分析', async () => {
  const { source, cache, request } = await fixture(); const run = vi.fn(async () => [2, 4])
  const service = new SceneDetectionService(cache, run)
  await service.detect(request, new AbortController().signal, () => undefined)
  const read = cache.read.bind(cache)
  vi.spyOn(cache, 'read').mockImplementationOnce(async key => { const bytes = await read(key); await fs.writeFile(source, 'replacement-during-cache-read'); return bytes })
  await expect(service.detect(request, new AbortController().signal, () => undefined)).rejects.toThrow('读取缓存期间原视频已改变')
  expect(run).toHaveBeenCalledOnce()
})

it('缓存写入期间原素材改变时不把迟到结果交给调用方', async () => {
  const { source, cache, request } = await fixture(); const run = vi.fn(async () => [2])
  const write = cache.write.bind(cache)
  vi.spyOn(cache, 'write').mockImplementationOnce(async (key, bytes) => { await write(key, bytes); await fs.writeFile(source, 'changed-during-cache-write') })
  const service = new SceneDetectionService(cache, run)
  await expect(service.detect(request, new AbortController().signal, () => undefined)).rejects.toThrow('保存分析缓存期间原视频已改变')
})
