import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { videoProxyRequestSchema, videoProxyResultSchema, videoProxySize, type VideoProxyRequest, type VideoProxyResult, type VideoProxyPreset } from '../../../../src/core/videoEdit/proxy'
import { identifyMediaContent } from '../media/content-identity'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { renderBitrateMbps } from '../../../../src/core/videoEdit/renderBitrate'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
import type { EncoderChoice } from './hwaccel'
import { MAX_HEAVY_MEDIA_TASKS, MEDIA_HEAVY_FFMPEG_INPUT_THREADS, MEDIA_HEAVY_FFMPEG_OUTPUT_THREADS, withMediaHeavyTask } from '../media-import/concurrency'

const MAX_FRAMES = 1_000_000
/*
 * 代理：源的一半（短边最高 1080），H.264 8 位 4:2:0，码率按代理自身分辨率与帧率查预渲染同一张表（VBR，
 * maxrate 1.5 倍、bufsize 2 倍）。关键帧间隔半秒（-g 为帧率的一半）、无 B 帧、闭合 GOP，拖动与倒放定位只需解码少量帧。
 * 时间戳逐帧保留（passthrough），停下切回原片时是同一帧。色彩标记沿用原片；HDR 原片只保留标记，不做色调映射。
 * 优先用显卡编码（FFmpeg 探测到的 NVENC p4+hq / Quick Sync medium / AMF balanced），失败时回退 libx264 veryfast。
 * 解码：NVENC 机器上原片用 CUDA 解码、在显存里 scale_cuda 缩放后直接送 NVENC（实测 4K60 10 位 HEVC 约 280 帧/秒，
 * 软解 2 线程约 45 帧/秒）；macOS 用 VideoToolbox 解码、自动下载到内存后照常缩放。D3D11VA 不用：随包 FFmpeg 9
 * 的自动下载实测报 “Failed to transfer data”。硬解失败或原片不在硬解范围内时软解，线程数按后台媒体 CPU 预算。
 * 参数变化时递增 VIDEO_PROXY_PARAMS_VERSION：它进入缓存键，旧代理随之失效。
 */
const VIDEO_PROXY_PARAMS_VERSION = 'h264-pts-v3'
export function videoProxyKey(identity: string, preset: VideoProxyPreset): string {
  return createHash('sha256').update(JSON.stringify([VIDEO_PROXY_PARAMS_VERSION, identity, preset])).digest('hex')
}
/** 原片的色彩标记（ffprobe 字段原值）；未标记的项省略，代理也不写。 */
interface VideoProxyColor { primaries?: string; transfer?: string; matrix?: string; range?: string }
/** cuda：解码与缩放都在显存，只能接 NVENC；videotoolbox：硬解后自动下载到内存，后续滤镜与软解相同。 */
export type VideoHardwareDecode = 'cuda' | 'videotoolbox'
/** 软解时的线程档：standard 占一个公共重型槽（解码 2、滤镜 1、编码 1）；reduced 不占槽，解码 1 线程。 */
export type VideoProxyThreads = 'standard' | 'reduced'
export interface VideoProxyPlan { width: number; height: number; fps: number; encoder: EncoderChoice; color?: VideoProxyColor; decode?: VideoHardwareDecode; threads?: VideoProxyThreads }

/** ffprobe 的画面流字段（原值）。 */
export interface VideoDecodeStream { codec_name?: string; pix_fmt?: string; color_range?: string; field_order?: string }
/*
 * 硬解只接 NVDEC 稳定支持、scale_cuda 能直接转成 8 位 4:2:0 的格式。H.264 只有 8 位 4:2:0；
 * 4:2:2、4:4:4、全范围（yuvj / pc：scale_cuda 不改范围而软解路径会改）与隔行素材拿不准，一律软解。
 * HDR 与 10 位 4:2:0 实测与软解的平均亮度、色度相差不到 1 级，色彩标记由 setparams 照写；旋转元数据两条路径都原样保留。
 * VideoToolbox 套用同一判断（Mac 真机未验证，按保守范围处理）。
 */
