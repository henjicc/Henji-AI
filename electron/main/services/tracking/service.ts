import { createHash, randomUUID } from 'node:crypto'
import type { LocalModelId } from '../../../../src/platform/contracts/localModels'
import {
  trackingDefinitionKey, type TrackingCandidates, type TrackingCandidatesRequest, type TrackingDefinition, type TrackingFailureReason,
  type TrackingProgressEvent, type TrackingRange, type TrackingResultRef, type TrackingRunOptions, type TrackingStatus, type TrackingFrameProvider,
} from '../../../../src/platform/contracts/tracking'
import { decodeSmartRegionLayout, smartRegionLayoutBytes } from '../../../../src/core/videoEdit/smartRegions'
import { normalizeVideoEditTracker, videoEditTrackerSchema, videoEditTrackFps, videoEditTrackFrame, videoEditTrackFrameTime, type VideoEditTrackHeader } from '../../../../src/core/videoEdit/tracking'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { LocalInferenceFailure } from '../local-inference/host'
import type { LocalInferenceModelFile } from '../local-inference/protocol'
import type { LocalExecutionProvider } from '../local-inference/providers'
import type { TrackingCandidatesJob, TrackingCandidatesResult, TrackingJob, TrackingJobResult } from '../local-inference/tracking/trackingProtocol'
import type { SmartRegionSourceProbe } from '../smart-regions/service'

/*
 * 跟踪服务（任务 4.10，主进程协调）：
 * - 结果键 = 素材内容身份 + 方式 + 提示 + 帧率 + 格式版本；结果文件与 4.7d 智能区域同一种容器、同一个程序目录；
 * - 同一定义一次只跑一个任务（跟踪中再点按钮返回当前进度）；续跟时把已有结果交给后台进程，从覆盖范围的边界接着跟；
 * - 停止：后台进程算完当前帧就停，已跟踪的部分照样写回缓存；
 * - 模型第一次用到时自动下载（4.11）；推理与取帧在本地推理后台进程里。
 */

export interface TrackingServiceDependencies {
  identity(source: string): Promise<{ path: string; identity: string }>
  probe(source: string): Promise<SmartRegionSourceProbe>
  ensureModel(id: LocalModelId): Promise<Array<{ name: string; path: string }>>
  ffmpegPath(): Promise<string>
  results: ContentDiskCache
  track(job: TrackingJob, progress: (done: number, total: number) => void, frames?: TrackingFrameProvider): Promise<TrackingJobResult>
  candidates(job: TrackingCandidatesJob, frames?: TrackingFrameProvider): Promise<TrackingCandidatesResult>
  cancel(id: string): void
  readHead(path: string, bytes: number): Promise<Uint8Array>
  providers: LocalExecutionProvider[]
  emit(event: TrackingProgressEvent): void
  log(level: 'info' | 'warn' | 'error', message: string, event: string, context: Record<string, unknown>): void
}

/** 结果格式或算法变化时加一，旧结果自然失效。 */
export const TRACKING_RESULT_VERSION = 1

const EFFICIENTTAM_FILES: Record<string, LocalInferenceModelFile['name']> = {
  'efficienttam_ti_512_image_encoder.onnx': 'etam_image_encoder', 'efficienttam_ti_512_mask_decoder.onnx': 'etam_mask_decoder',
  'efficienttam_ti_512_memory_encoder.onnx': 'etam_memory_encoder', 'efficienttam_ti_512_memory_attention.onnx': 'etam_memory_attention',
  'efficienttam_ti_512_mask_downsample.onnx': 'etam_mask_downsample',
}

function digest(parts: readonly unknown[]): string { return createHash('sha256').update(JSON.stringify(parts)).digest('hex') }

class TrackingFailure extends Error { constructor(readonly reason: TrackingFailureReason, message: string) { super(message) } }
export function trackingFailureReason(error: unknown): TrackingFailureReason {
  if (error instanceof TrackingFailure) return error.reason
  const code = (error as Partial<LocalInferenceFailure>)?.code
  return code === 'decode' ? 'decode' : code === 'output' ? 'disk' : 'inference'
}

interface Prepared { identity: string; probe: SmartRegionSourceProbe; fps: number; key: string }
interface Job { id: string; definition: TrackingDefinition; status: TrackingStatus; done: Promise<TrackingStatus>; stopped: boolean }

export class TrackingService {
  private readonly jobs = new Map<string, Job>()
  private readonly prepared = new Map<string, Promise<Prepared>>()
  private disposed = false
  constructor(private readonly deps: TrackingServiceDependencies) {}

  private normalize(definition: TrackingDefinition): TrackingDefinition {
    return { source: definition.source, method: definition.method, prompts: normalizeVideoEditTracker(videoEditTrackerSchema.parse({ id: 'x', name: 'x', method: definition.method, prompts: definition.prompts })).prompts }
  }

