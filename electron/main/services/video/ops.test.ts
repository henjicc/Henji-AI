import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ directory: '', fail: false, paused: false, hardware: false, complete: () => {}, exec: vi.fn(), retry: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: state.exec }))
vi.mock('../image/path-utils', () => ({ getUploadsDir: () => state.directory }))
vi.mock('../image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('./ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', loadFfprobePath: async () => 'ffprobe' }))
vi.mock('./hwaccel', () => ({ getPreferredEncoder: async () => ({ id: state.hardware ? 'gpu' : 'cpu', buildEncodeArgs: () => [] }), isHardwareEncoder: () => state.hardware, invalidateEncoderCache: state.retry }))
import { compressVideoToFit, trimVideoSource, readVideoAnalysisGeometry, readVideoInfo } from './ops'

type Options = { signal?: AbortSignal; timeout?: number }
type Callback = (error: Error | null, stdout: string, stderr: string) => void
let source: string
beforeEach(async () => {
  vi.clearAllMocks(); state.fail = false; state.paused = false; state.hardware = false
  state.directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'henji-video-ops-'))
  source = path.join(state.directory, 'source.webm')
  await fs.promises.writeFile(source, Buffer.alloc(2048))
  state.exec.mockImplementation((binary: string, args: string[], options: Options, callback: Callback) => {
    if (binary === 'ffprobe') {
      const valid = fs.statSync(args.at(-1)!).size > 0 && fs.readFileSync(args.at(-1)!)[0] !== 255
      queueMicrotask(() => callback(null, JSON.stringify({ format: { duration: valid ? '10' : '0' }, streams: [{ codec_type: 'video', width: 640, height: 480 }] }), ''))
      return
    }
    if (state.paused) {
      fs.writeFileSync(args.at(-1)!, Buffer.from([1, 2, 3]))
      state.complete = () => callback(null, '', '')
      options.signal?.addEventListener('abort', () => callback(new Error('aborted'), '', ''), { once: true })
      return
    }
    setTimeout(() => {
      fs.writeFileSync(args.at(-1)!, state.fail ? Buffer.alloc(0) : Buffer.from([1, 2, 3]))
      callback(state.fail ? new Error('encoder failed') : null, '', '')
    }, 5)
  })
})
afterEach(async () => { await fs.promises.rm(state.directory, { recursive: true, force: true }) })
const modes = ['trim', 'compress'] as const
function run(mode: typeof modes[number], signal?: AbortSignal) {
  return mode === 'trim'
    ? trimVideoSource({ source, startSeconds: 0, endSeconds: 5 }, signal)
    : compressVideoToFit({ source, maxSizeMB: 0.001 }, signal)
}
const encodes = () => state.exec.mock.calls.filter(call => call[0] === 'ffmpeg')
it('analysis geometry shares the probe while preserving coded metadata and calibrating SAR and display rotation', async () => {
  expect(await readVideoInfo(source)).toEqual({ durationSeconds: 10, width: 640, height: 480, hasAudio: false })
  state.exec.mockImplementationOnce((_binary: string, _args: string[], _options: Options, callback: Callback) => callback(null, JSON.stringify({ streams: [{ codec_type: 'video', width: 720, height: 576, sample_aspect_ratio: '16:15', side_data_list: [{ rotation: 90 }] }] }), ''))
  expect(await readVideoAnalysisGeometry(source)).toEqual({ aspectRatio: 4 / 3, rotation: 90 })
  state.exec.mockImplementationOnce((_binary: string, _args: string[], _options: Options, callback: Callback) => callback(null, JSON.stringify({ streams: [{ codec_type: 'video', width: 1080, height: 1920, sample_aspect_ratio: '0:1' }] }), ''))
  expect(await readVideoAnalysisGeometry(source)).toEqual({ aspectRatio: 9 / 16, rotation: 0 })
  state.exec.mockImplementationOnce((_binary: string, _args: string[], _options: Options, callback: Callback) => callback(null, JSON.stringify({ streams: [{ codec_type: 'video', width: 640, height: 480, sample_aspect_ratio: '16:0' }] }), ''))
  await expect(readVideoAnalysisGeometry(source)).rejects.toThrow('比例或旋转')
})
it.each(modes)('%s 失败不发布半成品，重试重新编码且临时文件保留容器后缀', async mode => {
  state.fail = true
  await expect(run(mode)).rejects.toThrow('encoder failed')
  expect(await fs.promises.readdir(state.directory)).toEqual(['source.webm'])
  state.fail = false
  const result = await run(mode)
  expect(await fs.promises.readFile(result.path)).toEqual(Buffer.from([1, 2, 3]))
  expect(encodes()).toHaveLength(2)
  expect(path.extname(encodes()[0][1].at(-1)!)).toBe(mode === 'trim' ? '.webm' : '.mp4')
})
it.each(modes)('%s 并发同源只编码一次；零字节和无有效时长缓存自动重建', async mode => {
  const [first, second] = await Promise.all([run(mode), run(mode)])
  expect(first.path).toBe(second.path); expect(encodes()).toHaveLength(1)
  for (const bytes of [Buffer.alloc(0), Buffer.from([255])]) {
    await fs.promises.writeFile(first.path, bytes)
    await run(mode)
  }
  expect(encodes()).toHaveLength(3)
})
it.each(modes)('%s 取消终止编码且清理临时文件，不重试编码器', async mode => {
  state.paused = true
  state.hardware = true
  const controller = new AbortController()
  const pending = run(mode, controller.signal)
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(encodes()).toHaveLength(1))
  expect(encodes()[0][2]).toMatchObject({ signal: expect.any(AbortSignal), timeout: expect.any(Number) })
  controller.abort()
  await rejection
  expect(await fs.promises.readdir(state.directory)).toEqual(['source.webm'])
  expect(state.retry).not.toHaveBeenCalled()
})

it.each(modes)('%s 共享任务中一个等待者取消不终止其他等待者', async mode => {
  state.paused = true
  const controller = new AbortController()
  const first = run(mode, controller.signal)
  const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const second = run(mode)
  await vi.waitFor(() => expect(encodes()).toHaveLength(1))
  controller.abort(); await rejection
  expect((encodes()[0][2] as Options).signal!.aborted).toBe(false)
  state.complete()
  const result = await second
  expect([...await fs.promises.readFile(result.path)]).toEqual([1, 2, 3])
})
