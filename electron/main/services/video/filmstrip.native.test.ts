import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createContentDiskCache } from '../media/content-disk-cache'
import { loadFfmpegPath } from './ffmpeg-loader'
import { createFilmstripService } from './filmstrip'
import type { FilmstripHeight } from '../../../../src/core/media/filmstripFrames'

vi.mock('electron', () => ({ app: undefined }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

/**
 * 真实 FFmpeg 取帧（任务 2.4）：`HENJI_FILMSTRIP_NATIVE=1 npx vitest run electron/main/services/video/filmstrip.native.test.ts`。
 * 用逐帧亮度编码帧号的长 GOP 片段核对“素材绝对时钟”上的取帧位置（含起点不为 0 的 MPEG-TS）；
 * 再加 `HENJI_FILMSTRIP_BENCH=1` 对专业格式矩阵样本（`node scripts/video-edit-format-samples.cjs` 生成）测首次生成吞吐与缓存命中耗时。
 */
const run = promisify(execFile)
const MATRIX = path.resolve('node_modules/.cache/format-matrix')

describe.skipIf(process.env.HENJI_FILMSTRIP_NATIVE !== '1')('real ffmpeg filmstrip frames', () => {
  let directory: string
  let binary: string
  beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-filmstrip-native-')); binary = await loadFfmpegPath() })
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }) })
  const service = (cache: string): ReturnType<typeof createFilmstripService> => createFilmstripService({ ffmpegPath: async () => binary, cache: createContentDiskCache({ directory: () => cache, extension: '.webp' }) })
  /** 取回缩略帧的平均亮度（0–255）与尺寸。 */
  async function measure(file: string): Promise<{ luma: number; width: number; height: number }> {
    const { stdout } = await run(binary, ['-v', 'error', '-i', file, '-vf', 'extractplanes=y', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 24 })
    const probe = await run(binary, ['-hide_banner', '-i', file], { encoding: 'utf8' }).catch((error: { stderr: string }) => ({ stderr: error.stderr }))
    const size = /, (\d+)x(\d+)/.exec(probe.stderr)!
    const bytes = stdout as Buffer
    return { luma: bytes.reduce((sum, value) => sum + value, 0) / bytes.length, width: Number(size[1]), height: Number(size[2]) }
  }

  it('takes the frame shown at each absolute source time from long-GOP H.264, including an MPEG-TS stream whose first picture is at 11.4s', async () => {
    // Frame n has luma 16 + 3n: a 60-frame GOP at 30fps where every picture is distinguishable.
    const mp4 = path.join(directory, 'gop.mp4'); const ts = path.join(directory, 'offset.ts')
    const source = ['-f', 'lavfi', '-i', 'color=black:s=320x180:r=30:d=2', '-vf', "geq=lum='16+3*N':cb=128:cr=128", '-c:v', 'libx264', '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p']
    await run(binary, ['-v', 'error', '-y', ...source, mp4])
    await run(binary, ['-v', 'error', '-y', ...source, '-output_ts_offset', '10', '-f', 'mpegts', ts])
    const frames = service(path.join(directory, 'cache-a'))
    // MPEG-TS adds the default 1.4s mux delay to the 10s offset: the first picture is at 11.4s on the absolute clock.
    for (const [file, offset] of [[mp4, 0], [ts, 11.4]] as const) {
      for (const frame of [0, 1, 29, 45, 59]) {
        const result = await measure(await frames.frame({ source: file, timeUs: Math.floor((offset + frame / 30) * 1_000_000), height: 48 }))
        expect(result.height).toBe(48)
        expect(result.width).toBe(84)
        expect(Math.abs(result.luma - (16 + 3 * frame)), `${path.basename(file)} 第 ${frame} 帧`).toBeLessThan(1)
      }
    }
    expect(frames.statistics().failed).toBe(0)
  }, 120_000)

  it.skipIf(process.env.HENJI_FILMSTRIP_BENCH !== '1' || !existsSync(MATRIX))('throughput and cache hits on the professional format matrix', async () => {
    const samples = ['h264-8-420-mp4.mp4', 'hevc-10-420-mkv.mkv', 'av1-8-420-mp4.mp4', 'prores-hq-mov.mov', 'prores-4444-alpha-mov.mov', 'dnxhr-hqx-mov.mov', 'cineform-422-mov.mov', 'mpeg2-420-m2ts-ac3.m2ts'].map(name => path.join(MATRIX, name)).filter(file => existsSync(file))
    const cache = path.join(directory, 'cache-bench')
    const height: FilmstripHeight = 64
    const rows: string[] = []
    for (const file of samples) {
      const frames = service(cache)
      // 12 tiles spread over the 3-second sample, as a filmstrip of one clip at a typical zoom.
      const times = Array.from({ length: 12 }, (_, index) => Math.round(index * 0.24 * 1_000_000) + (file.endsWith('.m2ts') ? 1_433_367 : 0))
      let started = performance.now()
      const settled = await Promise.allSettled(times.map(timeUs => frames.frame({ source: file, timeUs, height })))
      const failures = settled.flatMap((result, index) => result.status === 'rejected' ? [`${times[index]}: ${(result.reason as Error).message}`] : [])
      expect(failures, path.basename(file)).toEqual([])
      const cold = performance.now() - started
      const reopened = service(cache)
      started = performance.now()
      await Promise.all(times.map(timeUs => reopened.frame({ source: file, timeUs, height })))
      const hit = performance.now() - started
      const stats = frames.statistics()
      rows.push(`${path.basename(file)} | 12 帧首次 ${cold.toFixed(0)}ms（${(cold / 12).toFixed(0)}ms/帧，${stats.batches} 批）| 新会话命中 12 帧 ${hit.toFixed(1)}ms | 失败 ${stats.failed}`)
      expect(stats.failed).toBe(0)
      expect(reopened.statistics()).toMatchObject({ hits: 12, generated: 0 })
    }
    // eslint-disable-next-line no-console -- 基准命令需要把实测指标输出到任务记录。
    console.log(rows.join('\n'))
  }, 600_000)
})