  /** 素材身份、显示尺寸、帧率与结果键（同一定义只算一次）。 */
  private prepare(definition: TrackingDefinition): Promise<Prepared> {
    const definitionKey = trackingDefinitionKey(definition)
    let pending = this.prepared.get(definitionKey)
    if (!pending) {
      pending = (async () => {
        if (typeof definition.source !== 'string') {
          const source = definition.source
          const fps = videoEditTrackFps(source.fps)
          return { identity: source.signature, probe: { width: source.width, height: source.height, fps: source.fps, startSeconds: 0, durationSeconds: 1800 }, fps, key: digest(['tracking', TRACKING_RESULT_VERSION, source, definition.method, definition.prompts, fps]) }
        }
        const { identity } = await this.deps.identity(definition.source)
        let probe: SmartRegionSourceProbe
        try { probe = await this.deps.probe(definition.source) } catch (error) { throw new TrackingFailure('decode', `素材读取失败：${error instanceof Error ? error.message : String(error)}`) }
        if (!(probe.width > 0 && probe.height > 0)) throw new TrackingFailure('decode', '素材没有画面。')
        const fps = videoEditTrackFps(probe.fps)
        return { identity, probe, fps, key: digest(['tracking', TRACKING_RESULT_VERSION, identity, definition.method, definition.prompts, fps]) }
      })()
      pending.catch(() => { if (this.prepared.get(definitionKey) === pending) this.prepared.delete(definitionKey) })
      this.prepared.set(definitionKey, pending)
      while (this.prepared.size > 64) this.prepared.delete(this.prepared.keys().next().value as string)
    }
    return pending
  }

  /** 已有结果的覆盖范围（只读文件头）。 */
  private async existing(prepared: Prepared): Promise<{ path: string; result: TrackingResultRef } | undefined> {
    const path = await this.deps.results.locate(prepared.key)
    if (!path) return undefined
    try {
      let head = await this.deps.readHead(path, 64 * 1024)
      const total = smartRegionLayoutBytes(head)
      if (head.byteLength < total) head = await this.deps.readHead(path, total)
      const { header } = decodeSmartRegionLayout<VideoEditTrackHeader>(head)
      return { path, result: { path, startUs: videoEditTrackFrameTime(header.firstFrame, header.fps), endUs: videoEditTrackFrameTime(header.firstFrame + header.frameCount, header.fps), fps: header.fps, summary: header.summary } }
    } catch { return undefined }
  }

  async status(input: TrackingDefinition): Promise<TrackingStatus> {
    const definition = this.normalize(input)
    const running = this.jobs.get(trackingDefinitionKey(definition))
    if (running) return running.status
    const found = await this.existing(await this.prepare(definition))
    return found ? { state: 'ready', result: found.result } : { state: 'idle' }
  }

  async run(input: TrackingDefinition, range: TrackingRange, options: TrackingRunOptions, frames?: TrackingFrameProvider): Promise<TrackingStatus> {
    const definition = this.normalize(input)
    const definitionKey = trackingDefinitionKey(definition)
    const running = this.jobs.get(definitionKey)
    if (running) return running.status
    const prepared = await this.prepare(definition)
    if (this.jobs.has(definitionKey)) return this.jobs.get(definitionKey)!.status
    const found = await this.existing(prepared)
    const job: Job = { id: randomUUID(), definition, status: { state: 'tracking', progress: 0, direction: options.direction, ...(found ? { result: found.result } : {}) }, stopped: false, done: Promise.resolve({ state: 'idle' }) }
    job.done = this.execute(job, prepared, range, options, found, frames).then(
      (result): TrackingStatus => ({ state: 'ready', result: result.ref, ...(result.stopped ? { stopped: true } : {}) }),
      (error: unknown): TrackingStatus => {
        // 停止（含还在下载模型、排队时就停）不算失败：回到已有结果。
        if (job.stopped) return found ? { state: 'ready', result: found.result, stopped: true } : { state: 'idle' }
        const reason = trackingFailureReason(error)
        this.deps.log('error', '跟踪失败', 'tracking.run.failed', { method: definition.method, reason, message: error instanceof Error ? error.message.slice(0, 300) : String(error) })
        return { state: 'failed', reason, message: error instanceof Error ? error.message.slice(0, 300) : undefined, ...(found ? { result: found.result } : {}) }
      },
    ).then(status => { this.jobs.delete(definitionKey); this.publish(job, status); return status })
    this.jobs.set(definitionKey, job)
    this.deps.emit({ definition, status: job.status })
    return job.status
  }

  /** 等到范围跟完（导出前、助手要求等待时用）：已覆盖直接返回；否则往两边跟满并等待。 */
  async ensureCovered(input: TrackingDefinition, range: TrackingRange, signal?: AbortSignal): Promise<TrackingStatus> {
    const definition = this.normalize(input)
    const running = this.jobs.get(trackingDefinitionKey(definition))
    const settle = async (job: Job): Promise<TrackingStatus> => signal ? Promise.race([job.done, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]) : job.done
    if (running) await settle(running)
    const status = await this.status(definition)
    if (status.state === 'ready' && this.covers(status.result, range)) return status
    await this.run(definition, range, { direction: 'both' })
    const job = this.jobs.get(trackingDefinitionKey(definition))
    return job ? settle(job) : this.status(definition)
  }

