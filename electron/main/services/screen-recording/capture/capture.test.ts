import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { captureOptionsSchema, captureRegionFromDip, type CaptureManifest } from '../../../../../src/core/screenRecording/capture'
import { CaptureStorage, readCaptureManifest } from './storage'
import { buildGfxCaptureArgs, GfxCaptureBackend } from './gfxcapture'
vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../../video/hwaccel', () => ({ invalidateEncoderCache: vi.fn(async () => undefined), getPreferredEncoder: vi.fn() }))
const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 })
const source = { selector: 'hmonitor' as const, handle: '100', width: 3840, height: 2160 }
const profile = { id: 'h264_nvenc' as const, label: 'NVENC', buildEncodeArgs: () => ['-c:v', 'h264_nvenc'] }
async function fixture(): Promise<CaptureStorage> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-capture-'))
  const manifest: CaptureManifest = { version: 1, sessionId: randomUUID(), options, backend: 'gfxcapture', cursorEmbedded: false, status: 'prepared', spans: [] }
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
      const pending = backend.pause(new AbortController().signal)
      expect(storage.manifest.spans[1].finalized).toBe(false)
      await pending
      expect(storage.manifest.spans[1]).toMatchObject({ finalized: true, durationUs: 1_000_000, monoUs: 1_000_000 })
      await backend.resume(new AbortController().signal)
      children[2].emit('close', 3)
      expect(failed).toHaveBeenCalledOnce()
      await backend.cancel()
      expect(storage.manifest.spans[2].finalized).toBe(false)
    } finally { await backend.cancel(); await fs.rm(storage.directory, { recursive: true, force: true }) }
  })
})
