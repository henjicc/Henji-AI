import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDirectoryScans, DIRECTORY_PAGE_SIZE, readDirectoryPage } from './systemDirectory'

const roots: string[] = []
afterEach(async () => { await closeDirectoryScans(1); await closeDirectoryScans(2); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function root(): Promise<string> { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-dir-page-')); roots.push(value); return value }

it('原生目录分页不截断条目，返回真实路径，游标隔离宿主且用完释放', async () => {
  const directory = await root()
  await Promise.all(Array.from({ length: 1001 }, (_, index) => fs.writeFile(path.join(directory, `${index}.mp4`), '')))
  let page = await readDirectoryPage(directory, {}, 1); const firstCursor = page.cursor!
  expect(page.entries).toHaveLength(DIRECTORY_PAGE_SIZE); expect(page.realPath).toBe(await fs.realpath(directory))
  await expect(readDirectoryPage(directory, { cursor: firstCursor }, 2)).rejects.toThrow('目录读取已结束')
  const names = new Set(page.entries.map(entry => entry.name))
  while (page.cursor) { page = await readDirectoryPage(directory, { cursor: page.cursor }, 1); for (const entry of page.entries) names.add(entry.name) }
  expect(names.size).toBe(1001)
  await expect(readDirectoryPage(directory, { cursor: firstCursor }, 1)).rejects.toThrow('目录读取已结束')
})

it('联接目录按目标类型枚举且realpath可识别回环，提前关闭释放句柄', async () => {
  const directory = await root(); const child = path.join(directory, 'child'); await fs.mkdir(child)
  await fs.symlink(directory, path.join(child, 'back'), process.platform === 'win32' ? 'junction' : 'dir')
  const page = await readDirectoryPage(child, {}, 1)
  expect(page.entries).toContainEqual({ name: 'back', isDirectory: true })
  expect((await readDirectoryPage(path.join(child, 'back'), {}, 1)).realPath).toBe(await fs.realpath(directory))
  await Promise.all(Array.from({ length: DIRECTORY_PAGE_SIZE + 1 }, (_, index) => fs.writeFile(path.join(child, `${index}.mp4`), '')))
  const open = await readDirectoryPage(child, {}, 1)
  await readDirectoryPage(child, { cursor: open.cursor, close: true }, 1)
  await expect(readDirectoryPage(child, { cursor: open.cursor }, 1)).rejects.toThrow('目录读取已结束')
})