const HARDWARE_DECODE_FORMATS: Readonly<Record<string, readonly string[]>> = {
  h264: ['yuv420p', 'nv12'],
  hevc: ['yuv420p', 'nv12', 'yuv420p10le', 'p010le'],
  av1: ['yuv420p', 'nv12', 'yuv420p10le', 'p010le'],
  vp9: ['yuv420p', 'nv12', 'yuv420p10le', 'p010le'],
}
export function hardwareDecodeEligible(stream: VideoDecodeStream): boolean {
  const formats = HARDWARE_DECODE_FORMATS[stream.codec_name ?? '']
  const field = stream.field_order ?? 'unknown'
  return !!formats?.includes(stream.pix_fmt ?? '') && stream.color_range !== 'pc' && (field === 'progressive' || field === 'unknown')
}

let hardwareDecodeProbe: Promise<VideoHardwareDecode | null> | undefined
/**
 * 本机可用的硬解方式（每个进程探测一次）：Windows 实际初始化一次 CUDA 设备并跑通 scale_cuda；
 * macOS 查 FFmpeg 是否带 VideoToolbox。探测不到返回 null，调用方只用软解。
 * 探测超时（多半是启动时机器忙）不算结论：本次按不可用处理，下次请求重新探测。
 */
export function probeHardwareDecode(ffmpeg?: string, platform: NodeJS.Platform = process.platform): Promise<VideoHardwareDecode | null> {
  if (hardwareDecodeProbe) return hardwareDecodeProbe
  const method: VideoHardwareDecode | null = platform === 'win32' ? 'cuda' : platform === 'darwin' ? 'videotoolbox' : null
  if (!method) return hardwareDecodeProbe = Promise.resolve(null)
  const args = method === 'cuda'
    ? ['-hide_banner', '-v', 'error', '-init_hw_device', 'cuda=gpu', '-filter_hw_device', 'gpu', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.04',
      '-vf', 'hwupload,scale_cuda=w=128:h=128:format=nv12,hwdownload,format=nv12', '-frames:v', '1', '-f', 'null', '-']
    : ['-hide_banner', '-hwaccels']
  const retryLater = (): null => { if (hardwareDecodeProbe === probe) hardwareDecodeProbe = undefined; return null }
  const probe: Promise<VideoHardwareDecode | null> = (async () => {
    let binary: string
    try { binary = ffmpeg ?? await loadFfmpegPath() } catch { return retryLater() }
    return new Promise<VideoHardwareDecode | null>(resolve => {
      execFile(binary, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => {
        if (error?.killed) resolve(retryLater())
        else resolve(!error && (method === 'cuda' || /^\s*videotoolbox\s*$/m.test(String(stdout))) ? method : null)
      })
    })
  })()
  hardwareDecodeProbe = probe
  return probe
}

export { videoProxySize }

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
  const scale = plan.decode === 'cuda'
    ? `scale_cuda=w=${plan.width}:h=${plan.height}:interp_algo=bilinear:format=nv12`
    : `scale=${plan.width}:${plan.height}:flags=bilinear,format=yuv420p`
  return `${scale}${params.length ? `,setparams=${params.join(':')}` : ''}`
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
    cpu: ['-c:v', 'libx264', '-preset', 'veryfast'],
  }
  // 显存里的 nv12 帧直接交给 NVENC，写出就是 8 位 4:2:0；再指定 -pix_fmt 会要求下载到内存而无法建图。
  return [...encoder[plan.encoder], '-b:v', rate(1), '-maxrate', rate(1.5), '-bufsize', rate(2),
    '-g', String(Math.max(1, Math.round(plan.fps / 2))), '-bf', '0', '-flags', '+cgop', ...(plan.decode === 'cuda' ? [] : ['-pix_fmt', 'yuv420p'])]
}

