import type { OcrPrivacyRequest, OcrPrivacyResponse, OcrPrivacyProgress } from '../../../../src/platform/contracts/ocrPrivacy'
import { recordingPrivacySchema } from '../../../../src/core/screenRecording/privacy'
import type { BundledOcrModelId } from '../local-models/bundledOcr'
import type { OcrPrivacyJob } from '../local-inference/ocr/protocol'
import type { SmartRegionServiceDependencies } from './service'

export interface PrivacyServiceDependencies extends Pick<SmartRegionServiceDependencies, 'identity' | 'probe' | 'ffmpegPath' | 'providers' | 'log'> {
  ensureModel(id: BundledOcrModelId, role?: 'model' | 'dict'): Promise<string>
  infer(job: OcrPrivacyJob, progress: (done: number, total: number) => void): Promise<OcrPrivacyResponse>
  cancel(id: string): void
  emit(event: OcrPrivacyProgress): void
}
/** Coordination only: decoder, OCR and pattern matching execute in the existing utility queue. */
export class OcrPrivacyService {
  private readonly running = new Map<string, { cancelled: boolean }>()
  constructor(private readonly deps: PrivacyServiceDependencies) {}
  cancel(id: string): void { const task = this.running.get(id); if (task) { task.cancelled = true; this.deps.cancel(id) } }
  hasActiveJobs(): boolean { return this.running.size > 0 }
  async detect(request: OcrPrivacyRequest): Promise<OcrPrivacyResponse> {
    if (this.running.has(request.requestId)) throw new Error('敏感信息识别请求重复。')
    const task = { cancelled: false }; this.running.set(request.requestId, task)
    const check = (): void => { if (task.cancelled) throw new Error('敏感信息识别已取消。') }
    this.deps.log('info', '开始敏感信息识别', 'privacy.detect.start', { requestId: request.requestId, mediaId: request.mediaId })
    try {
      const identity = await this.deps.identity(request.source); check()
      const recognitionId = 'text_recognition_ppocr'
      const models: OcrPrivacyJob['models'] = []
      for (const [id, name] of [['text_detection_ppocr', 'ppocr'], [recognitionId, 'ppocr_rec']] as const) { models.push({ name, path: await this.deps.ensureModel(id) }); check() }
      const dictionaryPath = await this.deps.ensureModel(recognitionId, 'dict'); check()
      const probe = await this.deps.probe(identity.path); check()
      const containerStartUs = Math.round(probe.startSeconds * 1e6)
      const startUs = Math.max(request.startUs, containerStartUs)
      if (request.endUs <= startUs || probe.width <= 0 || probe.height <= 0) throw new Error('识别范围没有可读取的画面。')
      const ffmpegPath = await this.deps.ffmpegPath(); check()
      const result = await this.deps.infer({ id: request.requestId, source: identity.path, ffmpegPath, models, dictionaryPath, normalization: 'rgb-half', cursor: request.cursor, providers: this.deps.providers,
        seekSeconds: (startUs - containerStartUs) / 1e6, durationSeconds: (request.endUs - startUs) / 1e6,
        startUs: request.originUs + startUs, endUs: request.originUs + request.endUs, mediaId: request.mediaId,
        fps: Math.max(1, Math.min(10, probe.fps || 10)), display: probe,
      }, (done, total) => this.deps.emit({ requestId: request.requestId, progress: Math.min(1, done / Math.max(1, total)) }))
      check()
      if ((await this.deps.identity(request.source)).identity !== identity.identity) throw new Error('识别期间原片已变化，请重新识别。')
      check()
      const privacy = recordingPrivacySchema.parse(result.privacy)
      this.deps.log('info', '敏感信息识别完成', 'privacy.detect.completed', { requestId: request.requestId, frames: result.frames, inferredFrames: result.inferredFrames, candidates: privacy.candidates.length })
      return { ...result, privacy }
    } catch (error) { this.deps.log('error', '敏感信息识别未完成', task.cancelled ? 'privacy.detect.cancelled' : 'privacy.detect.failed', { requestId: request.requestId }); throw error }
    finally { this.running.delete(request.requestId) }
  }
  dispose(): void { for (const id of this.running.keys()) this.cancel(id) }
}
