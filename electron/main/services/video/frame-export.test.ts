import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
const fixture = vi.hoisted(() => ({ directory: '', args: [] as string[], stdin: null as import('node:stream').PassThrough | null, child: null as (import('node:events').EventEmitter & { kill: import('vitest').Mock }) | null }))
vi.mock('node:child_process', () => ({ spawn: (_binary: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, kill: vi.fn() })
  child.stdin.on('finish', () => { fs.writeFileSync(args.at(-1)!, 'encoded-output'); child.exitCode = 0; child.emit('close', 0) })
  fixture.args = args; fixture.stdin = child.stdin; fixture.child = child
  return child
} }))
vi.mock('../image/path-utils', () => ({ getUploadsDir: () => fixture.directory, sanitizeFileStem: (stem: string) => stem, ensureOutputPathWithExtension: (file: string) => file }))
vi.mock('./ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'process-boundary' }))
vi.mock('./hwaccel', () => ({ getPreferredEncoder: async () => ({ id: 'cpu', label: 'CPU' }) }))
vi.mock('../work-root/busy-probes', () => ({ registerWorkRootBusyProbe: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { videoFrameExportFilterArgs, startVideoFrameExport, appendVideoFrameExport, finishVideoFrameExport, cancelVideoFrameExport } from './frame-export'
beforeEach(async () => { fixture.directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'henji-frame-export-copy-')) })
afterEach(async () => { await fs.promises.rm(fixture.directory, { recursive: true, force: true }) })
it('原有 MP4 默认底向上保持；GIF 顶向下和逐帧调色板不缓存整段画面', () => {
  expect(videoFrameExportFilterArgs({}, ['-c:v', 'libx264'])).toEqual(['-vf', 'vflip,scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264'])
  expect(videoFrameExportFilterArgs({ format: 'gif', orientation: 'top-down' }, [])).toEqual(['-filter_complex', 'split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1', '-c:v', 'gif'])
  expect(videoFrameExportFilterArgs({ format: 'gif' }, [])[1]).toMatch(/^vflip,/)
})
it.each(['mp4', 'gif'] as const)('%s 用户目标的发布契约：GIF 不覆盖；旧 MP4 保留选定目标覆盖行为', async format => {
  const target = path.join(fixture.directory, `selected.${format}`); await fs.promises.writeFile(target, 'original-file')
  const { sessionId } = await startVideoFrameExport({ format, frameCount: 1, fps: 10, width: 2, height: 2, fileNameStem: 'step' })
  await appendVideoFrameExport({ sessionId, frameIndex: 0, bytes: new Uint8Array(16) })
  const finish = finishVideoFrameExport({ sessionId, targetPath: target })
  if (format === 'gif') { await expect(finish).rejects.toThrow(); expect(await fs.promises.readFile(target, 'utf8')).toBe('original-file') }
  else { expect((await finish).savedPath).toBe(target); expect(await fs.promises.readFile(target, 'utf8')).toBe('encoded-output') }
})
it('渲染层流水送帧：前一帧还在等管道 drain 时下一帧到达，仍按帧序接收并各自等到被编码器接走', async () => {
  const { sessionId } = await startVideoFrameExport({ pixelFormat: 'yuv420p', frameCount: 2, fps: 10, width: 128, height: 128, fileNameStem: 'pipelined' })
  expect(fixture.args.slice(fixture.args.indexOf('-pixel_format'), fixture.args.indexOf('-pixel_format') + 2)).toEqual(['-pixel_format', 'yuv420p'])
  const frame = new Uint8Array(128 * 128 * 3 / 2)
  const first = appendVideoFrameExport({ sessionId, frameIndex: 0, bytes: frame })
  const second = appendVideoFrameExport({ sessionId, frameIndex: 1, bytes: frame })
  let settled = false
  void Promise.allSettled([first, second]).then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(settled).toBe(false)
  fixture.stdin!.resume()
  await expect(Promise.all([first, second])).resolves.toEqual([{ frameIndex: 0 }, { frameIndex: 1 }])
  await expect(appendVideoFrameExport({ sessionId, frameIndex: 2, bytes: new Uint8Array(128 * 128 * 4) })).rejects.toThrow(/byte length mismatch/)
  expect((await finishVideoFrameExport({ sessionId })).frameCount).toBe(2)
})
it('取消要等编码器进程退出后才删会话目录：Windows 上进程退出前一直占着输出文件', async () => {
  const { sessionId } = await startVideoFrameExport({ frameCount: 1, fps: 10, width: 2, height: 2, fileNameStem: 'cancel' })
  const dir = path.dirname(fixture.args.at(-1)!)
  let closed = false
  fixture.child!.kill.mockImplementation(() => { setTimeout(() => { closed = true; fixture.child!.emit('close', null) }, 20) })
  await cancelVideoFrameExport(sessionId)
  expect(closed).toBe(true)
  expect(fs.existsSync(dir)).toBe(false)
})
it('编码器不响应 SIGTERM 时，取消在宽限期后强制结束它，不会一直挂着', async () => {
  const { sessionId } = await startVideoFrameExport({ frameCount: 1, fps: 10, width: 2, height: 2, fileNameStem: 'stuck' })
  const dir = path.dirname(fixture.args.at(-1)!)
  fixture.child!.kill.mockImplementation((signal: string) => { if (signal === 'SIGKILL') setTimeout(() => fixture.child!.emit('close', null), 0) })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const cancel = cancelVideoFrameExport(sessionId)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(10)
    await cancel
  } finally { vi.useRealTimers() }
  expect(fixture.child!.kill).toHaveBeenCalledWith('SIGKILL')
  expect(fs.existsSync(dir)).toBe(false)
})