/** 线程数：标准软解与后台媒体重型任务同一套；硬解与 reduced 档解码只给 1 线程（硬解时 CPU 只做搬运与送编码）。 */
export function videoProxyArguments(source: string, output: string, plan: VideoProxyPlan): string[] {
  const decode = plan.decode === 'cuda' ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : plan.decode === 'videotoolbox' ? ['-hwaccel', 'videotoolbox'] : []
  const threads = plan.decode || plan.threads === 'reduced' ? ['-filter_threads', '1', '-threads', '1'] : MEDIA_HEAVY_FFMPEG_INPUT_THREADS
  return ['-hide_banner', '-nostdin', '-nostats', '-y', '-copyts', '-noautorotate',
    ...threads, ...decode, '-i', source,
    '-map', '0:V:0', '-an', '-sn', '-dn', '-vf', videoProxyFilter(plan),
    ...videoProxyEncoderArguments(plan), ...MEDIA_HEAVY_FFMPEG_OUTPUT_THREADS,
    '-fps_mode', 'passthrough', '-enc_time_base', 'demux',
    '-avoid_negative_ts', 'disabled', '-movflags', '+faststart', '-progress', 'pipe:1', '-f', 'mp4', output]
}
/** Bounded CLI output. All decode/encode work runs in a hidden child process. */
async function run(executable: string, args: string[], signal: AbortSignal, line: (value: string) => void): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    // 代理是后台任务：低于正常优先级，播放、导出与界面先拿到 CPU。
    if (child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* 进程已结束或无权限 */ } }
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
/** 代理与原片逐帧时间不一致：原片时间戳本身有问题，换编码器重做也一样，不再回退。 */
export class VideoProxyAlignmentError extends Error {}
export function assertVideoProxyAlignment(source: readonly number[], proxy: readonly number[]): void {
  if (source.length !== proxy.length || source.some((time, index) => Math.abs(time - proxy[index]) > .000002)) throw new VideoProxyAlignmentError('代理帧数或时间戳与原片不一致，请继续使用原片。')
}

interface Lane { acquire(signal: AbortSignal, onWait?: () => void): Promise<void>; release(): void; state(): { running: number; queued: number } }
/** 先到先得的并发位置；排队可取消，空出的位置直接交给队首。 */
function createLane(size: number): Lane {
  let running = 0
  const waiting: Array<() => void> = []
  return {
    state: () => ({ running, queued: waiting.length }),
    async acquire(signal, onWait) {
      signal.throwIfAborted()
      if (running < size) { running++; return }
      onWait?.()
      await new Promise<void>((resolve, reject) => {
        const start = (): void => { signal.removeEventListener('abort', abort); resolve() }
        const abort = (): void => { const index = waiting.indexOf(start); if (index >= 0) waiting.splice(index, 1); reject(signal.reason) }
        waiting.push(start); signal.addEventListener('abort', abort, { once: true })
      })
    },
    release() { const next = waiting.shift(); if (next) next(); else running-- },
  }
}

/** 运行一次软解尝试，按 CPU 预算决定占槽与线程档；onWait 在需要排队时调用。 */
export type VideoProxySoftwareRunner = <T>(task: (threads: VideoProxyThreads) => Promise<T>, signal: AbortSignal, onWait?: () => void) => Promise<T>
/*
 * 软解代理的 CPU 预算。公共重型槽至少 2 个时占一个槽、按标准线程跑。只有 1 个槽（逻辑核 ≤15）时不占它：
 * 几分钟的软解代理会让缩略帧与导入缩略图一直排队、时间线空白；改为解码 1 线程、低优先级，同时只跑一段。
 */
export function createVideoProxySoftwareRunner(slots = MAX_HEAVY_MEDIA_TASKS, heavy: typeof withMediaHeavyTask = withMediaHeavyTask): VideoProxySoftwareRunner {
  const reduced = createLane(1)
  return async <T>(task: (threads: VideoProxyThreads) => Promise<T>, signal: AbortSignal, onWait?: () => void): Promise<T> => {
    if (slots < 2) {
      await reduced.acquire(signal, onWait)
      try { return await task('reduced') } finally { reduced.release() }
    }
    let started = false
    const running = heavy(() => { started = true; return task('standard') }, signal)
    // 公共队列不告诉调用方是否排队：拿到槽只隔几个微任务，到下一轮事件循环还没开始就是在等。
    const timer = setTimeout(() => { if (!started) onWait?.() }, 0)
    try { return await running } finally { clearTimeout(timer) }
  }
}
const softwareRunner = createVideoProxySoftwareRunner()

