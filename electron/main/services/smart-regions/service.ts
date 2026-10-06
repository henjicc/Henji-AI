import { createHash, randomUUID } from 'node:crypto'
import type { LocalModelId } from '../../../../src/platform/contracts/localModels'
import {
  normalizeSmartRegionRange, smartRegionRequestKey,
  type SmartRegionFailureReason, type SmartRegionProgressEvent, type SmartRegionRequest, type SmartRegionSegmentRef, type SmartRegionStatus,
} from '../../../../src/platform/contracts/smartRegions'
import { SMART_REGION_FORMAT_VERSION, smartRegionSegmentCovers, type SmartRegionAnalysisKind } from '../../../../src/core/videoEdit/smartRegions'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { LocalInferenceFailure } from '../local-inference/host'
import type { LocalInferenceModelFile, SmartRegionAnalysisJob, SmartRegionAnalysisResult } from '../local-inference/protocol'
import type { LocalExecutionProvider } from '../local-inference/providers'

/*
 * 智能区域分析服务（任务 4.7d，主进程协调）：
 * - 键：素材内容身份 + 分析种类 + 格式版本 + 范围（按整秒取整）；结果放在程序目录的内容寻址缓存里；
 * - 索引：同一素材、同一种类的已分析段落记在一份小 JSON 里，新请求只要被某一段覆盖就直接用；
 * - 同一请求并发共用一次分析；模型第一次用到时自动下载（本地模型下载器 4.11）；
 * - 推理与取帧在后台进程里跑（LocalInferenceHost），这里只准备参数、改名进缓存、广播进度与写日志。
 */

export interface SmartRegionSourceProbe {
  /** 显示尺寸（已按旋转与像素比换算）。 */
  width: number
  height: number
  fps: number
  /** 容器起点（秒）：编辑器里的素材时间是绝对时钟，交给 FFmpeg -ss 前要减去它。 */
  startSeconds: number
}

export interface SmartRegionServiceDependencies {
  identity(source: string): Promise<{ path: string; identity: string }>
  probe(source: string): Promise<SmartRegionSourceProbe>
  ensureModel(id: LocalModelId): Promise<string>
  ffmpegPath(): Promise<string>
  segments: ContentDiskCache
  indexes: ContentDiskCache
  analyze(job: SmartRegionAnalysisJob, progress: (done: number, total: number) => void): Promise<SmartRegionAnalysisResult>
  cancelAnalysis(id: string): void
  providers: LocalExecutionProvider[]
  emit(event: SmartRegionProgressEvent): void
  log(level: 'info' | 'warn' | 'error', message: string, event: string, context: Record<string, unknown>): void
}

interface IndexEntry { key: string; startUs: number; endUs: number; still: boolean; model: string; summary: SmartRegionSegmentRef['summary'] }

interface Job { id: string; request: SmartRegionRequest; status: SmartRegionStatus; done: Promise<SmartRegionStatus>; cancelled: boolean }

/** 各分析的帧率上限：人物要跟住边缘，按素材帧率（最多 60）；人脸 30 帧（播放时按轨迹插值）；文字变化慢，10 帧。 */
export const SMART_REGION_FPS_LIMITS: Readonly<Record<SmartRegionAnalysisKind, number>> = { face: 30, person: 60, text: 10 }

const MODELS: Readonly<Record<SmartRegionAnalysisKind, Array<{ id: LocalModelId; name: LocalInferenceModelFile['name'] }>>> = {
  face: [{ id: 'face_detection_yunet', name: 'yunet' }],
  person: [{ id: 'person_matting_rvm', name: 'rvm' }, { id: 'selfie_segmentation', name: 'selfie' }],
  text: [{ id: 'text_detection_ppocr', name: 'ppocr' }],
}

function digest(parts: readonly unknown[]): string { return createHash('sha256').update(JSON.stringify(parts)).digest('hex') }

class SmartRegionFailure extends Error { constructor(readonly reason: SmartRegionFailureReason, message: string) { super(message) } }

export function failureReasonOf(error: unknown): SmartRegionFailureReason {
  if (error instanceof SmartRegionFailure) return error.reason
  const code = (error as Partial<LocalInferenceFailure>)?.code
  return code === 'decode' ? 'decode' : code === 'output' ? 'disk' : 'inference'
}

