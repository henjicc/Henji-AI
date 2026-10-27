import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRecordingStore } from '../store'
import { CAPTURE_TOKEN_COLORS } from '../../../../../packages/web-replay-probe/src/replay/types'

/**
 * Fake replay pages that keep page time exactly as the probe's virtual clock does: it only moves when the
 * engine calls advance/frame. Each window has its own page; a frame paints a picture carrying its token.
 */
interface FakePage { id: number; pageNow: number; frames: number; log: string[]; dispatched: Array<{ kind: string; at: number }>; paint: null | ((event: unknown, dirty: unknown, image: unknown) => void) }
interface FakeEncoder { output: string; writes: number[]; finished: number[] }
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  pages: [] as FakePage[],
  encoders: [] as FakeEncoder[],
  aborted: vi.fn(),
  /** Frames (by index) whose picture changes; others repaint only the token. */
  changing: new Set<number>(),
  /** Before the frame's own picture, an older picture still showing the previous token arrives. */
  staleFirst: true,
  failAtFrame: -1,
  nextId: 100,
  gpuOpened: 0,
  gpuBreaksMidway: false,
}))

function image(token: number, value = token): unknown {
  const pixel = Buffer.from([CAPTURE_TOKEN_COLORS[token][2], CAPTURE_TOKEN_COLORS[token][1], CAPTURE_TOKEN_COLORS[token][0], 255])
  return { crop: () => ({ toBitmap: () => pixel }), toBitmap: () => Buffer.alloc(10 * 10 * 4, value), getSize: () => ({ width: 10, height: 10 }), resize: () => image(token, value), token }
}

function evaluate(page: FakePage) {
  return async (code: string): Promise<unknown> => {
    let m: RegExpMatchArray | null
    if ((m = code.match(/\.advance\(([\d.]+)\)/))) {
      page.pageNow = Math.max(page.pageNow, Number(m[1]))
      return { now: page.pageNow, timers: 0, nextDue: Infinity }
    }
    if ((m = code.match(/\.frame\(([\d.]+), (\{.*\})\)/))) {
      const t = Number(m[1])
      const options = JSON.parse(m[2]) as { token?: number; samples?: string[] }
      const index = page.frames++
      if (index === fake.failAtFrame) throw new Error('页面崩了')
      page.pageNow = Math.max(page.pageNow, t)
      page.log.push(`frame ${page.pageNow}${options.token === undefined ? '' : ' captured'}`)
      if (options.token !== undefined) {
        const token = options.token
        const previous = (token + CAPTURE_TOKEN_COLORS.length - 1) % CAPTURE_TOKEN_COLORS.length
        const dirty = fake.changing.has(index) ? { x: 0, y: 0, width: 10, height: 10 } : { x: 0, y: 0, width: 2, height: 2 }
        setTimeout(() => {
          if (fake.staleFirst && index > 0) page.paint?.(null, { x: 0, y: 0, width: 2, height: 2 }, image(previous))
          page.paint?.(null, dirty, image(token, index))
        }, 1)
      }
      const samples: Record<string, unknown> = {}
      for (const name of options.samples ?? []) samples[name] = { ok: true, value: { width: 10, height: 10, items: [[name === 'boxes' ? 'node-a' : 'hello', page.pageNow, 0, 1, 1]] } }
      return { now: page.pageNow, timers: 0, frameCallbacks: 0, animations: 0, quiet: false, samples }
    }
    if (code.includes('.realFrame()')) return code.includes('viewport') ? { width: 10, height: 10 } : undefined
    if (code.includes('.resolveTarget(')) return code.includes('missing') ? null : { x: 40, y: 50 }
    return true
  }
}

