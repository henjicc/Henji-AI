import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { captureOptionsSchema, captureRegionFromDip, type CaptureManifest } from '../../../../../src/core/screenRecording/capture'
import { CaptureStorage, readCaptureManifest, recoverCapture } from './storage'
import { buildGfxCaptureArgs, GfxCaptureBackend } from './gfxcapture'
vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../../video/hwaccel', async importOriginal => ({ ...await importOriginal<typeof import('../../video/hwaccel')>(), invalidateEncoderCache: vi.fn(async () => undefined), getPreferredEncoder: vi.fn() }))
const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 })
const source = { selector: 'hmonitor' as const, handle: '100', width: 3840, height: 2160 }
const profile = { id: 'h264_nvenc' as const, label: 'NVENC', buildEncodeArgs: () => ['-c:v', 'h264_nvenc'] }
async function fixture(): Promise<CaptureStorage> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-capture-'))
  const manifest: CaptureManifest = { version: 2, sessionId: randomUUID(), options, backend: 'gfxcapture', cursorEmbedded: false, status: 'prepared', spans: [] }
  const storage = new CaptureStorage(directory, manifest); await storage.prepare(); return storage
}
function processFixture(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  Object.assign(child, { exitCode: null, signalCode: null })
  child.kill = vi.fn(() => { Object.assign(child, { signalCode: 'SIGTERM' }); child.emit('close', null); return true })
  child.stdin.on('finish', () => { Object.assign(child, { exitCode: 0 }); child.emit('exit', 0); setTimeout(() => child.emit('close', 0), 10) })
  return child
}
describe('screen capture ownership and durable spans', () => {
  it('旧清单升级时保留码率、原片与原件，并建立备份', async () => {
    const storage = await fixture()
    try {
      const file = path.join(storage.directory, 'capture.json')
      const raw = JSON.stringify({ ...storage.manifest, version: 1 })
      await fs.writeFile(file, raw)
      expect(await readCaptureManifest(storage.directory)).toMatchObject({ version: 2, options: { bitrate: 12_000_000 } })
      expect(await fs.readFile(file, 'utf8')).toBe(raw)
      expect(await fs.readdir(path.join(storage.directory, '.henji', 'backups'))).not.toHaveLength(0)
    } finally { await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('validates region and maps negative desktop DIP independently of DPI', () => {
    expect(captureRegionFromDip({ x: -1800, y: 100, width: 960, height: 540 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 0.0625, y: 100 / 1080, width: .5, height: .5 })
    expect(() => captureOptionsSchema.parse({ ...options, region: { x: .8, y: 0, width: .5, height: 1 } })).toThrow()
    const args = buildGfxCaptureArgs({ ...options, region: { x: .25, y: .25, width: .5, height: .5 } }, source, profile, 'screen.mp4')
    expect(args.join(' ')).toContain('hmonitor=100:capture_cursor=0')
    expect(args.join(' ')).toContain('crop_left=960:crop_top=540:crop_right=960:crop_bottom=540')
    expect(args).toContain('+frag_keyframe+empty_moov+default_base_moof')
  })
  it('serializes durable writes, rejects holes/stale spans and preserves crash recovery metadata', async () => {
    const storage = await fixture()
    try {
      const span = await storage.openSpan(15)
      await storage.write(span.index, 0, new Uint8Array([1, 2, 3]))
      await expect(storage.write(span.index, 10, new Uint8Array([4]))).rejects.toThrow('位置')
      await storage.write(span.index, 1, new Uint8Array([5]))
      await storage.release()
      expect([...await fs.readFile(storage.file(span))]).toEqual([1, 5, 3])
      expect((await readCaptureManifest(storage.directory)).spans[0]).toMatchObject({ monoUs: 15, finalized: false })
      await expect(storage.prepare()).rejects.toMatchObject({ code: 'EEXIST' })
      await expect(storage.write(span.index, 0, new Uint8Array([9]))).rejects.toThrow('关闭')
    } finally { await storage.release(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('waits for close, resumes into a new span and falls back after hardware startup failure', async () => {
    const storage = await fixture(), children: ChildProcessWithoutNullStreams[] = []
    const failed = vi.fn()
    const spawn = vi.fn((_binary: string, args: string[]) => {
      const child = processFixture(); children.push(child)
      setTimeout(() => {
        if (args.includes('h264_nvenc')) { child.stderr.emit('data', Buffer.from('encoder unavailable')); Object.assign(child, { exitCode: 1 }); child.emit('close', 1) }
        else child.stdout.emit('data', Buffer.from('out_time_us=1000000\n'))
      }, 1)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => 2_000_000, failed })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(storage.manifest.encoding).toMatchObject({ encoder: 'software', softwareFallback: true })
      const pending = backend.pause(new AbortController().signal)
      expect(storage.manifest.spans[1].finalized).toBe(false)
      await pending
      expect(storage.manifest.spans[1]).toMatchObject({ finalized: true, durationUs: 1_000_000, monoUs: 1_000_000 })
      await backend.resume(new AbortController().signal)
      await backend.cancel()
      expect(storage.manifest.spans[2].finalized).toBe(false)
      expect(failed).not.toHaveBeenCalled()
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('编码进程录到一半意外退出：在新分片里接着录；一分钟内反复退出才停下', async () => {
    const storage = await fixture(), children: ChildProcessWithoutNullStreams[] = []
    const failed = vi.fn(), restarted = vi.fn()
    const spawn = vi.fn(() => {
      const child = processFixture(); children.push(child)
      setTimeout(() => child.stdout.emit('data', Buffer.from('frame=60\ndrop_frames=2\ndup_frames=1\nout_time_us=1000000\n')), 1)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => 2_000_000, failed, restarted })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      // 驱动重置：进程自己退出，不是我们让它停的。
      Object.assign(children[0], { exitCode: 1 }); children[0].emit('close', 1)
      await vi.waitFor(() => expect(restarted).toHaveBeenCalledOnce())
      // 退出的那片不按进度封口，留给收尾按文件里真实的画面算时长。
      expect(storage.manifest.spans.map(span => [span.finalized, span.durationUs])).toEqual([[false, 0], [false, 0]])
      expect(backend.stats()).toMatchObject({ restarts: 1, droppedFrames: 4, duplicatedFrames: 2 })
      for (let i = 1; i <= 5; i++) { Object.assign(children[i], { exitCode: 1 }); children[i].emit('close', 1); await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(Math.min(i + 2, 6))) }
      await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
      expect(failed.mock.calls[0][0].message).toContain('多次')
      expect(storage.manifest.spans).toHaveLength(6)
      expect(failed).toHaveBeenCalledTimes(1)
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('被录的窗口关闭：进程报完结尾、来源也确认没了，不对着已经不在的窗口续录，这一片按进度封口并报来源结束', async () => {
    const storage = await fixture(), children: ChildProcessWithoutNullStreams[] = []
    const failed = vi.fn(), sourceEnded = vi.fn()
    const spawn = vi.fn(() => {
      const child = processFixture(); children.push(child)
      setTimeout(() => child.stdout.emit('data', Buffer.from('out_time_us=1000000\n')), 1)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => 2_000_000, failed, sourceEnded, sourceGone: async () => true })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      // 与实测一致：gfxcapture 在窗口关闭后约 70 ms 输出最后一次进度（progress=end），退出码 0。
      children[0].stdout.emit('data', Buffer.from('out_time_us=2733333\nprogress=end\n'))
      Object.assign(children[0], { exitCode: 0 }); children[0].emit('close', 0)
      await vi.waitFor(() => expect(sourceEnded).toHaveBeenCalledOnce())
      expect(spawn).toHaveBeenCalledTimes(1); expect(failed).not.toHaveBeenCalled()
      expect(storage.manifest.spans[0]).toMatchObject({ finalized: true, durationUs: 2_733_333 })
      await backend.stop(new AbortController().signal)
      expect(backend.stats().restarts).toBe(0)
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('只报了结尾而来源还在（如短暂查不准）：照常续录，不把正常的长录停掉', async () => {
    const storage = await fixture(), children: ChildProcessWithoutNullStreams[] = []
    const failed = vi.fn(), sourceEnded = vi.fn(), restarted = vi.fn()
    const spawn = vi.fn(() => {
      const child = processFixture(); children.push(child)
      setTimeout(() => child.stdout.emit('data', Buffer.from('out_time_us=1000000\n')), 1)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => 2_000_000, failed, sourceEnded, restarted, sourceGone: async () => false })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      children[0].stdout.emit('data', Buffer.from('progress=end\n'))
      Object.assign(children[0], { exitCode: 0 }); children[0].emit('close', 0)
      await vi.waitFor(() => expect(restarted).toHaveBeenCalledOnce())
      expect(spawn).toHaveBeenCalledTimes(2); expect(sourceEnded).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled()
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('退出时来源还在、续录途中才没了：同样按来源结束，不报采集失败', async () => {
    const storage = await fixture(), children: ChildProcessWithoutNullStreams[] = []
    const failed = vi.fn(), sourceEnded = vi.fn()
    const spawn = vi.fn(() => {
      const child = processFixture(); children.push(child)
      const first = children.length === 1
      setTimeout(() => {
        if (first) child.stdout.emit('data', Buffer.from('out_time_us=1000000\n'))
        else { child.stderr.emit('data', Buffer.from('Failed to create capture item\n')); Object.assign(child, { exitCode: 1 }); child.emit('close', 1) }
      }, 1)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => 2_000_000, failed, sourceEnded, sourceGone: async () => spawn.mock.calls.length > 1 })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      Object.assign(children[0], { exitCode: 1 }); children[0].emit('close', 1)
      await vi.waitFor(() => expect(sourceEnded).toHaveBeenCalledOnce())
      expect(failed).not.toHaveBeenCalled()
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('第一帧时刻按采集一出帧的打点估（不含编码排队），打点行不进报错文本', async () => {
    const storage = await fixture()
    let now = 3_000_000
    const spawn = vi.fn((_binary: string, args: string[]) => {
      const child = processFixture()
      expect(args.join(' ')).toContain(String.raw`setpts='PTS+0*print(PTS*TB\,16)'`)
      setTimeout(() => {
        // 采集打点：第 0 帧 3.0 秒到，第 1 帧（16.7 ms）晚到了一点。
        child.stderr.emit('data', Buffer.from('[Eval @ 0000020a] 0.000000\n[Eval @ 0000020a] 0.01'))
        now = 3_030_000; child.stderr.emit('data', Buffer.from('6667\n[gfxcapture @ 1] Setting minimum update interval unavailable\n'))
        // 编码进度晚 100 ms 才报：按它估会晚 100 ms。
        now = 3_600_000; child.stdout.emit('data', Buffer.from('out_time_us=500000\n'))
      }, 1)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => now, failed: vi.fn() })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      expect(storage.manifest.spans[0].monoUs).toBe(3_000_000)
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('续录期间停止：新进程起来后也会被停下，不留后台编码', async () => {
    const storage = await fixture(), children: ChildProcessWithoutNullStreams[] = []
    const spawn = vi.fn(() => {
      const child = processFixture(); children.push(child)
      setTimeout(() => child.stdout.emit('data', Buffer.from('out_time_us=500000\n')), 5)
      return child
    })
    const backend = new GfxCaptureBackend(options, source, storage, { spawn, binary: async () => 'ffmpeg', encoder: async () => profile, nowUs: () => 2_000_000, failed: vi.fn() })
    try {
      await backend.prepare(); await backend.start(new AbortController().signal)
      Object.assign(children[0], { exitCode: 1 }); children[0].emit('close', 1)
      await backend.stop(new AbortController().signal)
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(children[1].exitCode).not.toBeNull()
      expect(storage.manifest.spans.map(span => span.finalized)).toEqual([false, true])
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
  it('一帧都没录到的分片（封了口、时长为 0、文件不在）没有东西可补，不算恢复失败', async () => {
    const storage = await fixture()
    try {
      storage.manifest.spans.push({ index: 0, file: 'screen-000000.mp4', monoUs: 0, durationUs: 0, finalized: true })
      await expect(recoverCapture(storage.directory, storage.manifest)).resolves.toMatchObject({ files: [], rejected: [], repaired: 0 })
    } finally { await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
})
