import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeLocalSource } from '../image/source'
import { resolveLocalMediaPath } from '../media/shared'
import { MEDIA_BACKGROUND_THREADS, withMediaHeavyTask } from '../media-import/concurrency'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { AudioWaveformQueue } from './queue'
import { audioMemoryBudgetBytes } from './cache-budget'
import { AudioWaveformWorker } from './worker-client'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { identifyMediaContent, type MediaContentIdentity } from '../media/content-identity'
import {
  WAVEFORM_DETAIL_MAX_FRAMES, WAVEFORM_PYRAMID_BASE_SAMPLES_PER_BUCKET, WAVEFORM_PYRAMID_FORMAT_VERSION, WAVEFORM_PYRAMID_LEVEL_FACTOR, WAVEFORM_PYRAMID_TOP_BUCKETS,
  aggregateWaveformLevel, audioWaveformSampleIndex, decodeWaveformPyramid, decodeWaveformPyramidFloats, encodeWaveformPyramid, encodeWaveformPyramidFloats, selectWaveformLevel,
  waveformPyramidByteSize, waveformPyramidFloatsByteSize, waveformPyramidPeakMax,
  type WaveformPyramidData, type WaveformPyramidFloats,
} from '../../../../src/core/media/waveformPyramid'
import { openF32Wav } from '../audio-edit/pcm-wav'
import { audioLineageTracked, findAudioLineageAncestor, type AudioLineageRange } from './lineage'
import { deriveWaveformPyramid } from './waveform-worker'
import type { AudioWaveformChannel, AudioWaveformPyramidOptions, AudioWaveformPyramidOutput, AudioWaveformPyramidRequest, AudioWaveformPyramidResult, AudioWaveformRangeRequest, AudioWaveformRangeResult, AudioWaveformWorkerOptions, ExtractAudioSamplesResultDto } from './types'

export { audioWaveformSampleIndex }

const logger = createMainLogger('main.audio.waveform')
const MICROSECONDS = 1_000_000
const MAX_RANGE_US = 30 * 60 * MICROSECONDS
/** Absolute range requests may overrun the probed end by printing/rounding differences between probes; the tail decodes as silence. */
const END_TOLERANCE_US = 1000
/** Streams with at most this many channels decode once natively and serve every channel selection from one file. */
const NATIVE_PYRAMID_CHANNELS = 2
/** 解码长时间没有吐出数据才算卡住；与素材总长度无关，长素材只要持续有进展就不会超时。 */
const DECODE_IDLE_TIMEOUT_MS = 60_000
const MIB = 1024 * 1024
/** 探测结果只有几百字节，按内容身份记住，精细回读不必每次重新起 ffprobe。 */
const PROBE_CACHE_ENTRIES = 1024
interface AudioMetadata {
  sampleRate: number
  channels: number
  /** Decoded span (container end minus start). */
  durationSeconds: number
  /** Container start on the absolute source clock; maps absolute seeks onto FFmpeg's `-ss`. */
  startSeconds: number
  /** Absolute media end, the same measure as the imported media duration. */
  endSeconds: number
}
type SourceIdentity = MediaContentIdentity
interface AggregationWorker {
  start(options: AudioWaveformWorkerOptions): Promise<void>
  push(bytes: Uint8Array): Promise<void>
  finish(): Promise<AudioWaveformChannel[]>
  finishPyramid?(): Promise<AudioWaveformPyramidOutput>
  dispose(): Promise<void>
}
export interface AudioWaveformServiceDependencies {
  ffmpegPath?: () => Promise<string>
  ffprobePath?: () => Promise<string>
  resolvePath?: (source: string, signal?: AbortSignal) => Promise<string>
  identity?: (source: string) => Promise<SourceIdentity>
  createWorker?: () => AggregationWorker
  /** 文件来历（编辑后声音与上一版差在哪些帧）；默认读 lineage.ts 的记录。 */
  lineage?: {
    tracked(file: string): Promise<boolean>
    ancestor<T>(file: string, accept: (ancestor: string) => Promise<T | undefined>): Promise<{ ancestor: string; value: T; dirty: AudioLineageRange[]; hops: number } | undefined>
  }
  cacheBudgetBytes?: number
  /** 波形任务同时运行的数量；默认按逻辑核数取。 */
  queueConcurrency?: number
  /** Disk cache of whole-source pyramids; `null` disables it. Default: userData/HenjiCache/Waveforms. */
  diskCache?: ContentDiskCache | null
  pyramidMemoryBytes?: number
}

/** Which channels of which sound stream: the same selection the range request uses. */
interface ChannelSelection { channels: 1 | 2; audioStream: number; audioChannel?: number }
type FileLayout = 'native' | 'mix1' | 'mix2' | `ch${number}`
interface PyramidJobResult { readonly shared: true; data: WaveformPyramidData; layout: FileLayout }
/** 按块派生的结果与重算规模（日志据此核对增量是否生效）。 */
interface DerivedPyramid { data: WaveformPyramidData; floats: WaveformPyramidFloats; recomputedFrames: number; hops: number }
/** 命中内存或磁盘缓存时的分段耗时（毫秒）与字节数，供 cache_hit 日志区分读盘、解码与拷贝。 */
interface PyramidCacheHit { from: 'memory' | 'disk'; bytes: number; readMs: number; decodeMs: number; lookupMs: number }
interface LoadedPyramid { data: WaveformPyramidData; channels: number[]; version: string; hit?: PyramidCacheHit }


