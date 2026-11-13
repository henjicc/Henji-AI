import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../media/media-cache-runtime', async () => {
  const { createContentDiskCache } = await import('../media/content-disk-cache')
  return { getMediaCacheManager: () => ({ createCache: (_name: string, _dir: unknown, options: { extension: string }) => createContentDiskCache({ ...options, directory: () => state.root }) }) }
})
import { adoptRecordedVideoProxy, videoProxyService } from './proxy-runtime'

afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }) })

it('录制时一起录好的代理按原片登记进剪辑的代理缓存：之后查 auto 档直接命中，不再转码', async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-adopt-'))
  const source = path.join(state.root, 'screen-000000.mp4'), proxy = path.join(state.root, 'screen-000000.proxy.mp4')
  await fs.writeFile(source, 'main'); await fs.writeFile(proxy, 'proxy-picture')
  const result = await adoptRecordedVideoProxy(source, proxy, { width: 1920, height: 1080 })
  expect(result).toMatchObject({ preset: 'auto', width: 1920, height: 1080 })
  expect(await fs.readFile(result.path, 'utf8')).toBe('proxy-picture')
  const found = await videoProxyService().lookup(source, 'auto')
  expect(found).toMatchObject({ path: result.path, key: result.key })
})
