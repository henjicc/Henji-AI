import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeLocalSource } from '../image/source'
import { resolveLocalMediaPath } from '../media/shared'
import { withMediaHeavyTask } from '../media-import/concurrency'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { AudioWaveformQueue } from './queue'
import { AudioWaveformWorker } from './worker-client'
import type { AudioWaveformAggregationOptions, AudioWaveformRangeRequest, AudioWaveformRangeResult, ExtractAudioSamplesResultDto } from './types'

const logger = createMainLogger('main.audio.waveform')
const MICROSECONDS = 1_000_000
const MAX_RANGE_US = 30 * 60 * MICROSECONDS
/** Absolute range requests may overrun the probed end by printing/rounding differences between probes; the tail decodes as silence. */
const END_TOLERANCE_US = 1000
interface AudioMetadata {
  sampleRate: number
  channels: number
  /** Decoded span (container end minus start): the legacy full-file timeline. */
  durationSeconds: number
  /** Container start on the absolute source clock; maps absolute seeks onto FFmpeg's `-ss`. */
  startSeconds: number
  /** Absolute media end, the same measure as the imported media duration. */
  endSeconds: number
}
interface SourceIdentity { path: string; identity: string }
interface AggregationWorker {
  start(options: AudioWaveformAggregationOptions): Promise<void>
  push(bytes: Uint8Array): Promise<void>
  finish(): Promise<AudioWaveformRangeResult['channels']>
  dispose(): Promise<void>
}
export interface AudioWaveformServiceDependencies {
  ffmpegPath?: () => Promise<string>
  ffprobePath?: () => Promise<string>
  resolvePath?: (source: string, signal?: AbortSignal) => Promise<string>
  identity?: (source: string) => Promise<SourceIdentity>
  createWorker?: () => AggregationWorker
  cacheBudgetBytes?: number
}

