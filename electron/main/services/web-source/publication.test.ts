import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSourceBatch } from './batch'
import { webSourceContentHash } from './site'
import { WebCacheCapabilityGate } from './capability'
import { publishWebTimeSegment, readWebTimeGeometry, readWebTimeSegment, webCacheVariantKey } from './publication'
import type { ReliableWebSourceFrame } from './page'
import type { WebCacheSegmentLease } from './locks'
import { WebCacheSubmissions } from './submissions'

const encoding = vi.hoisted(() => ({ block: false, starts: 0, writes: 0, finishes: 0, aborts: 0, reject: undefined as ((error: Error) => void) | undefined, exit: undefined as (() => void) | undefined }))
vi.mock('../web-replay/player/encoder', () => ({ FrameEncoder: class {
  width: number; height: number
  constructor(width: number, height: number, _rate: unknown, private file: string) { this.width = width; this.height = height }
  async start(): Promise<void> { encoding.starts++; await fs.writeFile(this.file, 'encoded') }
  async write(): Promise<void> { encoding.writes++; if (encoding.block) await new Promise<void>((_resolve, reject) => { encoding.reject = reject }) }
  async finish(): Promise<void> { encoding.finishes++ }
  async abort(): Promise<void> {
    encoding.aborts++
    const reject = encoding.reject
    encoding.reject = undefined
    if (reject) {
      reject(new Error('编码已取消'))
      await new Promise<void>(resolve => { encoding.exit = resolve })
    }
    encoding.block = false
  }
} }))
vi.mock('./segmentValidation', () => ({ validateWebTimeSegment: vi.fn(async () => undefined) }))
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
async function setup(): Promise<{ root: string; site: string; cacheRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cache-publication-')); roots.push(root)
  const site = path.join(root, 'site'), cacheRoot = path.join(root, 'cache')
  await fs.mkdir(site); await fs.writeFile(path.join(site, 'index.html'), 'source one')
  return { root, site, cacheRoot }
}

it('Worker 字节散列与实时来源同源；改写并恢复原字节仍使整批失效', async () => {
  const { site } = await setup(), batch = await WebSourceBatch.begin(site)
  try {
    expect(batch.source.contentHash).toBe(await webSourceContentHash(site))
    await batch.validate()
    const file = path.join(site, 'index.html'), stat = await fs.stat(file)
    await fs.writeFile(file, 'source two'); await fs.writeFile(file, 'source one'); await fs.utimes(file, stat.atime, stat.mtime)
    expect(await webSourceContentHash(site)).toBe(batch.source.contentHash)
    await expect(batch.validate()).rejects.toThrow('失效')
  } finally { batch.close() }
})

