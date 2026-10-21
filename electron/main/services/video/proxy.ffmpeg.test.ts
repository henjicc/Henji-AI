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

/** ffprobe 逐帧读取：关键帧位置、帧类型、像素格式与色彩标记。 */
async function probeFrames(file: string, ffprobe: string): Promise<{ keyFrames: number[]; pictTypes: string; stream: Record<string, string | number> }> {
  const { execFile } = await import('node:child_process')
  const run = (args: string[]): Promise<string> => new Promise((resolve, reject) => execFile(ffprobe, args, { maxBuffer: 64 * 1024 * 1024 }, (error, out) => error ? reject(error) : resolve(String(out))))
  const frames = (JSON.parse(await run(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame,pict_type', '-of', 'json', file])) as { frames: Array<{ key_frame: number; pict_type: string }> }).frames
  const stream = (JSON.parse(await run(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,profile,has_b_frames,color_primaries,color_transfer,color_space,color_range', '-of', 'json', file])) as { streams: Array<Record<string, string | number>> }).streams[0]
  return { keyFrames: frames.flatMap((frame, index) => frame.key_frame ? [index] : []), pictTypes: frames.map(frame => frame.pict_type).join(''), stream }
}
async function encoderWorks(ffmpeg: string, encoder: string): Promise<boolean> {
  const signal = new AbortController().signal
  try { await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1', '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-'], signal, ffmpeg); return true } catch { return false }
}
it.each(['cpu', 'h264_nvenc'] as const)('%s：10 位 4:2:2 BT.709 原片转成 8 位 4:2:0 代理，半秒关键帧、无 B 帧、沿用色彩标记、逐帧时间戳一致', async encoder => {
  const binaries = { ffmpeg: await loadFfmpegPath(), ffprobe: await loadFfprobePath() }
  if (encoder !== 'cpu' && !await encoderWorks(binaries.ffmpeg, encoder)) return
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-proxy-params-')); directories.push(root)
  const source = path.join(root, 'source.mov'); const output = path.join(root, 'proxy.mp4'); const signal = new AbortController().signal
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=60:d=2', '-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,format=yuv422p10le',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '2', '-g', '120', '-output_ts_offset', '0.25', source], signal, binaries.ffmpeg)
  const result = await transcodeVideoProxy({ source, requestId: 'params', preset: 'auto' }, output, signal, () => undefined, binaries, { encoder, onFallback: error => { throw error } })
  expect(result).toEqual({ width: 960, height: 540 })
  assertVideoProxyAlignment(await videoProxyTimestamps(source, signal, binaries.ffprobe), await videoProxyTimestamps(output, signal, binaries.ffprobe))
  const probed = await probeFrames(output, binaries.ffprobe)
  expect(probed.keyFrames).toEqual([0, 30, 60, 90])
  expect(probed.pictTypes).not.toContain('B'); expect(probed.stream.has_b_frames).toBe(0)
  expect(probed.stream).toMatchObject({ pix_fmt: 'yuv420p', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv' })
}, 60000)
