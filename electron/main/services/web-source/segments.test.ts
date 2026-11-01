import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'
import { WebCacheLocks, type WebCacheLockService } from './locks'
import { WebCacheSegments } from './segments'
import { MediaCacheManager } from '../media/media-cache'

it('容量回收以整段为单位，忙碌和扫描后新命中的段保持完整', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-family-'))
  const manager = new MediaCacheManager({ userRoot: () => ({ root, locale: 'en' }), settings: { get: () => null, set: () => undefined, delete: () => undefined }, legacyDirectories: () => [], logger: { info: () => undefined, warn: () => undefined } })
  let busy = true
  let token: string | undefined
  const service = {
    ensureStarted: async () => undefined, onLifecycle: () => () => undefined,
    webCacheLock: vi.fn(async (_key: string, requested: string) => { if (busy || token) return { acquired: false }; token = requested; return { acquired: true } }),
    webCacheUnlock: async (_key: string, requested: string) => { if (token === requested) token = undefined; return { released: true } },
    webCacheDiscard: vi.fn(async (_key: string, _lease: string, destination: string) => { await fs.rm(destination, { recursive: true }); return { removed: true } }),
  } as unknown as WebCacheLockService
  const directory = (): string => manager.categoryDirectory('render', 'web-time')!
  const store = new WebCacheSegments(directory, new WebCacheLocks(service))
  manager.registerFamilies('render', directory, () => store.list())
  const family = path.join(directory(), `${'a'.repeat(64)}-0`)
  try {
    await fs.mkdir(family, { recursive: true })
    for (const name of ['video.mp4', 'geometry.json', 'manifest.json']) await fs.writeFile(path.join(family, name), 'content')
    await fs.utimes(family, new Date(0), new Date(0))
    expect((await manager.usage()).totalBytes).toBe(21)
    expect(await manager.clear('render')).toEqual({ removedFiles: 0, removedBytes: 0, skippedFiles: 3 })
    expect(await fs.readdir(family)).toHaveLength(3)
    expect(service.webCacheLock).toHaveBeenCalledTimes(1)
    busy = false
    const [beforeHit] = await store.list()
    await store.touch(family)
    expect(await beforeHit.remove()).toBe(false)
    expect(service.webCacheDiscard).not.toHaveBeenCalled()
    const retained = await store.hold('a'.repeat(64), 0)
    expect(retained).toBeDefined()
    expect(await manager.clear('render')).toEqual({ removedFiles: 0, removedBytes: 0, skippedFiles: 3 })
    expect(await store.hold('a'.repeat(64), 0)).toBeUndefined()
    await retained!.release()
    expect(await manager.clear('render')).toEqual({ removedFiles: 3, removedBytes: 21, skippedFiles: 0 })
    expect(await fs.readdir(directory())).toEqual([])
    for (const suffix of ['first', 'second']) {
      const temporary = `${family}.tmp-${suffix}`
      await fs.mkdir(temporary)
      await fs.writeFile(path.join(temporary, 'video.mp4'), 'temporary')
      await fs.utimes(temporary, new Date(0), new Date(0))
    }
    expect(await manager.clear('render')).toEqual({ removedFiles: 2, removedBytes: 18, skippedFiles: 0 })
    expect(await fs.readdir(directory())).toEqual([])
  } finally { manager.stop(); await fs.rm(root, { recursive: true, force: true }) }
})