it('能力拒绝不执行生产者；只有完整当前帧才原子发布，失败清空临时族，读时核尺寸', async () => {
  const { site, cacheRoot } = await setup(), batch = await WebSourceBatch.begin(site)
  const variant = { view: { width: 8, height: 4, region: [0, 0, 8, 4] as [number, number, number, number], scale: 1 }, deviceScaleFactor: 1,
    grid: { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } }, environmentSignature: 'test', chromium: 'test' }
  const epoch = new AbortController(), consumed = vi.fn(), returned = vi.fn()
  const frames = (times: number[], failCleanup = false): (() => AsyncIterable<ReliableWebSourceFrame>) => () => (async function* () {
    try {
      for (const time of times) {
        consumed()
        yield { frame: { width: 8, height: 4, format: 'yuv444p' as const, dirty: { x: 0, y: 0, width: 8, height: 4 }, changed: true, bitmap: () => Buffer.alloc(96), previewJpeg: () => '' },
          identity: String(time), time, contentHash: batch.source.contentHash, epoch: epoch.signal, boxes: null, isCurrent: () => !epoch.signal.aborted, validate: async () => !epoch.signal.aborted }
      }
    } finally { returned(); await (failCleanup ? Promise.reject(new Error('收尾失败')) : Promise.resolve()) }
  })()
  const gate = new WebCacheCapabilityGate(async () => 'cuda_planar', logger, 'win32')
  const base = { cacheRoot, batch, variant, width: 8, height: 4, segment: { index: 0, firstFrame: 0, frameCount: 2 }, capability: gate, submissions: new WebCacheSubmissions(logger), environmentCurrent: async () => true, logger }
  const locked = { ...base, withSegmentLock: async <T>(_key: string, work: (lease: WebCacheSegmentLease) => Promise<T>, signal = new AbortController().signal): Promise<T> => {
    let published: string | undefined
    return work({ signal, prepare: async () => undefined, commit: async (temporary, destination) => { await fs.rm(destination, { recursive: true, force: true }); await fs.rename(temporary, destination); published = destination },
      discard: async destination => { await fs.rm(destination, { recursive: true, force: true }); return true },
      rollback: async () => { if (published) await fs.rm(published, { recursive: true, force: true }) } })
  } }
  try {
    await expect(publishWebTimeSegment({ ...locked, capability: new WebCacheCapabilityGate(async () => { throw new Error('busy') }, logger, 'win32'), frames: frames([0, 1]) })).rejects.toThrow('不可用')
    expect(consumed).not.toHaveBeenCalled()
    await expect(publishWebTimeSegment({ ...locked, frames: frames([0]) })).rejects.toThrow('缺帧')
    expect(await fs.readdir(cacheRoot)).toEqual([])
    await expect(publishWebTimeSegment({ ...locked, frames: frames([1, 0]) })).rejects.toThrow('顺序')
    expect(await fs.readdir(cacheRoot)).toEqual([])
    const ready = await publishWebTimeSegment({ ...locked, frames: frames([0, 1]) })
    expect(await readWebTimeSegment(cacheRoot, ready.manifest.variantKey, 0)).toEqual(ready)
    expect(returned).toHaveBeenCalledTimes(3)
    await fs.appendFile(path.join(ready.directory, 'video.mp4'), 'broken')
    expect(await readWebTimeSegment(cacheRoot, ready.manifest.variantKey, 0)).toBeUndefined()
    await publishWebTimeSegment({ ...locked, frames: frames([0, 1]) })
    expect(await readWebTimeSegment(cacheRoot, ready.manifest.variantKey, 0)).toEqual(ready)
    const next = { ...locked, segment: { index: 1, firstFrame: 2, frameCount: 2 } }
    await expect(publishWebTimeSegment({ ...next, frames: frames([2, 3], true) })).rejects.toThrow('收尾失败')
    expect(await fs.readdir(cacheRoot)).toEqual([path.basename(ready.directory)])
    const controller = new AbortController()
    await expect(publishWebTimeSegment({ ...next, frames: frames([2, 3]), withSegmentLock: (key, work, signal) => locked.withSegmentLock(key, lease => work({ ...lease,
      commit: async (temporary, destination) => { await lease.commit(temporary, destination); throw new Error('提交回执失败') },
    }), signal) })).rejects.toThrow('提交回执失败')
    expect(await fs.readdir(cacheRoot)).toEqual([path.basename(ready.directory)])
    encoding.block = true
    const cancelled = expect(publishWebTimeSegment({ ...next, signal: controller.signal, frames: frames([2, 3]) })).rejects.toThrow('编码已取消')
    await vi.waitFor(() => expect(encoding.reject).toBeDefined())
    controller.abort()
    await vi.waitFor(() => expect(encoding.exit).toBeDefined())
    expect((await fs.readdir(cacheRoot)).some(name => name.includes('.tmp-'))).toBe(true)
    encoding.exit!()
    await cancelled
    expect(await fs.readdir(cacheRoot)).toEqual([path.basename(ready.directory)])
    expect(webCacheVariantKey(batch.source.contentHash, { ...variant, deviceScaleFactor: 2 })).not.toBe(ready.manifest.variantKey)
    expect(webCacheVariantKey(batch.source.contentHash, { ...variant, grid: { ...variant.grid, phase: { numerator: '1', denominator: '2' } } })).not.toBe(ready.manifest.variantKey)
    let hold!: ReturnType<WebCacheSubmissions['hold']>
    const before = { starts: encoding.starts, writes: encoding.writes, finishes: encoding.finishes, aborts: encoding.aborts }
    const resumed = publishWebTimeSegment({ ...next, frames: () => (async function* () {
      for await (const frame of frames([2, 3])()) {
        if (frame.time === 2) hold = base.submissions.hold('foreground')
        yield frame
      }
    })() })
    await vi.waitFor(() => expect(hold).toBeDefined()); await hold.drained
    expect(encoding).toMatchObject({ starts: before.starts + 1, writes: before.writes, finishes: before.finishes, aborts: before.aborts })
    expect((await fs.readdir(cacheRoot)).filter(name => name.includes('.tmp-'))).toHaveLength(1)
    hold.resume(); await resumed
    expect(encoding).toMatchObject({ starts: before.starts + 1, writes: before.writes + 2, finishes: before.finishes + 1, aborts: before.aborts })
    expect((await fs.readdir(cacheRoot)).filter(name => name.includes('.tmp-'))).toEqual([])
    const geometryFrames = (_signal: AbortSignal, selectors: readonly string[]) => (async function* () {
      for await (const frame of frames([0, 1])()) yield { ...frame, boxes: Object.fromEntries(selectors.map(selector => [selector, null])) }
    })()
    await expect(publishWebTimeSegment({ ...locked, selectors: ['.a'], frames: frames([0, 1]) })).rejects.toThrow('几何')
    await publishWebTimeSegment({ ...locked, selectors: ['.a'], frames: geometryFrames })
    const enriched = await publishWebTimeSegment({ ...locked, selectors: ['.b'], frames: geometryFrames })
    expect((await readWebTimeGeometry(enriched))?.boxes).toEqual([{ '.a': null, '.b': null }, { '.a': null, '.b': null }])
    const reusable = vi.fn(geometryFrames)
    await publishWebTimeSegment({ ...locked, selectors: ['.a'], frames: reusable })
    expect(reusable).not.toHaveBeenCalled()
    const prior = await fs.readFile(path.join(enriched.directory, 'manifest.json'), 'utf8')
    await expect(publishWebTimeSegment({ ...locked, frames: geometryFrames, beforePublish: async () => { throw new Error('交叠失败') } })).rejects.toThrow('交叠失败')
    expect(await fs.readFile(path.join(enriched.directory, 'manifest.json'), 'utf8')).toBe(prior)
    expect((await fs.readdir(cacheRoot)).some(name => name.includes('.tmp-'))).toBe(false)
  } finally { batch.close() }
})
