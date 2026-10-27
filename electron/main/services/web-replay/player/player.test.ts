import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRecordingStore } from '../store'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  samples: vi.fn(), encoded: vi.fn(), aborted: vi.fn(),
  /** 每编码一帧墙钟往前走多少毫秒，模拟机器忙、取帧编码跟不上。 */
  encodeMs: 0,
  /** 页面时钟：报 ready 的墙钟时刻与慢放倍数，采样据此报它在页面里执行的时刻。 */
  pageStart: 0, scale: 1,
}))
vi.mock('electron', () => ({
  ipcMain: { on: (key: string, handler: (...args: unknown[]) => void) => fake.handlers.set(key, handler), handle: vi.fn() },
  session: { fromPartition: () => ({ clearStorageData: async () => {}, protocol: { unhandle: vi.fn() } }) },
  BrowserWindow: class {
    webContents = {
      id: 123,
      debugger: { attach: vi.fn(), sendCommand: async () => ({}) },
      loadURL: async (url: string) => {
        if (url.includes('bootstrap')) fake.handlers.get('web-replay:bootstrapped')?.({ sender: { id: 123 } })
        else if (url !== 'about:blank') { fake.pageStart = Date.now(); fake.handlers.get('web-replay:report')?.({ sender: { id: 123 } }, { kind: 'ready', now: 0 }) }
      },
      setFrameRate: vi.fn(), executeJavaScript: fake.samples,
      on: (_event: string, callback: (...args: unknown[]) => void) => callback(null, null, { toBitmap: () => Buffer.alloc(400), getSize: () => ({ width: 10 }) }),
    }
    isDestroyed = () => false
    destroy = vi.fn()
  },
}))
vi.mock('./site', () => ({ BOOTSTRAP_PATH: '/bootstrap', installReplaySite: vi.fn() }))
vi.mock('./input', () => ({ InputDispatcher: class { misses = 0; async dispose(): Promise<void> {} } }))
vi.mock('../store', () => ({ WebRecordingStore: class {}, digestBase64: vi.fn() }))
vi.mock('./encoder', () => ({ prepareFrameEncoder: async () => {}, FrameEncoder: class {
  frames = 0; width = 10; height = 10; sourceWidth = 10; sourceHeight = 10
  private readonly output: string
  constructor(...args: [number, number, number, string]) { this.output = args[3] }
  async start(): Promise<void> { await fs.writeFile(this.output, 'partial') }
  async write(): Promise<void> { this.frames++; fake.encoded(); if (fake.encodeMs) vi.setSystemTime(Date.now() + fake.encodeMs) }
  async finish(): Promise<void> {}
  async abort(): Promise<boolean> { fake.aborted(); return true }
} }))

import { WebRecordingPlayer } from './player'
import { DRIFT_PEAK_LIMIT_MS, WebReplayDriftError } from './drift'
import { BOX_TRACK_FILE } from '../boxTrack'
import { TEXT_TRACK_FILE } from '../textTrack'

let root = ''
afterEach(async () => {
  vi.useRealTimers()
  fake.samples.mockReset()
  fake.encoded.mockClear()
  fake.aborted.mockClear()
  fake.encodeMs = 0
  fake.scale = 1
  if (root) await fs.rm(root, { recursive: true, force: true })
})

function recordingStore(directory: string): WebRecordingStore {
  return {
    directory,
    readManifest: async () => ({ id: 'recording', status: 'complete', durationUs: 0, env: { url: 'https://example.test/', viewport: { width: 10, height: 10, dpr: 1 } } }),
    readData: async () => ({ calls: [], external: [] }), readBehavior: async () => [], readStorage: async () => ({}), readResources: async () => ({ entries: [] }),
  } as unknown as WebRecordingStore
}

/** 页面里执行一次采样：带上页面时刻（录制时间毫秒），内容每次都变，好看出写了哪几次。 */
const changingSample = async (): Promise<unknown> => ({ at: (Date.now() - fake.pageStart) / fake.scale, value: { width: 10, height: 10, items: [['node-a', fake.samples.mock.calls.length, 0, 1, 1]] } })

