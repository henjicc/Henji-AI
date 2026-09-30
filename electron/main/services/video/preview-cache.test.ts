import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('测试不得访问真实资料目录') } } }))
vi.mock('../logging', () => ({ createMainLogger: () => log }))
import { clearLegacyVideoPreviewCache } from './preview-cache'

const roots: string[] = []
async function temporary(): Promise<string> { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-preview-cleanup-')); roots.push(root); return root }
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('henji-preview-cleanup-')) throw new Error('测试目录越界')
    await fs.rm(root, { recursive: true, force: true })
  }
  vi.clearAllMocks()
})
it('只释放旧转码及中断文件，保留素材、工程、目录和其他缓存', async () => {
  const root = await temporary(); const cache = path.join(root, 'cache', 'video-edit-preview'); await fs.mkdir(cache, { recursive: true })
  const digest = 'a'.repeat(64)
  for (const name of [`${digest}.mp4`, `${digest}-00000000-0000-0000-0000-000000000000.partial.mp4`, 'original.mp4', 'project.henji-video', 'unknown.partial.mp4']) await fs.writeFile(path.join(cache, name), 'data')
  await fs.mkdir(path.join(cache, `${'b'.repeat(64)}.mp4`))
  const source = path.join(root, `${digest}.mp4`); await fs.writeFile(source, 'original source')
  await clearLegacyVideoPreviewCache(root)
  expect((await fs.readdir(cache)).sort()).toEqual([`${'b'.repeat(64)}.mp4`, 'original.mp4', 'project.henji-video', 'unknown.partial.mp4'].sort())
  expect(await fs.readFile(source, 'utf8')).toBe('original source')
  expect(log.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ context: { files: 2, bytes: 8 } }))
  await clearLegacyVideoPreviewCache(root); expect(log.info).toHaveBeenCalledOnce()
})
it('缓存目录被连接到其他位置时拒绝删除，文件原样保留', async () => {
  const root = await temporary(); const outside = await temporary(); const cache = path.join(root, 'cache')
  await fs.mkdir(cache); await fs.writeFile(path.join(outside, `${'a'.repeat(64)}.mp4`), 'untouched')
  await fs.symlink(outside, path.join(cache, 'video-edit-preview'), process.platform === 'win32' ? 'junction' : 'dir')
  await clearLegacyVideoPreviewCache(root)
  expect(await fs.readFile(path.join(outside, `${'a'.repeat(64)}.mp4`), 'utf8')).toBe('untouched')
  expect(log.warn).toHaveBeenCalledOnce()
})
it('未生成过缓存时无需创建目录或提示', async () => {
  const root = await temporary(); await clearLegacyVideoPreviewCache(root)
  expect(await fs.readdir(root)).toEqual([]); expect(log.warn).not.toHaveBeenCalled(); expect(log.info).not.toHaveBeenCalled()
})