const isRemote = (source: string): boolean => source.startsWith('http://') || source.startsWith('https://')
const digest = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const selectionLayout = (selection: ChannelSelection): Exclude<FileLayout, 'native'> => selection.audioChannel !== undefined ? `ch${selection.audioChannel}` : selection.channels === 2 ? 'mix2' : 'mix1'

function validateSourceFields(request: { source: unknown; sourceRevision?: unknown; channels: unknown; audioStream?: unknown; audioChannel?: unknown }, allowRemote: boolean): void {
  if (typeof request.source !== 'string' || !request.source.trim() || request.source.length > 8192 || request.source.includes('\0')) throw new Error('无效的音频素材路径。')
  if (!(allowRemote && isRemote(request.source)) && !path.isAbsolute(normalizeLocalSource(request.source))) throw new Error(allowRemote ? '波形只允许本地素材或网络音频。' : '范围波形只允许已导入的本地素材。')
  if (request.sourceRevision !== undefined && (typeof request.sourceRevision !== 'string' || !request.sourceRevision.length || request.sourceRevision.length > 256)) throw new Error('无效的音频素材修订。')
  if (request.channels !== 1 && request.channels !== 2) throw new Error('无效的波形采样规格。')
  if (request.audioStream !== undefined && (!Number.isInteger(request.audioStream) || (request.audioStream as number) < 0 || (request.audioStream as number) > 63)) throw new Error('无效的声音流序号。')
  if (request.audioChannel !== undefined && (!Number.isInteger(request.audioChannel) || (request.audioChannel as number) < 0 || (request.audioChannel as number) > 63 || request.channels !== 1)) throw new Error('无效的单声道波形声道。')
}
export function validateAudioWaveformRange(request: AudioWaveformRangeRequest): void {
  if (typeof request.source !== 'string' || !request.source.trim() || request.source.length > 8192 || request.source.includes('\0')) throw new Error('无效的音频素材路径。')
  if (!path.isAbsolute(normalizeLocalSource(request.source))) throw new Error('范围波形只允许已导入的本地素材。')
  if (!Number.isSafeInteger(request.startUs) || !Number.isSafeInteger(request.endUs) || request.startUs < 0 || request.endUs <= request.startUs || request.endUs - request.startUs > MAX_RANGE_US) throw new Error('波形范围必须为非负整数微秒，且不超过30分钟。')
  if (!Number.isInteger(request.bucketCount) || request.bucketCount < 16 || request.bucketCount > 4096) throw new Error('无效的波形采样规格。')
  if (request.samples !== undefined && typeof request.samples !== 'boolean') throw new Error('无效的精细波形请求。')
  validateSourceFields(request, false)
}
export function validateAudioWaveformPyramid(request: AudioWaveformPyramidRequest): void {
  validateSourceFields(request, true)
  if (request.maxBuckets !== undefined && (!Number.isSafeInteger(request.maxBuckets) || request.maxBuckets < 1)) throw new Error('无效的波形精度上限。')
  if (request.ifNoneMatch !== undefined && (typeof request.ifNoneMatch !== 'string' || !request.ifNoneMatch.length || request.ifNoneMatch.length > 128)) throw new Error('无效的波形版本。')
}

/** 无进展超时：每次有数据就续期，静默超过时限才按超时中止。 */
function idleTimeout(controller: AbortController, message: string): { refresh(): void; clear(): void } {
  const timer = setTimeout(() => controller.abort(new DOMException(message, 'TimeoutError')), DECODE_IDLE_TIMEOUT_MS)
  timer.unref()
  return { refresh: () => { timer.refresh() }, clear: () => { clearTimeout(timer) } }
}

/** Close, rather than error/exit, is the subprocess and stdio ownership barrier. */
async function runProcess(binary: string, args: string[], signal: AbortSignal, onChunk?: (chunk: Uint8Array) => Promise<void>): Promise<string> {
  signal.throwIfAborted()
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let failure: unknown
  let errors = ''
  let output = ''
  let closed = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const kill = (): void => {
    if (closed) return
    child.kill()
    if (!killTimer) { killTimer = setTimeout(() => { child.kill('SIGKILL') }, 2000); killTimer.unref() }
  }
  signal.addEventListener('abort', kill, { once: true })
  const close = new Promise<void>((resolve, reject) => {
    child.on('error', error => { failure ??= error })
    child.once('close', code => {
      closed = true
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', kill)
      if (signal.aborted) reject(signal.reason)
      else if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`音频处理失败：${errors || `退出码 ${code}`}`))
      else resolve()
    })
  })
  void close.catch(() => undefined)
  child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString('utf8')).slice(-16_384) })
  child.stderr.on('error', error => { failure ??= error; kill() })
  try {
    for await (const raw of child.stdout) {
      signal.throwIfAborted()
      const chunk = raw as Buffer
      if (onChunk) {
        for (let offset = 0; offset < chunk.length; offset += 1024 * 1024) {
          signal.throwIfAborted()
          await onChunk(chunk.subarray(offset, offset + 1024 * 1024))
        }
      } else {
        output += chunk.toString('utf8')
        if (output.length > 1024 * 1024) throw new Error('音频元数据超过资源上限。')
      }
    }
  } catch (error) { failure ??= error; kill() }
  await close
  // A final Worker reply can arrive after child close. It must still reject the job.
  if (failure) throw failure
  signal.throwIfAborted()
  return output
}

