import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { autoMediaCacheBudgetBytes, planMediaCacheEviction } from '../../../../src/core/media/mediaCache'
import { MediaCacheManager, MEDIA_CACHE_SETTING_KEYS, type MediaCacheHost } from './media-cache'
import { VideoRenderCacheService } from '../video/render-cache'

const GB = 1024 ** 3
const DAY = 24 * 60 * 60 * 1000
const directories: string[] = []
async function temporary(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-media-cache-'))
  directories.push(value)
  return value
}
afterEach(async () => { await Promise.all(directories.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))) })

function host(root: string, extra: Partial<MediaCacheHost> = {}): MediaCacheHost & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    userRoot: () => ({ root, locale: 'zh' }),
    settings: { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value) }, delete: key => { values.delete(key) } },
    legacyDirectories: () => [],
    logger: { info: () => undefined, warn: () => undefined },
    ...extra,
  }
}
async function file(target: string, size: number, ageDays = 0): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, Buffer.alloc(size))
  const used = new Date(Date.now() - ageDays * DAY)
  await fs.utimes(target, used, used)
}

describe('media cache budget and eviction', () => {
  it('derives the automatic budget from free space within 10GB to 50GB', () => {
    expect(autoMediaCacheBudgetBytes(40 * GB)).toBe(10 * GB)
    expect(autoMediaCacheBudgetBytes(300 * GB)).toBe(30 * GB)
    expect(autoMediaCacheBudgetBytes(2000 * GB)).toBe(50 * GB)
    expect(autoMediaCacheBudgetBytes(null)).toBe(50 * GB)
  })
  it('removes entries past the retention first, then the least recently used down to 80% of the budget, skipping protected ones', () => {
    const now = 100 * DAY
    const entries = [
      { file: 'old', size: 10, usedMs: now - 40 * DAY },
      { file: 'a', size: 40, usedMs: now - 3 * DAY },
      { file: 'busy', size: 40, usedMs: now - 5 * DAY },
      { file: 'b', size: 40, usedMs: now - 2 * DAY },
      { file: 'c', size: 40, usedMs: now - DAY },
    ]
    const plan = planMediaCacheEviction(entries, { nowMs: now, retentionDays: 30, budgetBytes: 100, protect: entry => entry.file === 'busy' })
    expect(plan.map(entry => entry.file)).toEqual(['old', 'a', 'b'])
    expect(planMediaCacheEviction(entries, { nowMs: now, retentionDays: 0, budgetBytes: 1000 })).toEqual([])
  })
})

