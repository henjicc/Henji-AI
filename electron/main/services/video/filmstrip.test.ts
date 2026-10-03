import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('./ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', loadFfprobePath: async () => 'ffprobe' }))

import { createContentDiskCache } from '../media/content-disk-cache'
import { createFilmstripService, filmstripBatchArgs, filmstripInputsPerProcess } from './filmstrip'

interface FakeChild extends EventEmitter { pid: number; stderr: PassThrough; killed: boolean; kill(): boolean; args: string[] }
const directories: string[] = []
let root: string
let spawned: FakeChild[]
let identity: { value: string }
/** 每个输出的写入策略：返回 false 表示该时间点没有画面（文件不写）。 */
let produce: (timeSeconds: number, margin: boolean) => boolean
let autoFinish: boolean

/** 每路输出的实际取帧时间 = 输入侧定位 + 输出侧丢弃（重试时）。 */
function outputsOf(args: string[]): Array<{ time: number; output: string; margin: boolean }> {
  const inputs: number[] = []
  const result: Array<{ time: number; output: string; margin: boolean }> = []
  let pending = 0; let input = -1; let trim = 0
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === '-ss') { if (input < 0) pending = Number(args[index + 1]); else trim = Number(args[index + 1]) }
    if (value === '-i') inputs.push(pending)
    if (value === '-map') { input = Number(args[index + 1].split(':')[0]); trim = 0 }
    if (value === '-y') result.push({ time: Math.round((inputs[input] + trim) * 1e6) / 1e6, output: args[index + 1], margin: trim > 0 })
  }
  return result
}
async function finish(child: FakeChild, code = 0): Promise<void> {
  for (const { time, output, margin } of outputsOf(child.args)) if (produce(time, margin)) await fs.writeFile(output, `frame@${time}`)
  child.emit('close', code)
}
function spawnProcess(_binary: string, args: string[]): FakeChild {
  const child = Object.assign(new EventEmitter(), { pid: spawned.length + 1, stderr: new PassThrough(), killed: false, args, kill() { child.killed = true; setTimeout(() => child.emit('close', null), 0); return true } }) as FakeChild
  spawned.push(child)
  if (autoFinish) setTimeout(() => { if (!child.killed) void finish(child) }, 1)
  return child
}
function service(overrides: Partial<Parameters<typeof createFilmstripService>[0]> = {}): ReturnType<typeof createFilmstripService> {
  return createFilmstripService({
    identity: async source => ({ path: source, identity: identity.value }),
    cache: createContentDiskCache({ directory: () => root, extension: '.webp' }),
    probe: async () => ({ startSeconds: 0, width: 1920, height: 1080 }),
    spawnProcess, gatherMs: 2, ...overrides,
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-filmstrip-'))
  directories.push(root)
  spawned = []; identity = { value: 'a'.repeat(64) }; produce = () => true; autoFinish = true
})
afterEach(async () => { await Promise.all(directories.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))) })

