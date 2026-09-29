import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))
vi.mock('./logging', () => ({ createMainLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
import { writeFileBytes, writeTextFile } from './system'
const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
it('流式导出按位置写入且不会截断前后内容或覆盖已有目标', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-video-write-')); directories.push(directory)
  const target = path.join(directory, 'output.mp4')
  await writeFileBytes(target, new Uint8Array([1, 2, 3, 4]), { exclusive: true })
  await writeFileBytes(target, new Uint8Array([9, 8]), { position: 1 })
  expect([...await fs.readFile(target)]).toEqual([1, 9, 8, 4])
  await expect(writeFileBytes(target, new Uint8Array([0]), { exclusive: true })).rejects.toThrow()
  await expect(writeFileBytes(target, new Uint8Array([0]), { position: -1 })).rejects.toThrow()
  expect([...await fs.readFile(target)]).toEqual([1, 9, 8, 4])
})
it('工程文本完整原子替换并移除临时文件', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-video-save-')); directories.push(directory)
  const target = path.join(directory, '工程.henji-video')
  await writeTextFile(target, '{"name":"old"}')
  await writeTextFile(target, '{"name":"new"}')
  expect(await fs.readFile(target, 'utf8')).toBe('{"name":"new"}')
  expect(await fs.readdir(directory)).toEqual(['工程.henji-video'])
})