interface ProbedStream { codec_type?: string; sample_rate?: string; channels?: number; start_time?: string; duration?: string; disposition?: { attached_pic?: number } }
const finiteSeconds = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}
/**
 * Absolute end of the latest picture or sound stream (start + duration), the import probe's duration
 * (`videoEditFieldsFromNativeProbe`, mediabunny `computeDuration()`): a timeline starting after zero
 * (MPEG program streams) keeps its tail and timecode/data tracks do not count. The container span is
 * only a fallback when no stream reports a duration.
 */
export function audioWaveformAbsoluteEndSeconds(streams: readonly ProbedStream[], format: { start_time?: string; duration?: string } | undefined): number {
  const end = (start: string | undefined, duration: string | undefined): number[] => {
    const span = finiteSeconds(duration)
    if (span === undefined || span < 0) return []
    const offset = finiteSeconds(start)
    return [span + (offset !== undefined && offset > 0 ? offset : 0)]
  }
  const streamEnds = streams.filter(stream => (stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1) || stream.codec_type === 'audio').flatMap(stream => end(stream.start_time, stream.duration))
  return Math.max(0, ...(streamEnds.length ? streamEnds : end(format?.start_time, format?.duration)))
}

/** `audioStream` is the n-th sound stream in file order (the number the edit decoders open it by). */
async function probeAudio(binary: string, source: string, signal: AbortSignal, audioStream = 0): Promise<AudioMetadata> {
  const text = await runProcess(binary, ['-v', 'error', '-show_entries', 'format=duration,start_time:stream=index,codec_type,sample_rate,channels,start_time,duration:stream_disposition=attached_pic', '-of', 'json', source], signal)
  const raw = JSON.parse(text) as { format?: { duration?: string; start_time?: string }; streams?: ProbedStream[] }
  const stream = raw.streams?.filter(item => item.codec_type === 'audio')[audioStream]
  if (!stream && audioStream > 0) throw new Error(`素材没有第 ${audioStream + 1} 条声音流。`)
  const sampleRate = Number(stream?.sample_rate)
  const channels = stream?.channels ?? 0
  const durationSeconds = Number(raw.format?.duration ?? stream?.duration)
  const endSeconds = audioWaveformAbsoluteEndSeconds(raw.streams ?? [], raw.format)
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000 || !Number.isInteger(channels) || channels < 1 || channels > 64 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || endSeconds <= 0) throw new Error('音频采样率或时长不可用。')
  return { sampleRate, channels, durationSeconds, startSeconds: finiteSeconds(raw.format?.start_time) ?? 0, endSeconds }
}

/**
 * FFmpeg arguments for the absolute-clock span [startUs, endUs): keep container timestamps (-copyts without
 * -start_at_zero); FFmpeg's input -ss is relative to the container start, so the absolute seek is shifted by it
 * (clamped at the start). first_pts trims preroll and inserts source-clock silence before a later audio start
 * (delayed streams, MPEG-PS starting after zero), without reducing sample rate.
 */
function decodeArgs(source: string, metadata: AudioMetadata, options: { audioStream: number; audioChannel?: number; channelCount: number; startUs: number; endUs: number; first: number; expectedFrames: number }): string[] {
  const { sampleRate } = metadata
  const pick = options.audioChannel !== undefined ? `pan=mono|c0=c${options.audioChannel},` : ''
  const seekUs = Math.max(0, options.startUs - 100_000)
  const seekArgUs = Math.max(0, seekUs - Math.round(metadata.startSeconds * MICROSECONDS))
  // 每个波形任务按 2 线程计：FFmpeg 解码与滤镜各限 1 线程，另有一个聚合 Worker 线程。
  return ['-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-copyts', '-ss', String(seekArgUs / MICROSECONDS), '-t', String((options.endUs - seekUs) / MICROSECONDS + 2 / sampleRate), '-i', source, '-map', `0:a:${options.audioStream}`, '-vn', '-sn', '-dn', '-af', `${pick}aresample=${sampleRate}:async=1:first_pts=${options.first},atrim=end_sample=${options.expectedFrames},asetpts=PTS-STARTPTS`, '-ar', String(sampleRate), '-ac', String(options.channelCount), '-f', 'f32le', 'pipe:1']
}

/** Channels of a pyramid file that answer a selection; a native file (≤2 channels) answers every selection. */
function selectPyramidChannels(data: WaveformPyramidData, layout: FileLayout, selection: ChannelSelection): number[] {
  if (layout !== 'native') return Array.from({ length: data.channelCount }, (_, channel) => channel)
  const native = data.nativeChannels
  if (selection.audioChannel !== undefined) {
    if (selection.audioChannel >= native) throw new Error(`声音流只有 ${native} 个声道。`)
    return [selection.audioChannel]
  }
  if (native === 1) return [0]
  return selection.channels === 2 ? [0, 1] : [data.mixChannel ? native : 0]
}