vi.mock('electron', () => ({
  ipcMain: { on: (key: string, handler: (...args: unknown[]) => void) => fake.handlers.set(key, handler), handle: vi.fn() },
  session: { fromPartition: () => ({ clearStorageData: async () => {}, protocol: { unhandle: vi.fn() } }) },
  nativeImage: { createFromBitmap: () => ({ toJPEG: () => Buffer.from('jpeg') }) },
  BrowserWindow: class {
    private readonly page: FakePage = { id: fake.nextId++, pageNow: 0, frames: 0, log: [], dispatched: [], paint: null }
    webContents = {
      id: this.page.id,
      page: this.page,
      debugger: { attach: vi.fn(), sendCommand: async () => ({}) },
      loadURL: async (url: string) => {
        if (url.includes('bootstrap')) fake.handlers.get('web-replay:bootstrapped')?.({ sender: { id: this.page.id } })
        else if (url !== 'about:blank') { this.page.pageNow = 20; fake.handlers.get('web-replay:report')?.({ sender: { id: this.page.id } }, { kind: 'ready', now: 20 }) }
      },
      setFrameRate: vi.fn(), executeJavaScript: evaluate(this.page),
      on: (event: string, callback: FakePage['paint']) => { if (event === 'paint') this.page.paint = callback },
    }
    constructor() { fake.pages.push(this.page) }
    setContentSize = vi.fn()
    isDestroyed = () => false
    destroy = vi.fn()
  },
}))
vi.mock('./site', () => ({ BOOTSTRAP_PATH: '/bootstrap', installReplaySite: () => ({ inFlight: () => 0, idle: async () => {} }) }))
vi.mock('./input', () => ({ InputDispatcher: class {
  misses = 0
  position = { x: 7, y: 8 }
  pressed = 0
  constructor(private readonly contents: { page: FakePage; id: number }) {}
  async dispatch(event: { kind: string; type?: string; x?: number; y?: number }): Promise<{ x: number; y: number } | null> {
    this.contents.page.dispatched.push({ kind: event.type ? `${event.kind}:${event.type}` : event.kind, at: this.contents.page.pageNow })
    return event.kind === 'pointer' ? { x: event.x ?? 1, y: event.y ?? 2 } : null
  }
  async moveTo(x: number, y: number): Promise<void> { this.position = { x, y }; this.contents.page.dispatched.push({ kind: 'move', at: this.contents.page.pageNow }) }
  async insertText(text: string): Promise<void> {
    this.contents.page.dispatched.push({ kind: `text:${text}`, at: this.contents.page.pageNow })
    // 第二个字让页面发出录制里没有的请求
    if (text === 'b') fake.handlers.get('web-replay:report')?.({ sender: { id: this.contents.id } }, { kind: 'conflict', t: this.contents.page.pageNow * 1000, message: '这一步会发出录制里没有的请求：POST https://example.test/suggest' })
  }
  async dispose(): Promise<void> {}
} }))
vi.mock('../store', () => ({ WebRecordingStore: class {}, digestBase64: vi.fn() }))
// 测试环境没有 WebGPU 取帧窗口：默认 GPU 取帧打不开，播放器退回 CPU 画面；gpuBreaksMidway 时打开了但取帧中途坏掉
vi.mock('./gpuCapture', () => {
  class GpuCaptureError extends Error {}
  return {
    isReplayReader: () => false,
    GpuCaptureError,
    GpuFrameCapture: class {
      async open(): Promise<void> { fake.gpuOpened += 1; if (!fake.gpuBreaksMidway) throw new Error('no WebGPU here') }
      attach(): void {}
      async take(): Promise<never> { throw new GpuCaptureError('取帧窗口没了') }
      async takeLatest(): Promise<null> { return null }
      discard(): void {}
      stats(): Record<string, number> { return {} }
      async dispose(): Promise<void> {}
    },
  }
})
vi.mock('./encoder', () => ({ prepareFrameEncoder: async () => {}, FrameEncoder: class {
  frames = 0; sent = 0; width = 10; height = 10; sourceWidth = 10; sourceHeight = 10
  private readonly record: FakeEncoder
  constructor(...args: [number, number, number, string]) { this.record = { output: args[3], writes: [], finished: [] }; fake.encoders.push(this.record) }
  async start(): Promise<void> { await fs.writeFile(this.record.output, 'partial') }
  async write(_bitmap: Buffer, frame: number): Promise<void> { this.record.writes.push(frame); this.sent++; this.frames = frame + 1 }
  async finish(last: number): Promise<void> { this.record.finished.push(last); this.frames = last + 1 }
  async abort(): Promise<boolean> { fake.aborted(); return true }
} }))

import { WebRecordingPlayer } from './player'
import { parseWebReplayDirector } from '../../../../../src/core/webReplay/director'
import { BOX_TRACK_FILE } from '../boxTrack'
import { TEXT_TRACK_FILE } from '../textTrack'

let root = ''
afterEach(async () => {
  fake.pages = []
  fake.encoders = []
  fake.aborted.mockClear()
  fake.changing = new Set()
  fake.staleFirst = true
  fake.failAtFrame = -1
  fake.gpuOpened = 0
  fake.gpuBreaksMidway = false
  if (root) await fs.rm(root, { recursive: true, force: true })
})

