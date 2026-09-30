import { expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
const host = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { on: vi.fn(), getPath: () => host.userData } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
import { cancelVideoPreview, prepareVideoPreview, releaseVideoPreviewOwner, validateVideoPreviewRequest } from './preview-proxy'
it('仅允许本地绝对路径和有界预览段，不接受远程下载或任意进程参数', () => {
  const valid = { requestId: '00000000-0000-0000-0000-000000000000', source: process.platform === 'win32' ? 'E:/original.mp4' : '/media/original.mp4', startSeconds: 29, durationSeconds: 32 }
  expect(validateVideoPreviewRequest(valid)).toEqual(valid)
  for (const value of [{ ...valid, source: 'https://example.org/video.mp4' }, { ...valid, source: 'relative.mp4' }, { ...valid, durationSeconds: 33 }, { ...valid, durationSeconds: 0 }, { ...valid, startSeconds: -1 }, { ...valid, startSeconds: Infinity }, { ...valid, requestId: 'anything' }]) expect(() => validateVideoPreviewRequest(value)).toThrow('无效')
})

it('真实 FFmpeg 保留 CFR/VFR 帧时间和非零源入点，复用缓存且不修改原素材', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-preview-time-'))
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('henji-preview-time-')) throw new Error('测试目录边界无效')
  host.userData = directory
  const run = promisify(execFile)
  const binary = await loadFfmpegPath(); const probe = await loadFfprobePath()
  const times = async (file: string): Promise<number[]> => {
    const { stdout } = await run(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file], { windowsHide: true })
    const frames = (JSON.parse(stdout) as { frames: { best_effort_timestamp_time: string }[] }).frames
    return frames.map(frame => Number(frame.best_effort_timestamp_time))
  }
  const ids: string[] = []
  try {
    for (const variable of [false, true]) {
      const source = path.join(directory, `${variable ? 'vfr' : 'cfr'}.mp4`)
      await run(binary, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=60', '-t', '5', ...(variable ? ['-vf', 'select=not(eq(mod(n\\,3)\\,1))'] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '120', '-bf', '2', '-fps_mode', 'passthrough', source], { windowsHide: true })
      const digest = crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex')
      const request = { requestId: crypto.randomUUID(), source, startSeconds: 2, durationSeconds: 2 }
      ids.push(request.requestId)
      const first = await prepareVideoPreview(request, 42)
      expect(first.cacheHit).toBe(false)
      const original = (await times(source)).filter(time => time >= 2 && time < 4)
      const preview = (await times(first.path)).map(time => time + first.startSeconds)
      expect(preview.length).toBe(original.length)
      for (let index = 0; index < original.length; index++) expect(Math.abs(preview[index] - original[index])).toBeLessThan(0.000002)
      const secondId = crypto.randomUUID(); ids.push(secondId)
      const second = await prepareVideoPreview({ ...request, requestId: secondId }, 42)
      expect(second.cacheHit).toBe(true); expect(second.path).toBe(first.path)
      expect(crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex')).toBe(digest)
      expect(() => cancelVideoPreview(request.requestId, 99)).toThrow('不属于')
    }
    expect((await fs.readdir(path.join(directory, 'cache', 'video-edit-preview'))).some(name => name.includes('partial'))).toBe(false)
  } finally {
    for (const id of ids) cancelVideoPreview(id, 42)
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 20000)

it('排队中的任务可立即取消且不能被其他窗口取消', async () => {
  const request = { requestId: crypto.randomUUID(), source: path.join(os.tmpdir(), 'unused.mp4'), startSeconds: 0, durationSeconds: 1 }
  const preparing = prepareVideoPreview(request, 42)
  expect(() => cancelVideoPreview(request.requestId, 99)).toThrow('不属于')
  releaseVideoPreviewOwner(99)
  releaseVideoPreviewOwner(42)
  await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
})