describe('media cache manager', () => {
  it('places categories under the hidden folder of the works directory and reports usage', async () => {
    const root = await temporary()
    const manager = new MediaCacheManager(host(root))
    expect(manager.categoryDirectory('render')).toBe(path.join(root, '.痕迹AI缓存', 'render'))
    const cache = manager.createCache('analysis', 'scenes', { extension: '.json' })
    await cache.write('a'.repeat(64), Buffer.alloc(100))
    await file(path.join(root, '.痕迹AI缓存', 'audio-edit', 'doc', 'audio.wav'), 50)
    const usage = await manager.usage()
    expect(usage.categories.find(item => item.category === 'analysis')).toMatchObject({ bytes: 100, files: 1 })
    expect(usage.categories.find(item => item.category === 'audio_edit')).toMatchObject({ bytes: 50, files: 1 })
    expect(usage.totalBytes).toBe(150)
    expect((await manager.clear('analysis')).removedFiles).toBe(1)
    expect((await manager.usage()).totalBytes).toBe(50)
  })
  it('applies retention and a fixed budget across categories', async () => {
    const root = await temporary()
    const owner = host(root)
    const manager = new MediaCacheManager(owner)
    manager.writeSettings({ retentionDays: 7, budgetGb: 10 })
    const cache = path.join(root, '.痕迹AI缓存')
    await file(path.join(cache, 'render', `${'1'.repeat(64)}.mp4`), 10, 8)
    await file(path.join(cache, 'proxy', `${'2'.repeat(64)}.mp4`), 10, 1)
    await manager.enforce()
    expect(await fs.readdir(path.join(cache, 'render'))).toEqual([])
    expect(await fs.readdir(path.join(cache, 'proxy'))).toHaveLength(1)
    expect(owner.values.get(MEDIA_CACHE_SETTING_KEYS.budgetGb)).toBe('10')
    expect(() => manager.writeSettings({ budgetGb: 5 })).toThrow()
    expect(manager.readSettings().budgetGb).toBe(10)
  })
  it('falls back per setting when a stored value is invalid', async () => {
    const owner = host(await temporary())
    owner.values.set(MEDIA_CACHE_SETTING_KEYS.retentionDays, '45')
    owner.values.set(MEDIA_CACHE_SETTING_KEYS.renderFormat, 'hevc')
    expect(new MediaCacheManager(owner).readSettings()).toEqual({ budgetGb: null, retentionDays: 30, renderFormat: 'hevc', renderQuality: 'standard' })
  })
  it('removes legacy directories once, the previous works directory cache, and orphan render files at startup', async () => {
    const root = await temporary()
    const legacy = path.join(await temporary(), 'video-edit-render-cache')
    await file(path.join(legacy, 'p', 'x.mp4'), 5)
    const previous = path.join(await temporary(), '.痕迹AI缓存')
    await file(path.join(previous, 'render', 'x.mp4'), 5)
    const owner = host(root, { legacyDirectories: () => [legacy], liveDocumentIds: async () => new Set(['live']) })
    owner.values.set(MEDIA_CACHE_SETTING_KEYS.lastRoot, previous)
    const manager = new MediaCacheManager(owner)
    const render = new VideoRenderCacheService(manager.createCache('render', undefined, { extension: '.mp4', budgetBytes: Infinity }), manager.createCache('render', undefined, { extension: '.json' }), () => manager.categoryDirectory('render'))
    manager.registerOrphanCollector(async live => live.video_edit ? render.removeOrphans(live.video_edit) : 0)
    for (const projectId of ['live', 'gone']) {
      const temporaryPath = await render.begin(projectId, `window-${projectId}`, 'avc:standard:40')
      await fs.writeFile(temporaryPath, Buffer.alloc(8))
      await render.commit(temporaryPath, { projectId, sequenceId: 's', windowKey: `window-${projectId}`, profile: 'avc:standard:40', startFrame: 0, endFrame: 30, width: 64, height: 64, fps: 30 })
    }
    await manager.startupMaintenance()
    await expect(fs.access(legacy)).rejects.toThrow()
    await expect(fs.access(previous)).rejects.toThrow()
    expect(owner.values.get(MEDIA_CACHE_SETTING_KEYS.legacyCleaned)).toBe('1')
    expect(owner.values.get(MEDIA_CACHE_SETTING_KEYS.lastRoot)).toBe(path.join(root, '.痕迹AI缓存'))
    expect((await render.list('live')).map(entry => entry.windowKey)).toEqual(['window-live'])
    expect(await render.list('gone')).toEqual([])
  })
})

describe('video render cache store', () => {
  it('commits only begun files, lists by project and removes deleted sequences', async () => {
    const root = await temporary()
    const manager = new MediaCacheManager(host(root))
    const render = new VideoRenderCacheService(manager.createCache('render', undefined, { extension: '.mp4', budgetBytes: Infinity }), manager.createCache('render', undefined, { extension: '.json' }), () => manager.categoryDirectory('render'))
    const entry = (sequenceId: string, windowKey: string) => ({ projectId: 'p', sequenceId, windowKey, profile: 'hevc:high:39', startFrame: 0, endFrame: 60, width: 1920, height: 1080, fps: 60 })
    await expect(render.commit(path.join(root, 'foreign.tmp'), entry('s1', 'w1'))).rejects.toThrow('临时文件无效')
    for (const [sequence, window] of [['s1', 'w1'], ['s2', 'w2']]) {
      const temporaryPath = await render.begin('p', window, 'hevc:high:39')
      await fs.writeFile(temporaryPath, Buffer.alloc(16))
      const stored = await render.commit(temporaryPath, entry(sequence, window))
      expect(stored.bytes).toBe(16)
    }
    const discarded = await render.begin('p', 'w3', 'hevc:high:39')
    await render.discard(discarded)
    await expect(fs.access(discarded)).rejects.toThrow()
    expect((await render.list('p')).map(item => item.windowKey).sort()).toEqual(['w1', 'w2'])
    expect(await render.remove({ projectId: 'p', keepSequenceIds: ['s1'] })).toBe(1)
    expect((await render.list('p')).map(item => item.windowKey)).toEqual(['w1'])
    expect(await render.remove({ projectId: 'p' })).toBe(1)
    expect(await render.list('p')).toEqual([])
  })
})

describe('media cache shutdown', () => {
  it('does no maintenance or settings writes after stop (the database closes on quit)', async () => {
    const owner = host(await temporary())
    const manager = new MediaCacheManager(owner)
    manager.stop()
    await manager.startupMaintenance()
    await manager.enforce()
    expect(owner.values.size).toBe(0)
  })
})