function recordingStore(directory: string, behavior: unknown[] = [], durationUs = 0): WebRecordingStore {
  return {
    directory,
    readManifest: async () => ({ id: 'recording', status: 'complete', durationUs, env: { url: 'https://example.test/', viewport: { width: 10, height: 10, dpr: 1 } } }),
    readData: async () => ({ calls: [], external: [], callbacks: [], random: { math: [], uuid: [], bytes: [] }, clipboard: [] }), readBehavior: async () => behavior, readStorage: async () => ({}), readResources: async () => ({ entries: [] }),
  } as unknown as WebRecordingStore
}

const readTrack = async (file: string): Promise<Array<{ t: number; items: unknown[][] }>> => (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { t: number; items: unknown[][] })

it('逐帧推进页面时间：输入按录制时刻派发，每帧在它的时刻渲染、采样，帧标记对上的画面才编码，没变的帧不再送编码器', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-lockstep-'))
  const behavior = [{ kind: 'pointer', type: 'move', t: 300_000, x: 1, y: 1 }, { kind: 'key', type: 'down', t: 760_000 }, { kind: 'focus', t: 800_000, focused: true }]
  fake.changing = new Set([0, 2, 3])
  const textFile = path.join(root, TEXT_TRACK_FILE)
  // 1.5 秒收尾，4 fps：6 帧
  const result = await new WebRecordingPlayer(recordingStore(root, behavior)).render({ output: path.join(root, 'video.mp4'), fps: 4, textTrack: textFile, boxSelectors: ['.ask'] })
  expect(result.frames).toBe(6)
  const [page] = fake.pages
  // 页面准备好时停在 20ms，之后每帧都正好在自己的录制时刻（第 0 帧画面就是 20ms 那一刻）
  expect(page.log).toEqual(['frame 20 captured', 'frame 250 captured', 'frame 500 captured', 'frame 750 captured', 'frame 1000 captured', 'frame 1250 captured'])
  expect(page.dispatched).toEqual([{ kind: 'pointer:move', at: 300 }, { kind: 'key:down', at: 760 }])
  // 第 0、2、3 帧画面变了才编码；第 0 帧还代表它之前的时间
  expect(fake.encoders.map(encoder => [encoder.writes, encoder.finished])).toEqual([[[0, 2, 3], [5]]])
  const boxes = await readTrack(path.join(root, BOX_TRACK_FILE))
  // 每帧都采位置轨，内容来自同一帧的页面状态（这里页面时刻写在条目里）
  expect(boxes.map(line => line.t)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000, 1_500_000])
  expect(boxes.slice(1, -1).map(line => line.items[0][1])).toEqual([250, 500, 750, 1000, 1250])
  expect((await readTrack(textFile)).map(line => line.t)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000, 1_500_000])
})

it('只出文字轨时不等画面、不编码', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-lockstep-text-'))
  const result = await new WebRecordingPlayer(recordingStore(root)).render({ output: path.join(root, TEXT_TRACK_FILE), fps: 4, video: false, textTrack: path.join(root, TEXT_TRACK_FILE) })
  expect(result.frames).toBe(6)
  expect(fake.encoders).toEqual([])
  expect(fake.pages[0].log).toEqual(['frame 20', 'frame 250', 'frame 500', 'frame 750', 'frame 1000', 'frame 1250'])
})

it('中途失败：删掉写了一半的视频，文字轨与位置轨不覆盖上一次完整的结果', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-lockstep-fail-'))
  const boxFile = path.join(root, BOX_TRACK_FILE), textFile = path.join(root, TEXT_TRACK_FILE), output = path.join(root, 'video.mp4')
  await fs.writeFile(boxFile, 'previous boxes\n')
  await fs.writeFile(textFile, 'previous text\n')
  fake.changing = new Set([0, 1, 2])
  fake.failAtFrame = 3
  await expect(new WebRecordingPlayer(recordingStore(root)).render({ output, fps: 4, textTrack: textFile })).rejects.toThrow('页面崩了')
  expect(fake.aborted).toHaveBeenCalledTimes(1)
  await expect(fs.access(output)).rejects.toThrow()
  expect(await fs.readFile(boxFile, 'utf8')).toBe('previous boxes\n')
  expect(await fs.readFile(textFile, 'utf8')).toBe('previous text\n')
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('只出文字轨失败时不删上一次完整的文字轨', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-lockstep-textfail-'))
  const textFile = path.join(root, TEXT_TRACK_FILE)
  await fs.writeFile(textFile, 'previous text\n')
  fake.failAtFrame = 2
  await expect(new WebRecordingPlayer(recordingStore(root)).render({ output: textFile, fps: 4, video: false, textTrack: textFile })).rejects.toThrow('页面崩了')
  expect(await fs.readFile(textFile, 'utf8')).toBe('previous text\n')
})

