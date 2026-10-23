import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AudioCaptureFiles } from './files'

vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: vi.fn(), enqueueMediaCandidates: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-capture-')); roots.push(root)
  const data = new Map<string, string>()
  const store = () => ({ get: (key: string) => data.get(key) ?? null, set: (key: string, value: string) => { data.set(key, value) } })
  const trash = vi.fn(async (target: string) => { await fs.rename(target, `${target}.trashed`) })
  return { root, data, trash, files: new AudioCaptureFiles(() => root, store, trash), reopen: () => new AudioCaptureFiles(() => root, store, trash) }
}
describe('作品目录录音恢复', () => {
  it('先登记再启动，重启读回，重名不覆盖，完成后不再提示', async () => {
    const { files, reopen, root } = await fixture()
    const now = new Date(2026, 9, 23, 12, 0, 0)
    const first = await files.prepare(now), second = await files.prepare(now)
    expect(first.outputPath).toBe(path.join(root, '录音', '录音 2026-10-23 120000.wav'))
    expect(second.name).toBe('录音 2026-10-23 120000 (1).wav')
    expect(await files.pending()).toEqual([])
    await fs.writeFile(first.outputPath, 'unfinished')
    expect(await reopen().pending()).toMatchObject([first])
    await reopen().complete(first.outputPath)
    expect(await reopen().pending()).toEqual([])
    expect(await fs.readFile(first.outputPath, 'utf8')).toBe('unfinished')
  })
  it('回收失败保持恢复记录，拒绝外部路径和损坏/新版记录', async () => {
    const { files, reopen, trash, data } = await fixture()
    const file = await files.prepare(); await fs.writeFile(file.outputPath, 'wav')
    trash.mockRejectedValueOnce(new Error('回收站不可用'))
    await expect(files.discard(file.outputPath)).rejects.toThrow('回收站不可用')
    expect(await reopen().pending()).toMatchObject([file])
    await expect(files.discard(path.join(os.tmpdir(), file.name))).rejects.toThrow('只能处理')
    await files.discard(file.outputPath); expect(await reopen().pending()).toEqual([])
    data.set('audio_capture.pending_files', '{"version":3,"minReaderVersion":3,"files":[]}')
    await expect(reopen().pending()).rejects.toThrow()
    expect(data.get('audio_capture.pending_files')).toContain('"version":3')
  })
})

it('旧登记迁移保留文件，新登记重启后保留作品、覆盖范围与稳定拼接标识', async () => {
  const { files, data, reopen } = await fixture()
  data.set('audio_capture.pending_files', JSON.stringify({ version: 1, minReaderVersion: 1, files: ['录音 2026-10-23 120000.wav'] }))
  const placement = { projectId: 'p', startFrame: 10, endFrame: 20, revision: 2, spliceId: 'eced7817-a431-49e0-8890-5bf4b08ecb44' }
  const file = await files.prepare(new Date(2026, 9, 23, 12, 0, 0), placement)
  await fs.writeFile(file.outputPath, Buffer.alloc(92))
  expect(await reopen().pending()).toMatchObject([{ ...file, placement }])
  expect(JSON.parse(data.get('audio_capture.pending_files')!).files).toHaveLength(2)
  await reopen().complete(file.outputPath)
  expect(JSON.parse(data.get('audio_capture.pending_files')!).placements).toEqual({})
})