describe('filmstrip frame service', () => {
  it('builds one input per time point relative to the container start, with display-aspect scaling to the height bucket', () => {
    const args = filmstripBatchArgs('D:/clip.mov', 48, [1_000_000, 2_500_000], ['a.tmp', 'b.tmp'], { decodeThreads: 2, containerStartUs: 1_200_000 })
    expect(args.join(' ')).toContain('-threads 2 -ss 0.000000 -i D:/clip.mov -threads 2 -ss 1.300000 -i D:/clip.mov')
    expect(args.join(' ')).toContain("-map 1:v:0 -frames:v 1 -vf scale=w='max(2,trunc(48*dar/2)*2)':h=48:flags=area -c:v libwebp -quality 75 -f webp -y b.tmp")
    // The retry decodes from a margin earlier and discards up to the target on the output side.
    const retry = filmstripBatchArgs('D:/clip.ts', 48, [3_000_000, 20_000_000], ['a.tmp', 'b.tmp'], { containerStartUs: 0, marginUs: 10_000_000 }).join(' ')
    expect(retry).toContain('-ss 0.000000 -i D:/clip.ts -threads 2 -ss 10.000000 -i D:/clip.ts')
    expect(retry).toContain('-map 0:v:0 -ss 3.000000 -frames:v 1')
    expect(retry).toContain('-map 1:v:0 -ss 10.000000 -frames:v 1')
  })

  it('batches frames of one source and height into one process, shares duplicates, and serves the second request from disk', async () => {
    const frames = service()
    const results = await Promise.all([2, 0.5, 1, 2].map(seconds => frames.frame({ source: 'D:/clip.mp4', timeUs: seconds * 1_000_000, height: 48 })))
    expect(spawned).toHaveLength(1)
    expect(outputsOf(spawned[0].args).map(item => item.time)).toEqual([0.5, 1, 2])
    expect(results[0]).toBe(results[3])
    expect(await fs.readFile(results[1], 'utf8')).toBe('frame@0.5')
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
    const again = service()
    expect(await again.frame({ source: 'D:/clip.mp4', timeUs: 500_000, height: 48 })).toBe(results[1])
    expect(spawned).toHaveLength(1)
    expect(again.statistics()).toMatchObject({ hits: 1, generated: 0 })
    // Another height or another content identity is another frame.
    await frames.frame({ source: 'D:/clip.mp4', timeUs: 500_000, height: 96 })
    identity.value = 'b'.repeat(64)
    await frames.frame({ source: 'D:/copy.mp4', timeUs: 500_000, height: 48 })
    expect(spawned).toHaveLength(3)
  })

  it('limits running processes and frames per process, rotating sources so one long clip cannot starve another', async () => {
    autoFinish = false
    const frames = service({ concurrency: 2, batchSize: 4, gatherMs: 40 })
    const pending = [
      ...Array.from({ length: 10 }, (_, index) => frames.frame({ source: 'D:/long.mp4', timeUs: index * 1_000_000, height: 48 })),
      frames.frame({ source: 'D:/short.mp4', timeUs: 0, height: 64 }),
    ]
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    const long = spawned.find(child => child.args.includes('D:/long.mp4'))!
    const short = spawned.find(child => child.args.includes('D:/short.mp4'))!
    // The second slot goes to the other source, not to the long clip's next four frames.
    expect(outputsOf(long.args)).toHaveLength(4)
    expect(short).toBeDefined()
    expect(frames.statistics()).toMatchObject({ running: 2, pending: 6 })
    await finish(short)
    await vi.waitFor(() => expect(spawned).toHaveLength(3))
    autoFinish = true
    await finish(long); await finish(spawned[2])
    await Promise.all(pending)
    expect(spawned.map(child => outputsOf(child.args).length).sort()).toEqual([1, 2, 4, 4])
  })

  it('drops cancelled queued frames, kills a process once every frame in it lost its waiters, and restarts later requests', async () => {
    autoFinish = false
    const frames = service({ concurrency: 1 })
    const running = new AbortController()
    const first = frames.frame({ source: 'D:/clip.mp4', timeUs: 0, height: 48 }, running.signal)
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const queued = new AbortController()
    const second = frames.frame({ source: 'D:/other.mp4', timeUs: 0, height: 48 }, queued.signal)
    queued.abort(new DOMException('gone', 'AbortError'))
    await expect(second).rejects.toThrow('gone')
    running.abort(new DOMException('scrolled away', 'AbortError'))
    await expect(first).rejects.toThrow('scrolled away')
    expect(spawned[0].killed).toBe(true)
    autoFinish = true
    // A new request for the same frame does not join the killed process.
    expect(await fs.readFile(await frames.frame({ source: 'D:/clip.mp4', timeUs: 0, height: 48 }), 'utf8')).toBe('frame@0')
    expect(spawned).toHaveLength(2)
    expect(spawned[1].args).not.toContain('D:/other.mp4')
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps a running frame alive while another waiter still wants it', async () => {
    autoFinish = false
    const frames = service()
    const leaving = new AbortController()
    const left = frames.frame({ source: 'D:/clip.mp4', timeUs: 0, height: 48 }, leaving.signal)
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const staying = frames.frame({ source: 'D:/clip.mp4', timeUs: 0, height: 48 })
    // Let the second waiter finish its identity and cache lookups and join the running frame.
    await new Promise(resolve => setTimeout(resolve, 20))
    leaving.abort(new DOMException('gone', 'AbortError'))
    await expect(left).rejects.toThrow('gone')
    expect(spawned[0].killed).toBe(false)
    await finish(spawned[0])
    expect(await fs.readFile(await staying, 'utf8')).toBe('frame@0')
  })

  it('retries frames a direct seek could not decode from a margin earlier, reports frames still without a picture, and refuses frames of a file that changed meanwhile', async () => {
    // A direct seek to 3s yields nothing; the margin retry (input seek 0, output seek 3) does. Nothing exists beyond 5s.
    produce = (time, margin) => time < 5 && (time !== 3 || margin)
    const frames = service()
    const [inside, seekFailed, beyond] = await Promise.allSettled([1, 3, 9].map(seconds => frames.frame({ source: 'D:/clip.mp4', timeUs: seconds * 1_000_000, height: 48 })))
    expect(inside.status).toBe('fulfilled')
    expect(seekFailed.status).toBe('fulfilled')
    expect(beyond).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('未能取得') }) })
    expect(spawned).toHaveLength(2)
    expect(outputsOf(spawned[1].args)).toHaveLength(2)
    expect(spawned[1].args.join(' ')).toContain('-map 0:v:0 -ss 3.000000')
    autoFinish = false
    const changed = frames.frame({ source: 'D:/clip.mp4', timeUs: 2_000_000, height: 48 })
    await vi.waitFor(() => expect(spawned).toHaveLength(3))
    identity.value = 'c'.repeat(64)
    await finish(spawned[2])
    await expect(changed).rejects.toThrow('变化')
    expect((await fs.readdir(root)).filter(name => name.endsWith('.webp'))).toHaveLength(2)
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('splits a batch of large pictures into consecutive processes within the decoder memory budget', async () => {
    expect([filmstripInputsPerProcess(3840, 2160, 8), filmstripInputsPerProcess(2560, 1440, 8), filmstripInputsPerProcess(1920, 1080, 8), filmstripInputsPerProcess(7680, 4320, 8), filmstripInputsPerProcess(0, 0, 8)]).toEqual([2, 4, 8, 1, 8])
    const frames = service({ probe: async () => ({ startSeconds: 0, width: 3840, height: 2160 }), concurrency: 1 })
    await Promise.all([0, 1, 2, 3, 4].map(seconds => frames.frame({ source: 'D:/uhd.mp4', timeUs: seconds * 1_000_000, height: 48 })))
    expect(spawned.map(child => outputsOf(child.args).length)).toEqual([2, 2, 1])
    expect(frames.statistics()).toMatchObject({ batches: 1, generated: 5 })
  })

  it('kills a process that exceeds the time limit', async () => {
    autoFinish = false
    const frames = service({ timeoutMs: 20 })
    await expect(frames.frame({ source: 'D:/clip.mp4', timeUs: 0, height: 48 })).rejects.toThrow('超时')
    expect(spawned[0].killed).toBe(true)
  })
})