it('GPU 取帧中途坏掉：结果不发布，整段改用 CPU 画面重演，帧照样每帧对上', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-lockstep-gpu-fallback-'))
  fake.gpuBreaksMidway = true
  fake.changing = new Set([0, 3])
  const result = await new WebRecordingPlayer(recordingStore(root)).render({ output: path.join(root, 'video.mp4'), fps: 4 })
  expect(fake.gpuOpened).toBe(1)
  expect(result.frames).toBe(6)
  // 第一遍（GPU）开了窗口但没出帧；第二遍（CPU）从头重演
  expect(fake.pages).toHaveLength(2)
  expect(fake.encoders.map(encoder => [encoder.writes, encoder.finished])).toEqual([[[0, 3], [5]]])
})

it('导演稿：剪掉的区间不出帧分小步推过去，打字逐字输入，冲突点名导演稿那一步，版本的行为轨在输出时间上', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-lockstep-director-'))
  const behavior = [
    { kind: 'text', t: 500_000, data: 'ab' },
    { kind: 'pointer', type: 'down', t: 2_000_000, x: 3, y: 3, button: 0, buttons: 1, clickCount: 1, pointerType: 'mouse', mods: 0 },
    { kind: 'pointer', type: 'move', t: 2_700_000, x: 9, y: 9, button: -1, buttons: 0, clickCount: 0, pointerType: 'mouse', mods: 0 },
  ]
  fake.changing = new Set(Array.from({ length: 40 }, (_, i) => i))
  const director = parseWebReplayDirector({ version: 1, timeline: { segments: [{ from: 0, to: 1 }, { from: 2.5, to: 3.5, speed: 2 }] }, typewriter: [{ at: 0.5, charsPerSecond: 10, jitter: 0 }] })
  const boxTrack = path.join(root, 'take-boxes.jsonl')
  const result = await new WebRecordingPlayer(recordingStore(root, behavior, 2_000_000)).render({ output: path.join(root, 'take.mp4'), fps: 10, director, boxTrack })
  // 留下 1 秒 + 打两个字 0.2 秒 + 1 秒的录制按 2 倍速 0.5 秒
  expect(result.frames).toBe(17)
  expect(result.durationMs).toBeCloseTo(1700, 6)
  const [page] = fake.pages
  // 打字时页面时间照走（0.5→0.7 秒），之后页面时间比录制多 0.2 秒；剪掉的 1.0–2.5 秒（页面 1.2–2.7 秒）按 50 毫秒一步推，不出画面
  const cut = page.log.filter(line => !line.endsWith('captured')).map(line => Number(line.split(' ')[1]))
  expect(cut[0]).toBe(1250)
  expect(cut.at(-1)).toBe(2700)
  expect(cut.length).toBe(30)
  const captured = page.log.filter(line => line.endsWith('captured')).map(line => Number(line.split(' ')[1]))
  expect(captured.slice(0, 3)).toEqual([20, 100, 200])
  expect(captured.slice(5, 9)).toEqual([500, 600, 700, 800])
  expect(captured.slice(12)).toEqual([2700, 2900, 3100, 3300, 3500])
  expect(page.dispatched).toEqual([{ kind: 'text:a', at: 500 }, { kind: 'text:b', at: 600 }, { kind: 'pointer:down', at: 2200 }, { kind: 'pointer:move', at: 2900 }])
  expect(result.issues).toEqual([{ t: 500_000, kind: 'conflict', message: '导演稿 typewriter[0]（逐字打字） 引起：这一步会发出录制里没有的请求：POST https://example.test/suggest' }])
  // 版本自己的行为轨：输出时间上；剪掉区间里的按下不在里面，接缝处补上鼠标所在
  expect(result.takeTracks!.behavior.map(event => [event.kind, event.t])).toEqual([['text', 500_000], ['text', 600_000], ['pointer', 1_200_000], ['pointer', 1_300_000]])
  expect(result.takeTracks!.timeMap.frameRecUs.slice(11, 14)).toEqual([900_000, 2_500_000, 2_700_000])
  expect(result.takeTracks!.timeMap.cuts).toEqual([{ recUs: [1_000_000, 2_500_000], outUs: 1_200_000 }])
  // 位置轨写在给定的位置，时刻是输出时间
  expect((await readTrack(boxTrack)).map(line => line.t).slice(-3)).toEqual([1_500_000, 1_600_000, 1_700_000])
  await expect(fs.access(path.join(root, BOX_TRACK_FILE))).rejects.toThrow()
})