export interface VideoProxyEncoding {
  /** 优先尝试的编码器（FFmpeg 硬件编码探测结果）；它失败时回退 libx264。 */
  encoder: EncoderChoice
  /** 本机探测到的硬解方式；cuda 只在编码器是 NVENC 时使用（显存帧只能直接送 NVENC）。 */
  hardwareDecode?: VideoHardwareDecode | null
  /** decode：硬解失败改软解；encode：显卡编码失败改 libx264。 */
  onFallback?: (error: unknown, stage: 'decode' | 'encode') => void
  /** 软解尝试在等 CPU 预算。 */
  onQueued?: () => void
  software?: VideoProxySoftwareRunner
}
export interface VideoProxyTranscodeReport {
  width: number
  height: number
  /** 最终成功的那次是否硬解。 */
  hardwareDecode: boolean
  /** 最终成功的编码器；与请求的显卡编码器不同说明显卡编码确实不可用。 */
  encoder: EncoderChoice
  sourceWidth: number
  sourceHeight: number
  durationSeconds: number
  elapsedMs: number
}
/** 每次 FFmpeg 尝试开始时报一次进度 0：调用方据此把“排队中”切换为“生成中”。 */
export async function transcodeVideoProxy(request: VideoProxyRequest, output: string, signal: AbortSignal, progress: (value: number) => void, binaries?: { ffmpeg: string; ffprobe: string }, encoding: VideoProxyEncoding = { encoder: 'cpu' }): Promise<VideoProxyTranscodeReport> {
  const started = Date.now()
  // ffprobe 的 csv 按流内部字段顺序输出，不按请求顺序：用 json 按字段名读取。
  let probed = ''
  await run(binaries?.ffprobe ?? await loadFfprobePath(), ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'stream=codec_name,pix_fmt,field_order,width,height,avg_frame_rate,r_frame_rate,color_primaries,color_transfer,color_space,color_range', '-of', 'json', request.source], signal, line => { probed += line })
  const stream = (JSON.parse(probed || '{}') as { streams?: Array<VideoDecodeStream & { width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; color_primaries?: string; color_transfer?: string; color_space?: string }> }).streams?.[0] ?? {}
  const ratio = (value: string | undefined): number => { const [num, den] = (value ?? '').split('/').map(Number); return num > 0 && den > 0 ? num / den : 0 }
  const format = stream.pix_fmt ?? '', sourceWidth = stream.width ?? 0, sourceHeight = stream.height ?? 0
  const fps = ratio(stream.avg_frame_rate) || ratio(stream.r_frame_rate) || 30
  if (/^(yuva|gbrap|rgba|bgra|argb|abgr|ya)/.test(format)) throw new Error('此原片含透明通道，请使用原片看片以保留透明背景。')
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error('无法读取原片尺寸。')
  const times = await videoProxyTimestamps(request.source, signal, binaries?.ffprobe)
  const span = Math.max(.001, times.at(-1)! - times[0])
  const size = videoProxySize(sourceWidth, sourceHeight, request.preset)
  const eligible = hardwareDecodeEligible(stream)
  const decode = encoding.hardwareDecode === 'cuda'
    ? encoding.encoder === 'h264_nvenc' && eligible ? 'cuda' : undefined
    : encoding.hardwareDecode === 'videotoolbox' && eligible ? 'videotoolbox' : undefined
  // 时间戳核对放进每次尝试：硬解若丢帧或错位，回退软解重做一次。
  const execute = async (plan: VideoProxyPlan): Promise<void> => {
    progress(0)
    await run(binaries?.ffmpeg ?? await loadFfmpegPath(), videoProxyArguments(request.source, output, plan), signal, line => {
      if (!line.startsWith('out_time_us=')) return
      const seconds = Number(line.slice(12)) / 1e6
      if (Number.isFinite(seconds)) progress(Math.min(.95, Math.max(0, (seconds - times[0]) / span * .95)))
    })
    assertVideoProxyAlignment(times, await videoProxyTimestamps(output, signal, binaries?.ffprobe))
  }
  // 硬解几乎不占 CPU，直接跑；软解按后台 CPU 预算排队。
  const attempt = (plan: VideoProxyPlan): Promise<void> => plan.decode ? execute(plan)
    : (encoding.software ?? softwareRunner)(threads => execute({ ...plan, threads }), signal, encoding.onQueued)
  // 先去掉硬解，再去掉显卡编码；时间戳不一致与编码器无关，软解后仍不一致就直接报错。
  let plan: VideoProxyPlan = { ...size, fps, encoder: encoding.encoder, decode, color: { primaries: stream.color_primaries, transfer: stream.color_transfer, matrix: stream.color_space, range: stream.color_range } }
  for (;;) {
    try { await attempt(plan); break } catch (error) {
      if (signal.aborted) throw error
      if (plan.decode) { encoding.onFallback?.(error, 'decode'); plan = { ...plan, decode: undefined } }
      else if (plan.encoder !== 'cpu' && !(error instanceof VideoProxyAlignmentError)) { encoding.onFallback?.(error, 'encode'); plan = { ...plan, encoder: 'cpu' } }
      else throw error
    }
  }
  let width = 0; let height = 0
  await run(binaries?.ffprobe ?? await loadFfprobePath(), ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', output], signal, line => {
    const values = line.split(',').map(Number); width = values[0]; height = values[1]
  })
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('代理尺寸无效。')
  return { width, height, hardwareDecode: !!plan.decode, encoder: plan.encoder, sourceWidth, sourceHeight, durationSeconds: span, elapsedMs: Date.now() - started }
}