it.each([{ scale: 1, video: true, count: 3 }, { scale: 2, video: false, count: 6 }])('播放器同一输出时钟写 boxes：$scale 倍慢放、video=$video', async ({ scale, video, count }) => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-box-player-'))
  fake.samples.mockImplementation(changingSample)
  fake.scale = scale
  // 只加速调度时钟，不模拟文件 I/O；不创建真实 Electron 窗口。
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const result = await new WebRecordingPlayer(recordingStore(root)).render({ output: path.join(root, 'video.mp4'), fps: 4, timeScale: scale, video, boxSelectors: ['.ask'] })
  expect(result.frames).toBe(6)
  expect(fake.samples).toHaveBeenCalledTimes(count)
  expect(fake.samples.mock.calls[0][0]).toContain('[".ask"]')
  const lines = (await fs.readFile(path.join(root, BOX_TRACK_FILE), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { t: number })
  expect(lines.map(line => line.t)).toEqual(scale === 1 ? [0, 500_000, 1_000_000, 1_500_000] : [0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000, 1_500_000])
  expect(fake.encoded).toHaveBeenCalledTimes(video ? 6 : 0)
})

it('取帧编码持续跟不上：判定错位，不发布视频、文字轨与位置轨；放慢一倍后同样的负载对得上', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-drift-player-'))
  const boxFile = path.join(root, BOX_TRACK_FILE), textFile = path.join(root, TEXT_TRACK_FILE), output = path.join(root, 'video.mp4')
  await fs.writeFile(boxFile, 'previous boxes\n')
  await fs.writeFile(textFile, 'previous text\n')
  fake.samples.mockImplementation(changingSample)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // 每帧 250ms，编码却要 400ms：每帧多落后 150ms（录制时间），几帧后就超前过半秒
  fake.encodeMs = 400
  const failure = await new WebRecordingPlayer(recordingStore(root)).render({ output, fps: 4, timeScale: 1, textTrack: textFile }).then(() => null, (error: unknown) => error)
  expect(failure).toBeInstanceOf(WebReplayDriftError)
  expect((failure as WebReplayDriftError).timeScale).toBe(1)
  expect((failure as WebReplayDriftError).drift.peakLeadMs).toBeGreaterThan(DRIFT_PEAK_LIMIT_MS)
  // 超前过限后提前停下，不渲完再丢
  expect(fake.encoded.mock.calls.length).toBeLessThan(6)
  expect(fake.aborted).toHaveBeenCalledTimes(1)
  await expect(fs.access(output)).rejects.toThrow()
  expect(await fs.readFile(boxFile, 'utf8')).toBe('previous boxes\n')
  expect(await fs.readFile(textFile, 'utf8')).toBe('previous text\n')
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])

  // 页面慢一倍时每帧有 500ms，同样 400ms 的编码赶得上
  fake.scale = 2
  const result = await new WebRecordingPlayer(recordingStore(root)).render({ output, fps: 4, timeScale: 2, textTrack: textFile })
  expect(result.frames).toBe(6)
  expect(result.issues.filter(issue => issue.message.includes('没赶上实时'))).toEqual([])
  expect(await fs.readFile(boxFile, 'utf8')).not.toBe('previous boxes\n')
  expect(await fs.readFile(textFile, 'utf8')).not.toBe('previous text\n')
})

it('采样慢时不挡取帧：上一次没回来或刚回来就跳过这一刻，太迟的结果不写进位置轨', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-slow-sample-'))
  fake.scale = 2
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // 第一次采样要 600ms 墙钟（2 倍慢放下是录制时间 300ms，超过舍弃线），之后都很快
  fake.samples.mockImplementation(async () => {
    if (fake.samples.mock.calls.length === 1) await new Promise(resolve => setTimeout(resolve, 600))
    return changingSample()
  })
  const result = await new WebRecordingPlayer(recordingStore(root)).render({ output: path.join(root, 'video.mp4'), fps: 4, timeScale: 2, boxSelectors: ['.ask'] })
  // 帧照常按时编码，没有被慢采样拖住
  expect(result.frames).toBe(6)
  expect(result.issues.filter(issue => issue.message.includes('没赶上实时'))).toEqual([])
  expect(result.issues.map(issue => issue.message)).toContain('界面文字与元素位置有 1 个时刻取得太慢，已舍弃，那几处的轨会稀一些')
  const lines = (await fs.readFile(path.join(root, BOX_TRACK_FILE), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { t: number })
  // 0 时刻那次太迟被舍弃；它在路上与回来后歇着的那几刻被跳过
  expect(lines[0].t).toBeGreaterThan(250_000)
  expect(fake.samples.mock.calls.length).toBeLessThan(6)
})
