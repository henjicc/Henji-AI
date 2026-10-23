import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AudioCaptureFiles } from './files'

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
    expect(await reopen().pending()).toEqual([first])
    reopen().complete(first.outputPath)
    expect(await reopen().pending()).toEqual([])
    expect(await fs.readFile(first.outputPath, 'utf8')).toBe('unfinished')
  })
  it('回收失败保持恢复记录，拒绝外部路径和损坏/新版记录', async () => {
    const { files, reopen, trash, data } = await fixture()
    const file = await files.prepare(); await fs.writeFile(file.outputPath, 'wav')
    trash.mockRejectedValueOnce(new Error('回收站不可用'))
    await expect(files.discard(file.outputPath)).rejects.toThrow('回收站不可用')
    expect(await reopen().pending()).toEqual([file])
    await expect(files.discard(path.join(os.tmpdir(), file.name))).rejects.toThrow('只能处理')
    await files.discard(file.outputPath); expect(await reopen().pending()).toEqual([])
    data.set('audio_capture.pending_files', '{"version":2,"minReaderVersion":2,"files":[]}')
    await expect(reopen().pending()).rejects.toThrow()
    expect(data.get('audio_capture.pending_files')).toContain('"version":2')
  })
})