/*
 * 同时生成的代理段数：显卡编码会话有限（GeForce 驱动同时 8 路，导出与录屏也要用），取 2。
 * 硬解代理不占公共重型槽（每段约 1 个线程）；落到软解的那次尝试才按 CPU 预算占槽。超出的请求排队等待，可取消，不报错。
 */
export const VIDEO_PROXY_LANES = 2
type VideoProxyTranscode = (request: VideoProxyRequest, output: string, signal: AbortSignal, progress: (value: number) => void) => Promise<{ width: number; height: number } & Partial<VideoProxyTranscodeReport>>
export interface VideoProxyObserver {
  /** 等待代理并发位置时调用一次（立即开始的请求不调用）。 */
  queued?(): void
  transcoded?(report: Partial<VideoProxyTranscodeReport>): void
}
export class VideoProxyService {
  private readonly active = new Set<string>()
  private readonly lane: Lane
  constructor(private readonly cache: ContentDiskCache, private readonly metadata: ContentDiskCache, private readonly transcode: VideoProxyTranscode = transcodeVideoProxy, lanes = VIDEO_PROXY_LANES) { this.lane = createLane(lanes) }
  /** 当前正在生成与排队的段数。 */
  queueState(): { running: number; queued: number } { return this.lane.state() }
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
  async create(raw: VideoProxyRequest, signal: AbortSignal, progress: (value: number) => void, observer?: VideoProxyObserver): Promise<VideoProxyResult> {
    const request = videoProxyRequestSchema.parse(raw); signal.throwIfAborted()
    const existing = await this.lookup(request.source, request.preset)
    signal.throwIfAborted()
    if (existing) { progress(1); return existing }
    const content = await identifyMediaContent(request.source); const key = videoProxyKey(content.identity, request.preset)
    if (this.active.has(key)) throw new Error('同一素材的代理正在创建，请等待。')
    this.active.add(key)
    let temporary: string | undefined
    try {
      await this.lane.acquire(signal, () => observer?.queued?.())
      try {
        temporary = await this.cache.prepareTemporary(key)
        if (!temporary) throw new Error('程序缓存目录不可用。')
        const report = await this.transcode({ ...request, source: content.path }, temporary, signal, progress)
        observer?.transcoded?.(report)
        signal.throwIfAborted()
        if ((await identifyMediaContent(content.path)).identity !== content.identity) throw new Error('创建期间原片已改变，请重新创建代理。')
        const path = await this.cache.adopt(key, temporary)
        const result = videoProxyResultSchema.parse({ width: report.width, height: report.height, path, key, contentIdentity: content.identity, preset: request.preset, bytes: (await fs.stat(path)).size })
        await this.metadata.write(key, Buffer.from(JSON.stringify(result)))
        signal.throwIfAborted(); progress(1); return result
      } finally { this.lane.release() }
    } finally { this.active.delete(key); if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
}
