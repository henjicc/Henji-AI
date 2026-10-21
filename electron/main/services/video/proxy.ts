import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { videoProxyRequestSchema, videoProxyResultSchema, type VideoProxyRequest, type VideoProxyResult, type VideoProxyPreset } from '../../../../src/core/videoEdit/proxy'
import { identifyMediaContent } from '../media/content-identity'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { renderBitrateMbps } from '../../../../src/core/videoEdit/renderBitrate'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
import type { EncoderChoice } from './hwaccel'

const MAX_FRAMES = 1_000_000
/*
 * 代理：源的一半（短边最高 1080），H.264 8 位 4:2:0，码率按代理自身分辨率与帧率查预渲染同一张表（VBR，
 * maxrate 1.5 倍、bufsize 2 倍）。关键帧间隔半秒（-g 为帧率的一半）、无 B 帧、闭合 GOP，拖动与倒放定位只需解码少量帧。
 * 时间戳逐帧保留（passthrough），停下切回原片时是同一帧。色彩标记沿用原片；HDR 原片只保留标记，不做色调映射。
 * 优先用显卡编码（FFmpeg 探测到的 NVENC p4+hq / Quick Sync medium / AMF balanced），失败时回退 libx264 veryfast。
 * 原片用 4 线程软解：随包 FFmpeg 9 的 D3D11VA 自动下载在实测中报 “Failed to transfer data”，
 * 而 4 线程软解 + NVENC 已约 1 倍速处理 4K60，后台任务也不占满处理器。
 * 参数变化时递增 VIDEO_PROXY_PARAMS_VERSION：它进入缓存键，旧代理随之失效。
 */
export const VIDEO_PROXY_PARAMS_VERSION = 'h264-pts-v3'
export function videoProxyKey(identity: string, preset: VideoProxyPreset): string {
  return createHash('sha256').update(JSON.stringify([VIDEO_PROXY_PARAMS_VERSION, identity, preset])).digest('hex')
}
/** 原片的色彩标记（ffprobe 字段原值）；未标记的项省略，代理也不写。 */
export interface VideoProxyColor { primaries?: string; transfer?: string; matrix?: string; range?: string }
export interface VideoProxyPlan { width: number; height: number; fps: number; encoder: EncoderChoice; color?: VideoProxyColor }

/** 代理尺寸：auto 为源的一半、短边最高 1080；旧预设 720p/540p 按高度上限。宽高取偶数。 */
export function videoProxySize(sourceWidth: number, sourceHeight: number, preset: VideoProxyPreset): { width: number; height: number } {
  const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)
  const scale = preset === 'auto'
    ? Math.min(0.5, 1080 / Math.min(sourceWidth, sourceHeight))
    : Math.min(1, (preset === '720p' ? 720 : 540) / sourceHeight)
  return { width: even(sourceWidth * scale), height: even(sourceHeight * scale) }
}

const KNOWN_COLOR = /^[a-z0-9_-]{1,32}$/
/**
 * 滤镜：缩放、转 8 位 4:2:0，并把原片色彩标记写回帧属性。随包 FFmpeg 9 的输出级 -color_primaries 等选项
 * 会被帧属性覆盖而不进码流（实测只剩 matrix 与 range），所以用 setparams 在帧上设置。
 */
export function videoProxyFilter(plan: VideoProxyPlan): string {
  const color = plan.color ?? {}
  const known = (value: string | undefined): value is string => !!value && value !== 'unknown' && value !== 'unspecified' && KNOWN_COLOR.test(value)
  const params = [['color_primaries', color.primaries], ['color_trc', color.transfer], ['colorspace', color.matrix], ['range', color.range]]
    .flatMap(([name, value]) => known(value) ? [`${name}=${value}`] : [])
  return `scale=${plan.width}:${plan.height}:flags=bilinear,format=yuv420p${params.length ? `,setparams=${params.join(':')}` : ''}`
}
/** 编码参数（纯函数）：编码器档位、码率控制、GOP、B 帧与像素格式。 */
export function videoProxyEncoderArguments(plan: VideoProxyPlan): string[] {
  const bitrate = renderBitrateMbps({ width: plan.width, height: plan.height, fps: plan.fps, codec: 'avc', quality: 'standard' })
  const rate = (factor: number): string => `${Math.round(bitrate * factor * 1000)}k`
  const encoder: Record<EncoderChoice, string[]> = {
    h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr'],
    h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'medium'],
    h264_amf: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'vbr_peak'],
    h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-allow_sw', '0'],
    cpu: ['-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2'],
  }
  return [...encoder[plan.encoder], '-b:v', rate(1), '-maxrate', rate(1.5), '-bufsize', rate(2),
    '-g', String(Math.max(1, Math.round(plan.fps / 2))), '-bf', '0', '-flags', '+cgop', '-pix_fmt', 'yuv420p']
}

