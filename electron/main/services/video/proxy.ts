import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { videoProxyRequestSchema, videoProxyResultSchema, type VideoProxyRequest, type VideoProxyResult, type VideoProxyPreset } from '../../../../src/core/videoEdit/proxy'
import { identifyMediaContent } from '../media/content-identity'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'

const MAX_FRAMES = 1_000_000
export function videoProxyKey(identity: string, preset: VideoProxyPreset): string {
  return createHash('sha256').update(JSON.stringify(['h264-intra-pts-v1', identity, preset])).digest('hex')
}
export function videoProxyArguments(source: string, output: string, preset: VideoProxyPreset): string[] {
  const height = preset === '720p' ? 720 : 540
  return ['-hide_banner', '-nostdin', '-nostats', '-y', '-copyts', '-noautorotate', '-threads', '2', '-i', source,
    '-map', '0:V:0', '-an', '-sn', '-dn', '-vf', `scale=w=-2:h='trunc(min(${height},ih)/2)*2':flags=fast_bilinear`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-g', '1', '-bf', '0', '-pix_fmt', 'yuv420p',
    '-threads', '2', '-filter_threads', '2', '-fps_mode', 'passthrough', '-enc_time_base', 'demux',
    '-avoid_negative_ts', 'disabled', '-movflags', '+faststart', '-progress', 'pipe:1', '-f', 'mp4', output]
}
/** Bounded CLI output. All decode/encode work runs in a hidden child process. */
async function run(executable: string, args: string[], signal: AbortSignal, line: (value: string) => void): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let pending = ''; let tail = ''; let failed: unknown
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    child.stderr.on('data', chunk => { tail = (tail + String(chunk)).slice(-4096) })
    child.stdout.on('data', chunk => {
      pending += String(chunk)
      const lines = pending.split(/\r?\n/); pending = lines.pop()!
      try { if (pending.length > 65536) throw new Error('代理媒体信息过长。'); for (const value of lines) line(value) }
      catch (error) { failed = error; child.kill() }
    })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('代理创建已取消。'))
      else if (failed) reject(failed)
      else if (code !== 0) reject(new Error('代理转码或媒体检查失败，请确认原片可读取后重试。', { cause: tail }))
      else { try { if (pending) line(pending); resolve() } catch (error) { reject(error) } }
    })
  })
}
export async function videoProxyTimestamps(source: string, signal: AbortSignal, binary?: string): Promise<number[]> {
  const values: number[] = []
  await run(binary ?? await loadFfprobePath(), ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', source], signal, line => {
    const seconds = Number(line.split(',')[0])
    if (!line || !Number.isFinite(seconds) || values.length >= MAX_FRAMES) throw new Error('视频时间戳无效或视频超过代理帧数上限。')
    values.push(seconds)
  })
  if (!values.length) throw new Error('原文件没有视频帧。')
  return values.sort((a, b) => a - b)
}
export function assertVideoProxyAlignment(source: readonly number[], proxy: readonly number[]): void {
  if (source.length !== proxy.length || source.some((time, index) => Math.abs(time - proxy[index]) > .000002)) throw new Error('代理帧数或时间戳与原片不一致，请继续使用原片。')
}
export async function transcodeVideoProxy(request: VideoProxyRequest, output: string, signal: AbortSignal, progress: (value: number) => void, binaries?: { ffmpeg: string; ffprobe: string }): Promise<{ width: number; height: number }> {
  let format = ''
  await run(binaries?.ffprobe ?? await loadFfprobePath(), ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', request.source], signal, line => { if (!format) format = line.split(',')[0] })
  if (/^(yuva|gbrap|rgba|bgra|argb|abgr|ya)/.test(format)) throw new Error('此原片含透明通道，请使用原片看片以保留透明背景。')
  const times = await videoProxyTimestamps(request.source, signal, binaries?.ffprobe)
  const span = Math.max(.001, times.at(-1)! - times[0])
  await run(binaries?.ffmpeg ?? await loadFfmpegPath(), videoProxyArguments(request.source, output, request.preset), signal, line => {
    if (!line.startsWith('out_time_us=')) return
    const seconds = Number(line.slice(12)) / 1e6
    if (Number.isFinite(seconds)) progress(Math.min(.95, Math.max(0, (seconds - times[0]) / span * .95)))
  })
  assertVideoProxyAlignment(times, await videoProxyTimestamps(output, signal, binaries?.ffprobe))
  let width = 0; let height = 0
  await run(binaries?.ffprobe ?? await loadFfprobePath(), ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', output], signal, line => {
    const values = line.split(',').map(Number); width = values[0]; height = values[1]
  })
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('代理尺寸无效。')
  return { width, height }
}

export class VideoProxyService {
  private readonly active = new Set<string>()
  constructor(private readonly cache: ContentDiskCache, private readonly metadata: ContentDiskCache, private readonly transcode = transcodeVideoProxy) {}
  async lookup(source: string, preset: VideoProxyPreset): Promise<VideoProxyResult | null> {
    const content = await identifyMediaContent(source)
    const key = videoProxyKey(content.identity, preset)
    const file = await this.cache.locate(key); const bytes = await this.metadata.read(key)
    if (!file || !bytes) return null
    try {
      const result = videoProxyResultSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
      if (result.key !== key || result.contentIdentity !== content.identity || result.preset !== preset || result.bytes !== (await fs.stat(file)).size) throw new Error('代理缓存无效。')
      return { ...result, path: file }
    } catch { await this.metadata.remove(key); await this.cache.remove(key); return null }
  }
  async create(raw: VideoProxyRequest, signal: AbortSignal, progress: (value: number) => void): Promise<VideoProxyResult> {
    const request = videoProxyRequestSchema.parse(raw); signal.throwIfAborted()
    const existing = await this.lookup(request.source, request.preset)
    signal.throwIfAborted()
    if (existing) { progress(1); return existing }
    const content = await identifyMediaContent(request.source); const key = videoProxyKey(content.identity, request.preset)
    if (this.active.has(key)) throw new Error('同一素材的代理正在创建，请等待。')
    if (this.active.size >= 2) throw new Error('已有两段素材正在创建代理，请等待或取消。')
    this.active.add(key)
    let temporary: string | undefined
    try {
      temporary = await this.cache.prepareTemporary(key)
      if (!temporary) throw new Error('程序缓存目录不可用。')
      const dimensions = await this.transcode({ ...request, source: content.path }, temporary, signal, progress)
      signal.throwIfAborted()
      if ((await identifyMediaContent(content.path)).identity !== content.identity) throw new Error('创建期间原片已改变，请重新创建代理。')
      const path = await this.cache.adopt(key, temporary)
      const result = videoProxyResultSchema.parse({ ...dimensions, path, key, contentIdentity: content.identity, preset: request.preset, bytes: (await fs.stat(path)).size })
      await this.metadata.write(key, Buffer.from(JSON.stringify(result)))
      signal.throwIfAborted(); progress(1); return result
    } finally { this.active.delete(key); if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
}