export function createAudioWaveformService(dependencies: AudioWaveformServiceDependencies = {}): {
  extractSamples(source: string, bucketCount: number, signal?: AbortSignal): Promise<ExtractAudioSamplesResultDto>
  extractRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult>
  extractPyramid(request: AudioWaveformPyramidRequest, signal?: AbortSignal): Promise<AudioWaveformPyramidResult>
  dispose(): Promise<void>
  statistics(): { active: number; queued: number; cacheBytes: number; cacheEntries: number; pyramidBytes: number; pyramidEntries: number }
} {
  // 精细回读不占重型媒体槽，并发只由这里约束：后台媒体线程预算的一半，每个任务占 2 个线程。
  // 整段金字塔同时占重型槽，按两边都计，最坏并行度只会被高估。
  const queue = new AudioWaveformQueue(dependencies.cacheBudgetBytes ?? audioMemoryBudgetBytes(256, 64 * MIB), dependencies.queueConcurrency ?? Math.max(1, Math.floor(MEDIA_BACKGROUND_THREADS / 2 / 2)))
  const resolvePath = dependencies.resolvePath ?? resolveLocalMediaPath
  const identity = dependencies.identity ?? identifyMediaContent
  const createWorker = dependencies.createWorker ?? (() => new AudioWaveformWorker())
  const disk = dependencies.diskCache === undefined
    ? getMediaCacheManager().createCache('preview', 'waveforms', { extension: '.hwpk', onError: (event, error) => logger.error('波形磁盘缓存失败', { event: `audio.waveform.cache.${event}_failed`, error }) })
    : dependencies.diskCache
  const memoryBudget = dependencies.pyramidMemoryBytes ?? audioMemoryBudgetBytes(64, 128 * MIB)
  const lineage = dependencies.lineage ?? { tracked: audioLineageTracked, ancestor: findAudioLineageAncestor }
  const probes = new Map<string, AudioMetadata>()
  async function probe(original: SourceIdentity, signal: AbortSignal, audioStream: number): Promise<AudioMetadata> {
    const key = `${original.identity}|${audioStream}`
    const held = probes.get(key)
    if (held) { probes.delete(key); probes.set(key, held); return held }
    const metadata = await probeAudio(await (dependencies.ffprobePath ?? loadFfprobePath)(), original.path, signal, audioStream)
    probes.set(key, metadata)
    if (probes.size > PROBE_CACHE_ENTRIES) probes.delete(probes.keys().next().value as string)
    return metadata
  }
  type MemoryEntry = { data: WaveformPyramidData; bytes: number } | { floats: WaveformPyramidFloats; bytes: number }
  const memory = new Map<string, MemoryEntry>()
  let memoryBytes = 0
  const remember = (key: string, data: WaveformPyramidData): void => keep(key, { data, bytes: waveformPyramidByteSize(data) })
  const rememberFloats = (key: string, floats: WaveformPyramidFloats): void => keep(key, { floats, bytes: waveformPyramidFloatsByteSize(floats) })
  const keep = (key: string, entry: MemoryEntry): void => {
    const bytes = entry.bytes
    const previous = memory.get(key)
    if (previous) { memory.delete(key); memoryBytes -= previous.bytes }
    if (bytes > memoryBudget) return
    while (memoryBytes + bytes > memoryBudget && memory.size) {
      const oldest = memory.keys().next().value as string
      memoryBytes -= memory.get(oldest)!.bytes; memory.delete(oldest)
    }
    memory.set(key, entry); memoryBytes += bytes
  }
  const fileKey = (sourceIdentity: string, audioStream: number, layout: FileLayout): string => digest(['hwpk', WAVEFORM_PYRAMID_FORMAT_VERSION, sourceIdentity, audioStream, layout])
  const floatsKey = (sourceIdentity: string, audioStream: number, layout: FileLayout): string => digest(['hwpf', WAVEFORM_PYRAMID_FORMAT_VERSION, sourceIdentity, audioStream, layout])
  interface CacheHit { data: WaveformPyramidData; from: 'memory' | 'disk'; bytes: number; readMs: number; decodeMs: number }
  async function cached(key: string): Promise<CacheHit | undefined> {
    const held = memory.get(key)
    if (held && 'data' in held) { memory.delete(key); memory.set(key, held); return { data: held.data, from: 'memory', bytes: held.bytes, readMs: 0, decodeMs: 0 } }
    const readStarted = performance.now()
    const bytes = await disk?.read(key)
    if (!bytes) return undefined
    const decodeStarted = performance.now()
    try {
      const data = decodeWaveformPyramid(bytes)
      remember(key, data)
      return { data, from: 'disk', bytes: bytes.byteLength, readMs: decodeStarted - readStarted, decodeMs: performance.now() - decodeStarted }
    } catch (error) {
      logger.error('波形缓存文件无效，已删除', { event: 'audio.waveform.cache.invalid', error })
      await disk?.remove(key).catch(() => undefined)
      return undefined
    }
  }
  async function cachedFloats(key: string): Promise<WaveformPyramidFloats | undefined> {
    const held = memory.get(key)
    if (held && 'floats' in held) { memory.delete(key); memory.set(key, held); return held.floats }
    const bytes = await disk?.read(key)
    if (!bytes) return undefined
    try {
      const floats = decodeWaveformPyramidFloats(bytes)
      rememberFloats(key, floats)
      return floats
    } catch (error) {
      logger.error('波形摘要缓存文件无效，已删除', { event: 'audio.waveform.cache.invalid', error })
      await disk?.remove(key).catch(() => undefined)
      return undefined
    }
  }
  async function store(sourceIdentity: string, audioStream: number, layout: FileLayout, data: WaveformPyramidData, floats: WaveformPyramidFloats | undefined, requestId: string): Promise<void> {
    remember(fileKey(sourceIdentity, audioStream, layout), data)
    if (floats) rememberFloats(floatsKey(sourceIdentity, audioStream, layout), floats)
    try {
      await disk?.write(fileKey(sourceIdentity, audioStream, layout), encodeWaveformPyramid(data))
      if (floats) await disk?.write(floatsKey(sourceIdentity, audioStream, layout), encodeWaveformPyramidFloats(floats))
    } catch (error) { logger.error('多级波形写入磁盘缓存失败', { event: 'audio.waveform.cache.write_failed', requestId, error }) }
  }
  async function lookup(sourceIdentity: string, selection: ChannelSelection): Promise<(CacheHit & { layout: FileLayout }) | undefined> {
    for (const layout of ['native', selectionLayout(selection)] as const) {
      const hit = await cached(fileKey(sourceIdentity, selection.audioStream, layout))
      if (hit) return { ...hit, layout }
    }
    return undefined
  }

  /** Decodes the whole sound stream once on the absolute clock and builds every level in the Worker. */
  async function decodePyramid(original: SourceIdentity, selection: ChannelSelection, signal: AbortSignal, onProgress: () => void, keepFloats: boolean): Promise<{ data: WaveformPyramidData; layout: FileLayout; floats?: WaveformPyramidFloats }> {
    const ffmpeg = await (dependencies.ffmpegPath ?? loadFfmpegPath)()
    const metadata = await probe(original, signal, selection.audioStream)
    onProgress()
    if (selection.audioChannel !== undefined && selection.audioChannel >= metadata.channels) throw new Error(`声音流只有 ${metadata.channels} 个声道。`)
    const native = metadata.channels <= NATIVE_PYRAMID_CHANNELS
    const layout: FileLayout = native ? 'native' : selectionLayout(selection)
    const channelCount = native ? metadata.channels : selection.audioChannel !== undefined ? 1 : selection.channels
    const endUs = Math.round(metadata.endSeconds * MICROSECONDS)
    const expectedFrames = Math.max(1, audioWaveformSampleIndex(endUs, metadata.sampleRate))
    const worker = createWorker()
    if (!worker.finishPyramid) throw new Error('音频 Worker 不支持多级波形。')
    const dispose = (): void => { void worker.dispose().catch(() => undefined) }
    signal.addEventListener('abort', dispose, { once: true })
    try {
      signal.throwIfAborted()
      await worker.start({
        kind: 'pyramid', channels: channelCount, mix: native && metadata.channels === 2, expectedFrames,
        sampleRate: metadata.sampleRate, startSeconds: metadata.startSeconds, endSeconds: metadata.endSeconds, nativeChannels: metadata.channels,
        baseSamplesPerBucket: WAVEFORM_PYRAMID_BASE_SAMPLES_PER_BUCKET, levelFactor: WAVEFORM_PYRAMID_LEVEL_FACTOR, topBuckets: WAVEFORM_PYRAMID_TOP_BUCKETS,
        ...(keepFloats && native ? { keepFloats: true } : {}),
      })
      const args = decodeArgs(original.path, metadata, { audioStream: selection.audioStream, ...(native ? {} : { audioChannel: selection.audioChannel }), channelCount, startUs: 0, endUs, first: 0, expectedFrames })
      await runProcess(ffmpeg, args, signal, chunk => { onProgress(); return worker.push(chunk) })
      const { pyramid, floats } = await worker.finishPyramid()
      signal.throwIfAborted()
      return { data: pyramid, layout, ...(floats ? { floats } : {}) }
    } finally {
      signal.removeEventListener('abort', dispose)
      await worker.dispose()
    }
  }

  /**
   * 按来历派生：这份文件（编辑后声音）与某个祖先除几段帧外样本逐值相同，且祖先的金字塔与第 1 级摘要都在缓存里时，
   * 只把改动所在、对齐到第 1 级桶的帧段直接从浮点 WAV 读出来重算，不起 FFmpeg 整段解码。结果与整段生成逐字节相同（金字塔只由样本决定）。
   * 只处理原声道（≤ 2 声道）、从 0 秒开始的浮点 WAV；其余情况返回 undefined，由调用方整段生成。
   */
  async function derivePyramid(original: SourceIdentity, selection: ChannelSelection, signal: AbortSignal): Promise<DerivedPyramid | undefined> {
    if (selection.audioStream !== 0) return undefined
    const found = await lineage.ancestor(original.path, async ancestor => {
      const parent = await identity(ancestor).catch(() => undefined)
      if (!parent) return undefined
      const hit = await cached(fileKey(parent.identity, 0, 'native'))
      const floats = hit ? await cachedFloats(floatsKey(parent.identity, 0, 'native')) : undefined
      return hit && floats ? { data: hit.data, floats } : undefined
    })
    if (!found) return undefined
    const skip = (reason: string): undefined => { logger.info('波形按块派生不可用，整段生成', { event: 'audio.waveform.pyramid.derive_skipped', context: { reason } }); return undefined }
    const metadata = await probe(original, signal, 0)
    if (metadata.channels > NATIVE_PYRAMID_CHANNELS || metadata.startSeconds !== 0) return skip('不是从 0 秒开始的单声道或立体声')
    const expectedFrames = Math.max(1, audioWaveformSampleIndex(Math.round(metadata.endSeconds * MICROSECONDS), metadata.sampleRate))
    const parent = found.value.data
    if (parent.sampleRate !== metadata.sampleRate || parent.startSeconds !== metadata.startSeconds || parent.endSeconds !== metadata.endSeconds || parent.nativeChannels !== metadata.channels) return skip('与上一版声音规格不同')
    const options: AudioWaveformPyramidOptions = {
      kind: 'pyramid', channels: metadata.channels, mix: metadata.channels === 2, expectedFrames, sampleRate: metadata.sampleRate, startSeconds: metadata.startSeconds, endSeconds: metadata.endSeconds,
      nativeChannels: metadata.channels, baseSamplesPerBucket: WAVEFORM_PYRAMID_BASE_SAMPLES_PER_BUCKET, levelFactor: WAVEFORM_PYRAMID_LEVEL_FACTOR, topBuckets: WAVEFORM_PYRAMID_TOP_BUCKETS,
    }
    const span = WAVEFORM_PYRAMID_BASE_SAMPLES_PER_BUCKET * WAVEFORM_PYRAMID_LEVEL_FACTOR
    const aligned: Array<[number, number]> = []
    for (const [start, end] of found.dirty) {
      const from = Math.floor(Math.max(0, start) / span) * span, to = Math.min(expectedFrames, Math.ceil(end / span) * span)
      if (to <= from) continue
      const last = aligned.at(-1)
      if (last && from <= last[1]) last[1] = Math.max(last[1], to)
      else aligned.push([from, to])
    }
    const recomputedFrames = aligned.reduce((sum, [from, to]) => sum + to - from, 0)
    // 改动超过一半时整段解码一遍更快，也省得在主进程里算。
    if (recomputedFrames > expectedFrames / 2) return skip('改动超过一半')
    const reader = await openF32Wav(original.path)
    if (!reader) return skip('不是浮点 WAV')
    try {
      if (reader.sampleRate !== metadata.sampleRate || reader.channels !== metadata.channels) return skip('文件头与探测结果不一致')
      const delivered = Math.min(reader.frames, expectedFrames)
      const spans: Array<{ startFrame: number; endFrame: number; values: Float32Array }> = []
      for (const [from, to] of aligned) {
        signal.throwIfAborted()
        spans.push({ startFrame: from, endFrame: to, values: await reader.read(from, Math.max(0, Math.min(to, delivered) - from)) })
      }
      const derived = deriveWaveformPyramid(parent, found.value.floats, options, spans, delivered)
      if ('reason' in derived) return skip(derived.reason)
      return { data: derived.pyramid, floats: derived.floats, recomputedFrames, hops: found.hops }
    } finally { await reader.close() }
  }

  /**
   * One pyramid per (content identity, sound stream, file layout): memory LRU, then disk, then a single
   * deduplicated decode. Remote (legacy http) sources are downloaded inside the job and never cached.
   */
  async function loadPyramid(source: string, selection: ChannelSelection, signal?: AbortSignal, ifNoneMatch?: string): Promise<LoadedPyramid | { notModified: true; version: string }> {
    signal?.throwIfAborted()
    const remote = isRemote(source)
    const startedAt = performance.now()
    const localPath = remote ? undefined : await resolvePath(source, signal)
    const known = localPath ? await identity(localPath) : undefined
    signal?.throwIfAborted()
    const version = known ? digest(['hwpk-view', WAVEFORM_PYRAMID_FORMAT_VERSION, known.identity, selection.audioStream, selectionLayout(selection)]) : digest(['hwpk-remote', source, selection.audioStream, selectionLayout(selection)])
    if (known && ifNoneMatch === version) return { notModified: true, version }
    const hit = known ? await lookup(known.identity, selection) : undefined
    if (hit) {
      const { data: _data, layout: _layout, ...timing } = hit
      return { data: hit.data, channels: selectPyramidChannels(hit.data, hit.layout, selection), version, hit: { ...timing, lookupMs: performance.now() - startedAt } }
    }
    const jobKey = JSON.stringify(['pyramid', known?.identity ?? `remote:${createHash('sha256').update(source).digest('hex')}`, selection.audioStream, selectionLayout(selection)])
    const result = await queue.run<PyramidJobResult>(jobKey, jobSignal => withMediaHeavyTask(async () => {
      // A concurrent job for another selection of the same stream may have produced the native file meanwhile.
      const again = known ? await lookup(known.identity, selection) : undefined
      if (again) return { shared: true as const, data: again.data, layout: again.layout }
      const requestId = randomUUID()
      const controller = new AbortController()
      const timer = idleTimeout(controller, '音频分析长时间没有进展，请稍后重试。')
      const cancel = (): void => controller.abort(jobSignal.reason)
      jobSignal.addEventListener('abort', cancel, { once: true })
      if (jobSignal.aborted) cancel()
      let temporaryPath: string | undefined
      const decodeStarted = performance.now()
      logger.debug('开始生成多级波形', { event: 'audio.waveform.pyramid.start', requestId, context: { remote } })
      try {
        const resolved = localPath ?? await resolvePath(source, controller.signal)
        if (remote) temporaryPath = resolved
        const original = known ?? await identity(resolved)
        const before = await identity(resolved)
        if (before.identity !== original.identity) throw new Error('音频素材已变化，请重新分析。')
        // 编辑后声音只改了几段时按块派生；有来历记录的文件整段生成时一并留下第 1 级摘要，供下一版派生。
        // 派生途中读缓存、读文件出错与派生不了一样处理：整段解码（取消照常抛出）。
        const derived = known && !remote ? await derivePyramid(original, selection, controller.signal).catch((error: unknown) => {
          if (controller.signal.aborted) throw error
          logger.warn('波形按块派生出错，整段生成', { event: 'audio.waveform.pyramid.derive_skipped', requestId, error, context: { reason: 'error' } })
          return undefined
        }) : undefined
        const tracked = Boolean(known && !remote && (derived || await lineage.tracked(original.path)))
        const decoded = derived ? { data: derived.data, layout: 'native' as const, floats: derived.floats } : await decodePyramid(original, selection, controller.signal, timer.refresh, tracked)
        const after = await identity(resolved)
        if (after.identity !== original.identity) throw new Error('音频素材在分析期间变化，请重新分析。')
        if (known) await store(known.identity, selection.audioStream, decoded.layout, decoded.data, decoded.floats, requestId)
        const context = { derived: Boolean(derived), sampleRate: decoded.data.sampleRate, frameCount: decoded.data.frameCount, recomputedFrames: derived?.recomputedFrames ?? decoded.data.frameCount, ...(derived ? { hops: derived.hops } : {}), channels: decoded.data.channelCount, levels: decoded.data.levels.length, bytes: waveformPyramidByteSize(decoded.data), elapsedMs: performance.now() - decodeStarted }
        if (tracked) logger.info('多级波形生成完成', { event: 'audio.waveform.pyramid.completed', requestId, context })
        else logger.debug('多级波形生成完成', { event: 'audio.waveform.pyramid.completed', requestId, context })
        return { shared: true as const, data: decoded.data, layout: decoded.layout }
      } catch (error) {
        if (controller.signal.aborted && !(controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError')) logger.debug('多级波形生成取消', { event: 'audio.waveform.pyramid.cancelled', requestId })
        else logger.error('多级波形生成失败', { event: 'audio.waveform.pyramid.failed', requestId, error })
        throw error
      } finally {
        timer.clear()
        jobSignal.removeEventListener('abort', cancel)
        if (temporaryPath) await fs.rm(temporaryPath, { force: true })
      }
    }, jobSignal), signal, false, true)
    signal?.throwIfAborted()
    if (localPath && (await identity(localPath)).identity !== known?.identity) throw new Error('音频素材已变化，请重新分析。')
    signal?.throwIfAborted()
    return { data: result.data, channels: selectPyramidChannels(result.data, result.layout, selection), version }
  }

  async function extractRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult> {
    signal?.throwIfAborted()
    const localPath = await resolvePath(request.source, signal)
    const knownIdentity = await identity(localPath)
    signal?.throwIfAborted()
    const bucketCount = Math.floor(request.bucketCount)
    const key = JSON.stringify([knownIdentity.path, knownIdentity.identity, request.sourceRevision ?? null, 'range-f32-v1', request.startUs, request.endUs, bucketCount, request.channels, request.audioStream ?? 0, request.audioChannel ?? null, request.samples === true])
    const result = await queue.run(key, async jobSignal => {
      const requestId = randomUUID()
      const startedAt = performance.now()
      const controller = new AbortController()
      const timer = idleTimeout(controller, '音频分析长时间没有进展，请稍后重试。')
      const cancel = (): void => controller.abort(jobSignal.reason)
      jobSignal.addEventListener('abort', cancel, { once: true })
      if (jobSignal.aborted) cancel()
      let worker: AggregationWorker | undefined
      const workerCancel = (): void => { void worker?.dispose().catch(() => undefined) }
      controller.signal.addEventListener('abort', workerCancel, { once: true })
      logger.debug('开始分析音频波形', { event: 'audio.waveform.start', requestId, context: { mode: 'range', bucketCount } })
      try {
        const original = knownIdentity
        const before = await identity(localPath)
        if (before.identity !== original.identity) throw new Error('音频素材已变化，请重新分析。')
        const ffmpeg = await (dependencies.ffmpegPath ?? loadFfmpegPath)()
        const audioStream = request.audioStream ?? 0
        const metadata = await probe(original, controller.signal, audioStream)
        if (request.audioChannel !== undefined && request.audioChannel >= metadata.channels) throw new Error(`声音流只有 ${metadata.channels} 个声道。`)
        const { sampleRate } = metadata
        const channelCount = request.channels === 2 && metadata.channels >= 2 ? 2 : 1
        const { startUs, endUs } = request
        // Range requests use the absolute source clock (container timestamps), the clock of imported media duration and clip source time.
        if (endUs > Math.round(metadata.endSeconds * MICROSECONDS) + END_TOLERANCE_US) throw new Error('波形范围超出素材时长。')
        const first = audioWaveformSampleIndex(startUs, sampleRate)
        const expectedFrames = audioWaveformSampleIndex(endUs, sampleRate) - first
        if (expectedFrames < 1) throw new Error('波形范围内没有完整采样时刻。')
        if (request.samples && expectedFrames > WAVEFORM_DETAIL_MAX_FRAMES) throw new Error('精细波形范围过长，请继续放大后重试。')
        worker = createWorker()
        controller.signal.throwIfAborted()
        await worker.start({ channels: channelCount, bucketCount, expectedFrames, ...(request.samples ? { keepSamples: true } : {}) })
        const args = decodeArgs(original.path, metadata, { audioStream, ...(request.audioChannel !== undefined ? { audioChannel: request.audioChannel } : {}), channelCount, startUs, endUs, first, expectedFrames })
        await runProcess(ffmpeg, args, controller.signal, chunk => { timer.refresh(); return worker!.push(chunk) })
        const channels = await worker.finish()
        controller.signal.throwIfAborted()
        const after = await identity(localPath)
        if (after.identity !== original.identity) throw new Error('音频素材在分析期间变化，请重新分析。')
        logger.debug('音频波形分析完成', { event: 'audio.waveform.completed', requestId, context: { sampleRate, channelCount, elapsedMs: performance.now() - startedAt } })
        return { startUs, endUs, durationSeconds: metadata.endSeconds, sampleRate, channelCount: channelCount as 1 | 2, channels, fileIdentity: original.identity, ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}) }
      } catch (error) {
        if (controller.signal.aborted) logger.debug('音频波形分析取消', { event: 'audio.waveform.cancelled', requestId })
        else logger.error('音频波形分析失败', { event: 'audio.waveform.failed', requestId, error })
        throw error
      } finally {
        timer.clear()
        jobSignal.removeEventListener('abort', cancel)
        controller.signal.removeEventListener('abort', workerCancel)
        await worker?.dispose()
      }
    }, signal)
    signal?.throwIfAborted()
    if ((await identity(localPath)).identity !== knownIdentity.identity) throw new Error('音频素材已变化，请重新分析。')
    signal?.throwIfAborted()
    return result
  }

  /** Whole decoded span, mono, sliced from the pyramid (the legacy overview contract). */
  async function extractSamples(source: string, bucketCount: number, signal?: AbortSignal): Promise<ExtractAudioSamplesResultDto> {
    if (!Number.isFinite(bucketCount) || bucketCount < 1 || bucketCount > 360_000) throw new Error('无效的波形采样数量。')
    const loaded = await loadPyramid(source, { channels: 1, audioStream: 0 }, signal)
    if ('notModified' in loaded) throw new Error('音频波形版本状态无效。')
    const { data } = loaded
    const aggregateStarted = performance.now()
    const count = Math.floor(bucketCount)
    const startFrame = Math.max(0, Math.round(data.startSeconds * data.sampleRate))
    const endFrame = Math.max(startFrame + 1, data.frameCount)
    const peak = new Float32Array(count); const rms = new Float32Array(count)
    aggregateWaveformLevel(selectWaveformLevel(data.levels, (endFrame - startFrame) / count), loaded.channels[0], data.amplitudeScale, startFrame, endFrame, count, peak, rms)
    if (loaded.hit) logger.debug('命中多级波形缓存', { event: 'audio.waveform.pyramid.cache_hit', context: { ...loaded.hit, copyMs: performance.now() - aggregateStarted } })
    return { peak: Array.from(peak), rms: Array.from(rms), durationSeconds: (endFrame - startFrame) / data.sampleRate }
  }

  async function extractPyramid(request: AudioWaveformPyramidRequest, signal?: AbortSignal): Promise<AudioWaveformPyramidResult> {
    validateAudioWaveformPyramid(request)
    const selection: ChannelSelection = { channels: request.channels, audioStream: request.audioStream ?? 0, ...(request.audioChannel !== undefined ? { audioChannel: request.audioChannel } : {}) }
    const loaded = await loadPyramid(request.source, selection, signal, request.ifNoneMatch)
    if ('notModified' in loaded) return loaded
    const { data, channels, version } = loaded
    const copyStarted = performance.now()
    const maxBuckets = request.maxBuckets ?? Number.POSITIVE_INFINITY
    const levels = data.levels.filter((level, index) => index === data.levels.length - 1 || level.bucketCount <= maxBuckets)
    const result: AudioWaveformPyramidResult = {
      version, sampleRate: data.sampleRate, frameCount: data.frameCount, startSeconds: data.startSeconds, endSeconds: data.endSeconds,
      amplitudeScale: data.amplitudeScale, peakMax: waveformPyramidPeakMax(data, channels), channelCount: channels.length,
      // Copies: the transfer must not carry the whole cache buffer, nor share it with the renderer.
      levels: levels.map(level => ({ samplesPerBucket: level.samplesPerBucket, bucketCount: level.bucketCount, min: channels.map(channel => level.min[channel].slice()), max: channels.map(channel => level.max[channel].slice()), rms: channels.map(channel => level.rms[channel].slice()) })),
    }
    if (loaded.hit) logger.debug('命中多级波形缓存', { event: 'audio.waveform.pyramid.cache_hit', context: { ...loaded.hit, levels: levels.length, copyMs: performance.now() - copyStarted } })
    return result
  }

  return {
    extractSamples,
    extractRange: (request, signal) => { validateAudioWaveformRange(request); return extractRange(request, signal) },
    extractPyramid,
    dispose: () => { memory.clear(); memoryBytes = 0; return queue.dispose() },
    statistics: () => ({ ...queue.statistics, pyramidBytes: memoryBytes, pyramidEntries: memory.size }),
  }
}

const service = createAudioWaveformService()
export function extractAudioSamples(source: string, bucketCount: number, signal?: AbortSignal): Promise<ExtractAudioSamplesResultDto> { return service.extractSamples(source, bucketCount, signal) }
export function extractAudioWaveformRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult> { return service.extractRange(request, signal) }
export function extractAudioWaveformPyramid(request: AudioWaveformPyramidRequest, signal?: AbortSignal): Promise<AudioWaveformPyramidResult> { return service.extractPyramid(request, signal) }
export function disposeAudioWaveformService(): Promise<void> { return service.dispose() }