export function videoProxyArguments(source: string, output: string, plan: VideoProxyPlan): string[] {
  return ['-hide_banner', '-nostdin', '-nostats', '-y', '-copyts', '-noautorotate',
    '-threads', '4', '-i', source,
    '-map', '0:V:0', '-an', '-sn', '-dn', '-vf', videoProxyFilter(plan),
    ...videoProxyEncoderArguments(plan),
    '-filter_threads', '2', '-fps_mode', 'passthrough', '-enc_time_base', 'demux',
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
export interface VideoProxyEncoding {
  /** 优先尝试的编码器（FFmpeg 硬件编码探测结果）；它失败时回退 libx264。 */
  encoder: EncoderChoice
  onFallback?: (error: unknown) => void
}
export async function transcodeVideoProxy(request: VideoProxyRequest, output: string, signal: AbortSignal, progress: (value: number) => void, binaries?: { ffmpeg: string; ffprobe: string }, encoding: VideoProxyEncoding = { encoder: 'cpu' }): Promise<{ width: number; height: number }> {
  // ffprobe 的 csv 按流内部字段顺序输出，不按请求顺序：用 json 按字段名读取。
  let probed = ''
  await run(binaries?.ffprobe ?? await loadFfprobePath(), ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'stream=pix_fmt,width,height,avg_frame_rate,r_frame_rate,color_primaries,color_transfer,color_space,color_range', '-of', 'json', request.source], signal, line => { probed += line })
  const stream = (JSON.parse(probed || '{}') as { streams?: Array<{ pix_fmt?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; color_primaries?: string; color_transfer?: string; color_space?: string; color_range?: string }> }).streams?.[0] ?? {}
  const ratio = (value: string | undefined): number => { const [num, den] = (value ?? '').split('/').map(Number); return num > 0 && den > 0 ? num / den : 0 }
  const format = stream.pix_fmt ?? '', sourceWidth = stream.width ?? 0, sourceHeight = stream.height ?? 0
  const fps = ratio(stream.avg_frame_rate) || ratio(stream.r_frame_rate) || 30
  if (/^(yuva|gbrap|rgba|bgra|argb|abgr|ya)/.test(format)) throw new Error('此原片含透明通道，请使用原片看片以保留透明背景。')
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error('无法读取原片尺寸。')
  const times = await videoProxyTimestamps(request.source, signal, binaries?.ffprobe)
  const span = Math.max(.001, times.at(-1)! - times[0])
  const size = videoProxySize(sourceWidth, sourceHeight, request.preset)
  const attempt = async (plan: VideoProxyPlan): Promise<void> => run(binaries?.ffmpeg ?? await loadFfmpegPath(), videoProxyArguments(request.source, output, plan), signal, line => {
    if (!line.startsWith('out_time_us=')) return
    const seconds = Number(line.slice(12)) / 1e6
    if (Number.isFinite(seconds)) progress(Math.min(.95, Math.max(0, (seconds - times[0]) / span * .95)))
  })
  const plan: VideoProxyPlan = { ...size, fps, encoder: encoding.encoder, color: { primaries: stream.color_primaries, transfer: stream.color_transfer, matrix: stream.color_space, range: stream.color_range } }
  try { await attempt(plan) } catch (error) {
    if (signal.aborted || plan.encoder === 'cpu') throw error
    encoding.onFallback?.(error)
    await attempt({ ...plan, encoder: 'cpu' })
  }
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
