import { describe, expect, it, vi, type Mock } from 'vitest'
import { ImageInpaintService, type ImageInpaintInput, type ImageInpaintServiceDependencies } from './service'
import type { ImageInpaintResult } from './protocol'

const input = (): ImageInpaintInput => ({ image: { id: 'source' }, mask: { id: 'selection' }, roi: { left: 4, top: 6, width: 200, height: 150 }, quality: 'fast' })
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function setup(): { service: ImageInpaintService; deps: ImageInpaintServiceDependencies; releases: Mock<[], Promise<undefined>>[] } {
  const releases = [vi.fn(async () => undefined), vi.fn(async () => undefined)]
  let index = 0
  const deps: ImageInpaintServiceDependencies = {
    resources: { acquire: vi.fn(async ref => ({ path: `${ref.id}.png`, release: releases[index++] })), publishCopy: vi.fn(async () => ({ id: 'patch' })), discard: vi.fn(async () => undefined) },
    inference: { inpaint: vi.fn(async job => ({ algorithm: job.algorithm, provider: 'cpu' as const, roi: job.roi, outputPath: job.outputPath, decodeMs: 1, inferenceMs: 2, compositeMs: 1, durationMs: 4 })), cancel: vi.fn() },
    ensureModel: vi.fn(async () => 'verified.onnx'), temporaryPath: vi.fn(async id => `${id}.png`), removeTemporary: vi.fn(async () => undefined), providers: ['dml', 'cpu'], log: vi.fn(),
  }
  return { deps, releases, service: new ImageInpaintService(deps) }
}

describe('图片修补服务的资源与作业生命周期', () => {
  it.each(['fast', 'fine', 'blemish'] as const)('%s 复用模型下载/隔离宿主，返回正式补丁引用并释放临时资源', async quality => {
    const { deps, service, releases } = setup(); const progress = vi.fn()
    const result = await service.run({ ...input(), quality }, { progress })
    expect(result.patch).toEqual({ id: 'patch' }); expect(result).not.toHaveProperty('outputPath')
    expect(deps.ensureModel).toHaveBeenCalledTimes(quality === 'blemish' ? 0 : 1)
    if (quality !== 'blemish') expect(deps.ensureModel).toHaveBeenCalledWith(quality === 'fine' ? 'image_inpainting_lama' : 'image_inpainting_migan')
    expect(releases.every(release => release.mock.calls.length === 1)).toBe(true)
    expect(deps.removeTemporary).toHaveBeenCalledTimes(1); expect(service.hasActiveJobs()).toBe(false)
    expect(deps.inference.inpaint).toHaveBeenCalledWith(expect.objectContaining({ providers: quality === 'fine' ? ['cpu'] : ['dml', 'cpu'] }), expect.any(Function))
    expect(progress).toHaveBeenLastCalledWith({ stage: 'publishing', done: 0, total: 1 })
  })

  it('冻结输入；取消立即结束等待，原生作业未结束前保留资源，迟到结果不发布', async () => {
    const { deps, service, releases } = setup(); const started = deferred<void>(); const native = deferred<ImageInpaintResult>()
    let result!: ImageInpaintResult
    deps.inference.inpaint = vi.fn(async job => {
      expect(job.roi.left).toBe(4)
      result = { algorithm: job.algorithm, roi: job.roi, provider: 'cpu', outputPath: job.outputPath, decodeMs: 1, inferenceMs: 2, compositeMs: 1, durationMs: 4 }
      started.resolve(); return native.promise
    })
    const controller = new AbortController(); const mutable = input(); const pending = service.run(mutable, { signal: controller.signal })
    mutable.roi.left = 999
    await started.promise; controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(service.hasActiveJobs()).toBe(true); expect(releases[0]).not.toHaveBeenCalled()
    native.resolve(result)
    await vi.waitFor(() => expect(service.hasActiveJobs()).toBe(false))
    expect(deps.resources.publishCopy).not.toHaveBeenCalled(); expect(releases[0]).toHaveBeenCalledOnce(); expect(deps.removeTemporary).toHaveBeenCalledOnce()
  })

  it('取消下载等待不终止共享下载；下载结束后回收 lease，不再派发作业', async () => {
    const { deps, service, releases } = setup(); const started = deferred<void>(); const download = deferred<string>()
    deps.ensureModel = async () => { started.resolve(); return download.promise }
    const controller = new AbortController(); const pending = service.run(input(), { signal: controller.signal })
    await started.promise; controller.abort(); await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    download.resolve('verified.onnx')
    await vi.waitFor(() => expect(service.hasActiveJobs()).toBe(false))
    expect(deps.inference.inpaint).not.toHaveBeenCalled(); expect(releases[0]).toHaveBeenCalledOnce()
  })

  it('发布期间取消回收未交付的结果；关闭服务阻止新作业', async () => {
    const { deps, service } = setup(); const controller = new AbortController()
    deps.resources.publishCopy = async () => { controller.abort(); return { id: 'late' } }
    await expect(service.run(input(), { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(deps.resources.discard).toHaveBeenCalledWith({ id: 'late' }))
    service.dispose(); await expect(service.run(input())).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('未交付结果回收失败也记录作业失败，清理其他lease/临时文件，不覆盖取消原因', async () => {
    const { deps, service, releases } = setup(); const controller = new AbortController()
    deps.resources.publishCopy = async () => { controller.abort(); return { id: 'late' } }
    deps.resources.discard = async () => { throw new Error('disk unavailable') }
    await expect(service.run(input(), { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(service.hasActiveJobs()).toBe(false))
    expect(deps.log).toHaveBeenCalledWith('warn', '未交付的修补结果回收失败', 'image_inpaint.cleanup.failed', expect.any(Object))
    expect(deps.log).toHaveBeenCalledWith('warn', '图片修补作业失败', 'image_inpaint.job.failed', expect.any(Object))
    expect(releases[0]).toHaveBeenCalledOnce(); expect(deps.removeTemporary).toHaveBeenCalledOnce()
  })

  it('下载、资源解析、后台回执失败不返回成功结果，已获得 lease 全释放', async () => {
    const { deps, service, releases } = setup()
    deps.ensureModel = async () => { throw new Error('checksum: corrupted') }
    await expect(service.run(input())).rejects.toThrow('checksum')
    expect(releases[0]).toHaveBeenCalledOnce(); expect(releases[1]).toHaveBeenCalledOnce(); expect(deps.resources.publishCopy).not.toHaveBeenCalled()
    const another = setup()
    another.deps.inference.inpaint = async job => ({ algorithm: 'lama', provider: 'cpu', roi: job.roi, outputPath: job.outputPath, decodeMs: 0, inferenceMs: 0, compositeMs: 0, durationMs: 0 })
    await expect(another.service.run(input())).rejects.toThrow('回执')
    expect(another.deps.removeTemporary).toHaveBeenCalledOnce()
    await expect(service.run({ ...input(), quality: 'tensor' as ImageInpaintInput['quality'] })).rejects.toThrow('quality')
  })
})