export class SmartRegionService {
  private readonly jobs = new Map<string, Job>()
  private disposed = false
  constructor(private readonly deps: SmartRegionServiceDependencies) {}

  /** 规范化请求（范围按整秒取整）。 */
  normalize(request: SmartRegionRequest): SmartRegionRequest {
    return { ...request, ...normalizeSmartRegionRange(request.startUs, request.endUs, request.still) }
  }

  private indexKey(identity: string, kind: SmartRegionAnalysisKind): string { return digest(['smart-region-index', SMART_REGION_FORMAT_VERSION, identity, kind]) }

  private async readIndex(identity: string, kind: SmartRegionAnalysisKind): Promise<IndexEntry[]> {
    const bytes = await this.deps.indexes.read(this.indexKey(identity, kind)).catch(() => undefined)
    if (!bytes) return []
    try { const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown; return Array.isArray(value) ? value as IndexEntry[] : [] } catch { return [] }
  }

  /** 已有缓存中覆盖这段范围的一段；缓存文件被清理的条目顺带剔除。 */
  private async cached(identity: string, request: SmartRegionRequest): Promise<SmartRegionSegmentRef | undefined> {
    const entries = await this.readIndex(identity, request.kind)
    for (const entry of entries) {
      if (!smartRegionSegmentCovers(entry, request.startUs, request.endUs)) continue
      const path = await this.deps.segments.locate(entry.key)
      if (path) return { path, startUs: entry.startUs, endUs: entry.endUs, still: entry.still, model: entry.model, summary: entry.summary }
    }
    return undefined
  }

  private publish(job: Job, status: SmartRegionStatus): void {
    job.status = status
    this.deps.emit({ request: job.request, status })
  }

  async ensure(input: SmartRegionRequest): Promise<SmartRegionStatus> {
    const request = this.normalize(input)
    const key = smartRegionRequestKey(request)
    const running = this.jobs.get(key)
    if (running) return running.status
    const { identity } = await this.deps.identity(request.source)
    const segment = await this.cached(identity, request)
    if (segment) return { state: 'ready', segment }
    if (this.jobs.has(key)) return this.jobs.get(key)!.status
    return this.start(key, request, identity).status
  }