  covers(result: TrackingResultRef, range: TrackingRange): boolean {
    const frame = 1e6 / result.fps
    return result.startUs <= range.startUs + frame && result.endUs >= range.endUs - frame
  }

  stop(input: TrackingDefinition): void {
    const job = this.jobs.get(trackingDefinitionKey(this.normalize(input)))
    if (!job) return
    job.stopped = true
    this.deps.cancel(job.id)
  }

  async candidates(request: TrackingCandidatesRequest, frames?: TrackingFrameProvider): Promise<TrackingCandidates> {
    const prepared = await this.prepare({ source: request.source, method: 'shape', prompts: [{ timeUs: request.timeUs, points: request.points }] })
    const job: TrackingCandidatesJob = {
      id: randomUUID(), models: await this.models('shape'), ffmpegPath: await this.deps.ffmpegPath(), source: request.source,
      containerStartUs: Math.round(prepared.probe.startSeconds * 1e6), fps: prepared.fps, frame: videoEditTrackFrame(request.timeUs, prepared.fps),
      points: request.points, providers: this.deps.providers,
    }
    const result = await this.deps.candidates(job, frames)
    return { size: result.size, candidates: result.candidates }
  }

  private async models(method: TrackingDefinition['method']): Promise<LocalInferenceModelFile[]> {
    if (method === 'point' || method === 'planar') return []
    try {
      if (method === 'box') {
        const [file] = await this.deps.ensureModel('object_tracking_vittrack')
        return [{ name: 'vittrack', path: file.path }]
      }
      const files = await this.deps.ensureModel('object_tracking_efficienttam')
      return files.map(file => ({ name: EFFICIENTTAM_FILES[file.name], path: file.path })).filter(file => file.name)
    } catch (error) {
      this.deps.log('warn', '跟踪模型不可用', 'tracking.model.unavailable', { method, message: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      throw new TrackingFailure('model', '跟踪需要的本地模型下载失败。')
    }
  }

  private publish(job: Job, status: TrackingStatus): void {
    job.status = status
    this.deps.emit({ definition: job.definition, status })
  }

  private async execute(job: Job, prepared: Prepared, range: TrackingRange, options: TrackingRunOptions, found: { path: string } | undefined, frames?: TrackingFrameProvider): Promise<{ ref: TrackingResultRef; stopped: boolean }> {
    const { definition } = job
    const started = Date.now()
    this.deps.log('info', '跟踪开始', 'tracking.run.start', { method: definition.method, prompts: definition.prompts.length, direction: options.direction, limit: options.limit ?? null, resume: Boolean(found) })
    const models = await this.models(definition.method)
    if (this.disposed || job.stopped) throw new TrackingFailure('inference', '跟踪已停止。')
    const output = await this.deps.results.prepareTemporary(prepared.key)
    if (!output) throw new TrackingFailure('disk', '跟踪结果目录不可用。')
    const fps = prepared.fps
    const trackingJob: TrackingJob = {
      id: job.id, method: definition.method, models, ffmpegPath: await this.deps.ffmpegPath(), source: definition.source,
      containerStartUs: Math.round(prepared.probe.startSeconds * 1e6), fps, display: { width: prepared.probe.width, height: prepared.probe.height },
      prompts: definition.prompts.map(({timeUs, ...prompt}) => ({...prompt, frame: videoEditTrackFrame(timeUs, fps)})),
      range: { first: videoEditTrackFrame(range.startUs, fps), last: Math.max(videoEditTrackFrame(range.startUs, fps), Math.ceil(range.endUs * fps / 1e6) - 1) },
      direction: options.direction, ...(options.limit ? { limit: options.limit } : {}), ...(found ? { existingPath: found.path } : {}), outputPath: output, providers: this.deps.providers,
    }
    const result = await this.deps.track(trackingJob, (done, total) => { if (!this.disposed) this.publish(job, { ...job.status, state: 'tracking', progress: Math.min(0.99, done / Math.max(1, total)), direction: options.direction } as TrackingStatus) }, frames)
    let path: string
    try { path = await this.deps.results.adopt(prepared.key, output) } catch (error) { throw new TrackingFailure('disk', `跟踪结果写入缓存失败：${error instanceof Error ? error.message : String(error)}`) }
    this.deps.log('info', result.stopped ? '跟踪已停止（保留已跟踪的部分）' : '跟踪完成', result.stopped ? 'tracking.run.stopped' : 'tracking.run.completed', {
      method: definition.method, model: result.model, provider: result.provider, frames: result.frameCount, tracked: result.tracked, fps,
      durationMs: Date.now() - started, decodeMs: result.decodeMs, inferenceMs: result.inferenceMs, summary: result.summary,
    })
    return { stopped: result.stopped, ref: { path, startUs: videoEditTrackFrameTime(result.firstFrame, fps), endUs: videoEditTrackFrameTime(result.firstFrame + result.frameCount, fps), fps, summary: result.summary } }
  }

  hasActiveJobs(): boolean { return this.jobs.size > 0 }

  dispose(): void {
    this.disposed = true
    for (const job of this.jobs.values()) { job.stopped = true; this.deps.cancel(job.id) }
  }
}
