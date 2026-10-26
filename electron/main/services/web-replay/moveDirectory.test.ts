import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const { move } = vi.hoisted(() => ({ move: vi.fn() }))
vi.mock('../fs/no-overwrite', async importOriginal => ({ ...await importOriginal<typeof import('../fs/no-overwrite')>(), moveDirectoryNoOverwrite: move }))
import { moveWebRecordingDirectory } from './moveDirectory'

afterEach(() => { move.mockReset(); vi.useRealTimers() })

it('网页录制在工程与回收区之间移动走不覆盖的跨盘移动：跨盘时复制后删除，不再因 EXDEV 失败', async () => {
  const actual = (await vi.importActual<typeof import('../fs/no-overwrite')>('../fs/no-overwrite')).moveDirectoryNoOverwrite
  move.mockImplementation(actual)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-web-move-'))
  try {
    const from = path.join(root, '工程', '录屏.hjweb'), to = path.join(root, '.trash', 'rec-1')
    await fs.mkdir(from, { recursive: true }); await fs.writeFile(path.join(from, 'manifest.json'), '{}')
    await moveWebRecordingDirectory(from, to)
    expect(move).toHaveBeenCalledWith(from, to)
    expect(await fs.readFile(path.join(to, 'manifest.json'), 'utf8')).toBe('{}')
    await expect(fs.access(from)).rejects.toThrow()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('文件被占用时短暂重试，仍占用时给出可操作的说明', async () => {
  vi.useFakeTimers()
  const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
  move.mockRejectedValueOnce(busy).mockResolvedValueOnce(undefined)
  const moved = moveWebRecordingDirectory('a', 'b')
  await vi.advanceTimersByTimeAsync(200)
  await expect(moved).resolves.toBeUndefined()
  expect(move).toHaveBeenCalledTimes(2)
  move.mockReset(); move.mockRejectedValue(busy)
  const stuck = moveWebRecordingDirectory('a', 'b').then(() => new Error('应当失败'), (error: Error) => error)
  await vi.advanceTimersByTimeAsync(200 * 16)
  expect((await stuck).message).toContain('正被其他程序占用')
})
