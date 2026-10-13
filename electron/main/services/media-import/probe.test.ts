import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ root: '', exec: vi.fn(), owned: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: mocks.exec }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => mocks.root }))
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: mocks.owned }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', loadFfprobePath: async () => 'ffprobe' }))
import { writeVideoPoster } from './probe'

beforeEach(async () => { mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-poster-')); vi.clearAllMocks() })
afterEach(async () => { await fs.rm(mocks.root, { recursive: true, force: true }) })
it('失败清理半成品、重新生成原子发布并登记归属，同 key 并发只写一次', async () => {
  let fail = true
  mocks.exec.mockImplementation((_binary: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    void fs.writeFile(args.at(-1)!, fail ? 'partial' : 'complete').then(() => callback(fail ? new Error('encoder failed') : null, '', ''))
  })
  await expect(writeVideoPoster('source.mp4', 'key', 3)).rejects.toThrow('encoder failed')
  expect(await fs.readdir(mocks.root)).toEqual([])
  fail = false
  const [one, two] = await Promise.all([writeVideoPoster('source.mp4', 'key', 3), writeVideoPoster('source.mp4', 'key', 3)])
  expect(one.posterPath).toBe(two.posterPath)
  expect(await fs.readFile(one.posterPath, 'utf8')).toBe('complete')
  expect(mocks.exec).toHaveBeenCalledTimes(2)
  expect(mocks.exec.mock.calls[1][1]).toEqual(expect.arrayContaining(['-f', 'image2']))
  expect(mocks.owned).toHaveBeenCalledWith(one.posterPath, 'source.mp4')
  await expect(writeVideoPoster('source.mp4', 'key', 3)).resolves.toMatchObject({ cacheHit: true })
})