  /** 等到分析结束（导出前、助手要求等待时用）。 */
  async wait(input: SmartRegionRequest, signal?: AbortSignal): Promise<SmartRegionStatus> {
    const status = await this.ensure(input)
    if (status.state !== 'analyzing') return status
    const job = this.jobs.get(smartRegionRequestKey(this.normalize(input)))
    if (!job) return this.ensure(input)
    if (!signal) return job.done
    return Promise.race([job.done, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))])
  }

  cancel(input: SmartRegionRequest): void {
    const job = this.jobs.get(smartRegionRequestKey(this.normalize(input)))
    if (!job) return
    job.cancelled = true
    this.deps.cancelAnalysis(job.id)
  }

  private start(key: string, request: SmartRegionRequest, identity: string): Job {
    const job = { id: randomUUID(), request, status: { state: 'analyzing', progress: 0 }, cancelled: false } as Job
    job.done = this.run(job, identity).then(
      (segment): SmartRegionStatus => ({ state: 'ready', segment }),
      (error: unknown): SmartRegionStatus => {
        const reason = failureReasonOf(error)
        if (!job.cancelled) this.deps.log('error', '智能区域分析失败', 'smart_regions.analyze.failed', { kind: request.kind, reason, message: error instanceof Error ? error.message.slice(0, 300) : String(error) })
        return { state: 'failed', reason }
      },
    ).then((status) => {
      this.jobs.delete(key)
      // 取消的分析不广播失败：请求方已经不需要它，下次 ensure 会重新开始。
      if (job.cancelled && status.state === 'failed') this.deps.log('info', '智能区域分析已取消', 'smart_regions.analyze.cancelled', { kind: request.kind })
      else this.publish(job, status)
      return status
    })
    this.jobs.set(key, job)
    this.deps.emit({ request, status: job.status })
    return job
  }

  private async run(job: Job, identity: string): Promise<SmartRegionSegmentRef> {
    const { request } = job
    const started = Date.now()
    this.deps.log('info', '智能区域分析开始', 'smart_regions.analyze.start', { kind: request.kind, still: request.still, startUs: request.startUs, endUs: request.endUs })
    // 模型：人物先要 RVM，下载失败再要 Selfie；全部拿不到才算失败。
    const models: LocalInferenceModelFile[] = []
    for (const model of MODELS[request.kind]) {
      try { models.push({ name: model.name, path: await this.deps.ensureModel(model.id) }) }
      catch (error) { this.deps.log('warn', '智能区域模型不可用', 'smart_regions.model.unavailable', { model: model.id, message: error instanceof Error ? error.message.slice(0, 200) : String(error) }) }
      if (this.disposed || job.cancelled) throw new SmartRegionFailure('inference', '分析已取消。')
    }
    if (!models.length) throw new SmartRegionFailure('model', '智能区域需要的本地模型下载失败。')
    let probe: SmartRegionSourceProbe
    try { probe = await this.deps.probe(request.source) } catch (error) { throw new SmartRegionFailure('decode', `素材读取失败：${error instanceof Error ? error.message : String(error)}`) }
    if (!(probe.width > 0 && probe.height > 0)) throw new SmartRegionFailure('decode', '素材没有画面。')
    const fps = request.still ? 1 : Math.max(1, Math.min(SMART_REGION_FPS_LIMITS[request.kind], probe.fps > 0 ? probe.fps : 30))
    const key = digest(['smart-region', SMART_REGION_FORMAT_VERSION, identity, request.kind, request.startUs, request.endUs, request.still, fps])
    const output = await this.deps.segments.prepareTemporary(key)
    if (!output) throw new SmartRegionFailure('disk', '智能区域缓存目录不可用。')
    const containerStartUs = Math.round(probe.startSeconds * 1e6)
    const analysisJob: SmartRegionAnalysisJob = {
      id: job.id, kind: request.kind, models, ffmpegPath: await this.deps.ffmpegPath(), source: request.source,
      seekSeconds: request.still ? 0 : Math.max(0, request.startUs - containerStartUs) / 1e6,
      durationSeconds: request.still ? null : (request.endUs - request.startUs) / 1e6,
      startUs: request.startUs, endUs: request.endUs, fps,
      display: { width: probe.width, height: probe.height }, outputPath: output, providers: this.deps.providers,
    }
    const result = await this.deps.analyze(analysisJob, (done, total) => { if (!job.cancelled) this.publish(job, { state: 'analyzing', progress: Math.min(0.99, done / Math.max(1, total)) }) })
    let path: string
    try { path = await this.deps.segments.adopt(key, output) } catch (error) { throw new SmartRegionFailure('disk', `分析结果写入缓存失败：${error instanceof Error ? error.message : String(error)}`) }
    const entry: IndexEntry = { key, startUs: request.startUs, endUs: request.endUs, still: request.still, model: result.model, summary: result.summary }
    const entries = (await this.readIndex(identity, request.kind)).filter(existing => existing.key !== key)
    await this.deps.indexes.write(this.indexKey(identity, request.kind), new TextEncoder().encode(JSON.stringify([...entries, entry].slice(-32)))).catch(error => {
      this.deps.log('warn', '智能区域索引写入失败', 'smart_regions.index.failed', { message: error instanceof Error ? error.message : String(error) })
    })
    this.deps.log('info', '智能区域分析完成', 'smart_regions.analyze.completed', {
      kind: request.kind, model: result.model, provider: result.provider, frames: result.frames, fps,
      durationMs: Date.now() - started, decodeMs: result.decodeMs, inferenceMs: result.inferenceMs, summary: result.summary,
    })
    return { path, startUs: request.startUs, endUs: request.endUs, still: request.still, model: result.model, summary: result.summary }
  }

  hasActiveJobs(): boolean { return this.jobs.size > 0 }

  dispose(): void {
    this.disposed = true
    for (const job of this.jobs.values()) { job.cancelled = true; this.deps.cancelAnalysis(job.id) }
  }
}
