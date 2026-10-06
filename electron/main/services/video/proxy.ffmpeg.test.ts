import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
import { runLoudnessFfmpeg } from '../audio/loudness'
import { assertVideoProxyAlignment, transcodeVideoProxy, videoProxyTimestamps } from './proxy'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
it.each(['随包', '6.1'].flatMap(label => ['30', '30000/1001', 'vfr'].map(rate => ({ label, rate }))))('$label / $rate：真实FFmpeg代理保留所有原片时间戳与非零起点，缩到540p', async ({ label, rate }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-proxy-ffmpeg-')); directories.push(root)
  const source = path.join(root, 'source.mkv'); const output = path.join(root, 'proxy.mp4')
  const statics = await import('ffmpeg-ffprobe-static')
  const binaries = label === '随包' ? { ffmpeg: await loadFfmpegPath(), ffprobe: await loadFfprobePath() } : { ffmpeg: statics.ffmpegPath!, ffprobe: statics.ffprobePath! }
  const signal = new AbortController().signal
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=${rate === 'vfr' ? '30' : rate}:d=0.6`, ...(rate === 'vfr' ? ['-vf', "select='not(eq(mod(n,3),1))'"] : []), '-fps_mode', 'passthrough', '-output_ts_offset', '0.523', '-c:v', 'ffv1', '-threads', '2', source], signal, binaries.ffmpeg)
  const progress: number[] = []
  const result = await transcodeVideoProxy({ source, requestId: 'test', preset: '540p' }, output, signal, value => progress.push(value), binaries)
  const original = await videoProxyTimestamps(source, signal, binaries.ffprobe); const proxy = await videoProxyTimestamps(output, signal, binaries.ffprobe)
  expect(original[0]).toBeGreaterThan(.5); expect(proxy).toHaveLength(original.length)
  assertVideoProxyAlignment(original, proxy)
  expect(result).toEqual({ width: 960, height: 540 }); expect(progress.length).toBeGreaterThan(0)
}, 30000)