async function identifySource(source: string): Promise<SourceIdentity> {
  const canonical = await fs.realpath(source)
  const stat = await fs.stat(canonical, { bigint: true })
  if (!stat.isFile()) throw new Error('波形来源必须为可读取的媒体文件。')
  const identity = createHash('sha256').update([canonical, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('|')).digest('hex')
  return { path: canonical, identity }
}

/** ceil(timeUs * sampleRate / 1e6), with no accumulated floating-point rounding. */
export function audioWaveformSampleIndex(timeUs: number, sampleRate: number): number {
  return Number((BigInt(timeUs) * BigInt(sampleRate) + 999_999n) / 1_000_000n)
}
export function validateAudioWaveformRange(request: AudioWaveformRangeRequest): void {
  if (typeof request.source !== 'string' || !request.source.trim() || request.source.length > 8192 || request.source.includes('\0')) throw new Error('无效的音频素材路径。')
  if (!path.isAbsolute(normalizeLocalSource(request.source))) throw new Error('范围波形只允许已导入的本地素材。')
  if (request.sourceRevision !== undefined && (typeof request.sourceRevision !== 'string' || !request.sourceRevision.length || request.sourceRevision.length > 256)) throw new Error('无效的音频素材修订。')
  if (!Number.isSafeInteger(request.startUs) || !Number.isSafeInteger(request.endUs) || request.startUs < 0 || request.endUs <= request.startUs || request.endUs - request.startUs > MAX_RANGE_US) throw new Error('波形范围必须为非负整数微秒，且不超过30分钟。')
  if (!Number.isInteger(request.bucketCount) || request.bucketCount < 16 || request.bucketCount > 4096 || (request.channels !== 1 && request.channels !== 2)) throw new Error('无效的波形采样规格。')
  if (request.audioStream !== undefined && (!Number.isInteger(request.audioStream) || request.audioStream < 0 || request.audioStream > 63)) throw new Error('无效的声音流序号。')
  if (request.audioChannel !== undefined && (!Number.isInteger(request.audioChannel) || request.audioChannel < 0 || request.audioChannel > 63 || request.channels !== 1)) throw new Error('无效的单声道波形声道。')
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

export function createAudioWaveformService(dependencies: AudioWaveformServiceDependencies = {}): {
  extractSamples(source: string, bucketCount: number, signal?: AbortSignal): Promise<ExtractAudioSamplesResultDto>
  extractRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult>
  dispose(): Promise<void>
  statistics(): { active: number; queued: number; cacheBytes: number; cacheEntries: number }
} {
  const queue = new AudioWaveformQueue(dependencies.cacheBudgetBytes)
  const resolvePath = dependencies.resolvePath ?? resolveLocalMediaPath
  const identity = dependencies.identity ?? identifySource
  async function extract(source: string, bucketCount: number, request: AudioWaveformRangeRequest | undefined, signal?: AbortSignal): Promise<ExtractAudioSamplesResultDto | AudioWaveformRangeResult> {
    signal?.throwIfAborted()
    if (!Number.isFinite(bucketCount) || bucketCount < 1 || bucketCount > 360_000) throw new Error('无效的波形采样数量。')
    const remote = !request && (source.startsWith('http://') || source.startsWith('https://'))
    // Remote legacy resolution is itself media work: it must own a queue permit.
    const localPath = remote ? undefined : await resolvePath(source, signal)
    const knownIdentity = localPath ? await identity(localPath) : undefined
    signal?.throwIfAborted()
    const key = JSON.stringify([knownIdentity?.path ?? createHash('sha256').update(source).digest('hex'), knownIdentity?.identity ?? null, request?.sourceRevision ?? null, request ? 'range-f32-v1' : 'legacy-s16-v1', request?.startUs, request?.endUs, Math.floor(bucketCount), request?.channels ?? 1, request?.audioStream ?? 0, request?.audioChannel ?? null])
    const result = await queue.run(key, jobSignal => withMediaHeavyTask(async () => {
      const requestId = randomUUID()
      const startedAt = performance.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('音频分析超时，请缩小范围后重试。', 'TimeoutError')), 120_000)
      timer.unref()
      const cancel = (): void => controller.abort(jobSignal.reason)
      jobSignal.addEventListener('abort', cancel, { once: true })
      if (jobSignal.aborted) cancel()
      let worker: AggregationWorker | undefined
      let temporaryPath: string | undefined
      const workerCancel = (): void => { void worker?.dispose().catch(() => undefined) }
      controller.signal.addEventListener('abort', workerCancel, { once: true })
      logger.debug('开始分析音频波形', { event: 'audio.waveform.start', requestId, context: { mode: request ? 'range' : 'legacy', bucketCount } })
      try {
        const resolved = localPath ?? await resolvePath(source, controller.signal)
        if (remote) temporaryPath = resolved
        const original = knownIdentity ?? await identity(resolved)
        const before = await identity(resolved)
        if (before.identity !== original.identity) throw new Error('音频素材已变化，请重新分析。')
        const [ffmpeg, ffprobe] = await Promise.all([(dependencies.ffmpegPath ?? loadFfmpegPath)(), (dependencies.ffprobePath ?? loadFfprobePath)()])
        const audioStream = request?.audioStream ?? 0
        const metadata = await probeAudio(ffprobe, original.path, controller.signal, audioStream)
        if (request?.audioChannel !== undefined && request.audioChannel >= metadata.channels) throw new Error(`声音流只有 ${metadata.channels} 个声道。`)
        const sampleRate = request ? metadata.sampleRate : 8000
        const channelCount = request?.channels === 2 && metadata.channels >= 2 ? 2 : 1
        // One channel of the stream (a mono clip mapped to it, task 2.6) instead of the downmix.
        const pick = request?.audioChannel !== undefined ? `pan=mono|c0=c${request.audioChannel},` : ''
        const startUs = request?.startUs ?? 0
        const endUs = request?.endUs ?? Math.round(metadata.durationSeconds * MICROSECONDS)
        // Range requests use the absolute source clock (container timestamps), the clock of imported media duration and clip source time.
        if (request && endUs > Math.round(metadata.endSeconds * MICROSECONDS) + END_TOLERANCE_US) throw new Error('波形范围超出素材时长。')
        const first = audioWaveformSampleIndex(startUs, sampleRate)
        const expectedFrames = request ? audioWaveformSampleIndex(endUs, sampleRate) - first : Math.max(1, Math.round(metadata.durationSeconds * sampleRate))
        if (expectedFrames < 1) throw new Error('波形范围内没有完整采样时刻。')
        worker = (dependencies.createWorker ?? (() => new AudioWaveformWorker()))()
        controller.signal.throwIfAborted()
        await worker.start({ format: request ? 'f32le' : 's16le', channels: channelCount, bucketCount: Math.floor(bucketCount), expectedFrames })
        const seekUs = Math.max(0, startUs - 100_000)
        // Keep absolute container timestamps (-copyts without -start_at_zero); FFmpeg's input -ss is
        // relative to the container start, so the absolute seek is shifted by it (clamped at the start).
        // first_pts trims preroll and inserts source-clock silence before a later audio start (delayed
        // streams, MPEG-PS starting after zero), without reducing sample rate.
        const seekArgUs = Math.max(0, seekUs - Math.round(metadata.startSeconds * MICROSECONDS))
        const args = request
          ? ['-nostdin', '-v', 'error', '-copyts', '-ss', String(seekArgUs / MICROSECONDS), '-t', String((endUs - seekUs) / MICROSECONDS + 2 / sampleRate), '-i', original.path, '-map', `0:a:${audioStream}`, '-vn', '-sn', '-dn', '-af', `${pick}aresample=${sampleRate}:async=1:first_pts=${first},atrim=end_sample=${expectedFrames},asetpts=PTS-STARTPTS`, '-ar', String(sampleRate), '-ac', String(channelCount), '-f', 'f32le', 'pipe:1']
          : ['-nostdin', '-v', 'error', '-i', original.path, '-map', '0:a:0', '-vn', '-sn', '-dn', '-ar', '8000', '-ac', '1', '-f', 's16le', 'pipe:1']
        await runProcess(ffmpeg, args, controller.signal, chunk => worker!.push(chunk))
        const channels = await worker.finish()
        controller.signal.throwIfAborted()
        const after = await identity(resolved)
        if (after.identity !== original.identity) throw new Error('音频素材在分析期间变化，请重新分析。')
        logger.debug('音频波形分析完成', { event: 'audio.waveform.completed', requestId, context: { sampleRate, channelCount, elapsedMs: performance.now() - startedAt } })
        return request
          ? { startUs, endUs, durationSeconds: metadata.endSeconds, sampleRate, channelCount, channels, fileIdentity: original.identity, ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}) }
          : { peak: channels[0].peak, rms: channels[0].rms, durationSeconds: metadata.durationSeconds }
      } catch (error) {
        if (controller.signal.aborted) logger.debug('音频波形分析取消', { event: 'audio.waveform.cancelled', requestId })
        else logger.error('音频波形分析失败', { event: 'audio.waveform.failed', requestId, error })
        throw error
      } finally {
        clearTimeout(timer)
        jobSignal.removeEventListener('abort', cancel)
        controller.signal.removeEventListener('abort', workerCancel)
        await worker?.dispose()
        if (temporaryPath) await fs.rm(temporaryPath, { force: true })
      }
    }, jobSignal), signal, !remote)
    signal?.throwIfAborted()
    if (localPath && (await identity(localPath)).identity !== knownIdentity?.identity) throw new Error('音频素材已变化，请重新分析。')
    signal?.throwIfAborted()
    return result
  }
  return {
    extractSamples: (source, bucketCount, signal) => extract(source, bucketCount, undefined, signal) as Promise<ExtractAudioSamplesResultDto>,
    extractRange: (request, signal) => { validateAudioWaveformRange(request); return extract(request.source, request.bucketCount, request, signal) as Promise<AudioWaveformRangeResult> },
    dispose: () => queue.dispose(),
    statistics: () => queue.statistics,
  }
}

const service = createAudioWaveformService()
export function extractAudioSamples(source: string, bucketCount: number, signal?: AbortSignal): Promise<ExtractAudioSamplesResultDto> { return service.extractSamples(source, bucketCount, signal) }
export function extractAudioWaveformRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult> { return service.extractRange(request, signal) }
export function disposeAudioWaveformService(): Promise<void> { return service.dispose() }
