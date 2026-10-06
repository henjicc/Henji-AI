import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContentDiskCache } from '../media/content-disk-cache'
import { SceneDetectionService } from './scene-detection'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-scenes-unit-')); directories.push(directory)
  const source = path.join(directory, 'video'); await fs.writeFile(source, 'initial-video-content')
  const cache = createContentDiskCache({ directory: () => path.join(directory, 'cache'), extension: '.json' })
  return { source, cache, request: { requestId: 'test', source, startSeconds: 1, endSeconds: 5, sensitivity: 50 } }
}
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
