import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))
vi.mock('./logging', () => ({ createMainLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
import { readFileBytes, writeFileBytes, writeTextFile } from './system'
const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
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

it.each(['write', 'close'] as const)('排他发布前%s失败清理自身暂存，目标未出现且可重试', async failure => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-output-failure-')); directories.push(directory)
  const target = path.join(directory, 'frame.png'); const open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => {
    const handle = await open(file, flags, mode)
    if (failure === 'write') { const write = handle.writeFile.bind(handle); vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => { await write(new Uint8Array([9])); throw new Error('ENOSPC') }) }
    else { const close = handle.close.bind(handle); vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw new Error('close failed') }) }
    return handle
  })
  await expect(writeFileBytes(target, new Uint8Array([1, 2]), { exclusive: true })).rejects.toThrow()
  expect(await fs.readdir(directory)).toEqual([])
  await writeFileBytes(target, new Uint8Array([1, 2]), { exclusive: true }); expect([...await fs.readFile(target)]).toEqual([1, 2])
})

it('排他发布时目标竞速出现，保留竞争文件并清理自己的暂存', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-output-race-')); directories.push(directory)
  const target = path.join(directory, 'frame.png'); const link = fs.link.bind(fs)
  vi.spyOn(fs, 'link').mockImplementationOnce(async (source, destination) => { await fs.writeFile(target, new Uint8Array([7, 8]), { flag: 'wx' }); await link(source, destination) })
  await expect(writeFileBytes(target, new Uint8Array([1]), { exclusive: true })).rejects.toThrow()
  expect([...await fs.readFile(target)]).toEqual([7, 8]); expect(await fs.readdir(directory)).toEqual(['frame.png'])
})

it('完成发布后暂存清理失败保留完整目标并返回成功', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-output-published-')); directories.push(directory)
  const target = path.join(directory, 'frame.png')
  vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup unavailable'))
  await writeFileBytes(target, new Uint8Array([1, 2, 3]), { exclusive: true })
  expect([...await fs.readFile(target)]).toEqual([1, 2, 3])
})

it('文件系统不支持排他发布时明确失败，只清理暂存且不降级覆盖目标', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-output-unsupported-')); directories.push(directory)
  const target = path.join(directory, 'frame.png')
  vi.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' }))
  await expect(writeFileBytes(target, new Uint8Array([1]), { exclusive: true })).rejects.toThrow('hard links unsupported')
  expect(await fs.readdir(directory)).toEqual([])
})

it('有界文件读取完整保留允许字节，拒绝过大文件及非法预算，默认读取不受影响', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-code-read-')); directories.push(directory)
  const target = path.join(directory, 'asset.henji-code'); await fs.writeFile(target, new Uint8Array([1, 2, 3]))
  expect([...await readFileBytes(target, { maxBytes: 3 })]).toEqual([1, 2, 3])
  expect([...await readFileBytes(target)]).toEqual([1, 2, 3])
  for (const maxBytes of [0, -1, 1.5, 16 * 1024 * 1024 + 1, 2]) await expect(readFileBytes(target, { maxBytes })).rejects.toThrow()
})
it('有界读取期间文件膨胀仍拒绝，关闭原句柄且不截断原文件', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-code-read-grow-')); directories.push(directory)
  const target = path.join(directory, 'asset.henji-code'); await fs.writeFile(target, new Uint8Array([1, 2]))
  const open = fs.open.bind(fs); const closed = vi.fn()
  vi.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => {
    const handle = await open(file, flags, mode); const stat = handle.stat.bind(handle); const close = handle.close.bind(handle)
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => { const initial = await stat(); await fs.appendFile(target, new Uint8Array([3, 4, 5])); return initial })
    vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); closed() })
    return handle
  })
  await expect(readFileBytes(target, { maxBytes: 4 })).rejects.toThrow('超出预算')
  expect(closed).toHaveBeenCalledOnce(); expect([...await fs.readFile(target)]).toEqual([1, 2, 3, 4, 5])
})
