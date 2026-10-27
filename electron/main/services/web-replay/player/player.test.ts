import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRecordingStore } from '../store'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  samples: vi.fn(), encoded: vi.fn(),
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
        else if (url !== 'about:blank') fake.handlers.get('web-replay:report')?.({ sender: { id: 123 } }, { kind: 'ready', now: 0 })
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
vi.mock('./encoder', () => ({ FrameEncoder: class {
  frames = 0; width = 10; height = 10; sourceWidth = 10; sourceHeight = 10
  async start(): Promise<void> {}
  async write(): Promise<void> { this.frames++; fake.encoded() }
  async finish(): Promise<void> {}
  abort(): void {}
} }))

import { WebRecordingPlayer } from './player'
import { BOX_TRACK_FILE } from '../boxTrack'

let root = ''
afterEach(async () => {
  vi.useRealTimers()
  fake.samples.mockReset()
  fake.encoded.mockClear()
  if (root) await fs.rm(root, { recursive: true, force: true })
})

it.each([{ scale: 1, video: true, count: 3 }, { scale: 2, video: false, count: 6 }])('播放器同一输出时钟写 boxes：$scale 倍慢放、video=$video', async ({ scale, video, count }) => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-box-player-'))
  const store = {
    directory: root,
    readManifest: async () => ({ id: 'recording', status: 'complete', durationUs: 0, env: { url: 'https://example.test/', viewport: { width: 10, height: 10, dpr: 1 } } }),
    readData: async () => ({ calls: [], external: [] }), readBehavior: async () => [], readStorage: async () => ({}), readResources: async () => ({ entries: [] }),
  } as unknown as WebRecordingStore
  fake.samples.mockImplementation(async () => ({ width: 10, height: 10, items: [['node-a', fake.samples.mock.calls.length, 0, 1, 1]] }))
  // 只加速调度时钟，不模拟文件 I/O；不创建真实 Electron 窗口。
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const result = await new WebRecordingPlayer(store).render({ output: path.join(root, 'video.mp4'), fps: 4, timeScale: scale, video, boxSelectors: ['.ask'] })
  expect(result.frames).toBe(6)
  expect(fake.samples).toHaveBeenCalledTimes(count)
  expect(fake.samples.mock.calls[0][0]).toContain('[".ask"]')
  const lines = (await fs.readFile(path.join(root, BOX_TRACK_FILE), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { t: number })
  expect(lines.map(line => line.t)).toEqual(scale === 1 ? [0, 500_000, 1_000_000, 1_500_000] : [0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000, 1_500_000])
  expect(fake.encoded).toHaveBeenCalledTimes(video ? 6 : 0)
})
