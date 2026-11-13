import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { captureOptionsSchema, type CaptureManifest } from '../../../../../src/core/screenRecording/capture'

vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', loadFfprobePath: async () => 'ffprobe' }))
// 探测到的时长一律是 2 秒。
vi.mock('node:child_process', () => ({ execFile: (_binary: string, _args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => done(null, '2.0\n') }))
import { recoverCapture } from './storage'
import { CELL, timingBytes } from './native-timing.test-support'
import { TIMING_FRESH } from './native-timing'

it('没封口的原生采集分片：起点从开始时记下的网格起点，按时刻表补上第 0 帧所在的格与上屏偏移；没有时刻表的分片不动', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-recover-'))
  try {
    const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 30, bitrate: 12_000_000 })
    const manifest: CaptureManifest = { version: 2, minReaderVersion: 1, sessionId: randomUUID(), options, backend: 'gfxcapture', cursorEmbedded: false, status: 'recording', spans: [
      { index: 0, file: 'screen-000000.mp4', monoUs: 1_000_000, durationUs: 0, finalized: false },
      { index: 1, file: 'screen-000001.mp4', monoUs: 9_000_000, durationUs: 0, finalized: false },
    ] }
    await fs.writeFile(path.join(directory, 'screen-000000.mp4'), '')
    await fs.writeFile(path.join(directory, 'screen-000001.mp4'), '')
    // 开始时来源丢着：第 0 帧在第 45 格；之后每帧比所在格晚 5 毫秒上屏。
    const origin = 50_000_000
    await fs.writeFile(path.join(directory, 'screen-000000.frames'), timingBytes(origin, Array.from({ length: 10 }, (_, index) => [Math.round(origin + (45 + index) * CELL + 5000), 45 + index, TIMING_FRESH] as [number, number, number])))
    const recovered = await recoverCapture(directory, manifest)
    expect(recovered.files).toEqual([
      { index: 0, path: path.join(directory, 'screen-000000.mp4'), monoUs: Math.round(1_000_000 + 45 * CELL + 5000), durationUs: 2_000_000 },
      { index: 1, path: path.join(directory, 'screen-000001.mp4'), monoUs: 9_000_000, durationUs: 2_000_000 },
    ])
    // 已经封口：再补一次结果相同，起点不会被加两遍。
    expect((await recoverCapture(directory, manifest)).files[0].monoUs).toBe(Math.round(1_000_000 + 45 * CELL + 5000))
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
