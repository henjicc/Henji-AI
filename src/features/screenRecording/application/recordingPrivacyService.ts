import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { recordingPrivacySchema, type RecordingPrivacy } from '@/core/screenRecording/privacy'
import { assertRecordingEditable, readRecordingUnderstanding } from './recordingUnderstandingService'
import { recordingDomPrivacyCandidates } from '@/core/screenRecording/domPrivacy'
import type { OcrPrivacyRequest } from '@/platform/contracts/ocrPrivacy'
import type { CaptureEvent } from '@/core/captureLog/events'
import { recordingEvents } from './recordingService'
import { recordingPrivacyCursor } from './recordingPrivacyCursor'

const logger = createLogger('features.screenRecording.privacy')
const running = new Set<string>()
export function recordingPrivacyBusy(id: string): boolean { return running.has(id) }
/** Sequential analysis retains at most one decoded stream. Cancel/conflict never publish a partial candidate set. */
export async function analyzeRecordingPrivacy(id: string, signal: AbortSignal, progress: (value: number) => void = () => undefined, quality?: OcrPrivacyRequest['quality']): Promise<{ privacy: RecordingPrivacy; revision: number }> {
  if (running.has(id)) throw new Error('此会话正在识别敏感信息，请等待或取消。')
  running.add(id)
  logger.info('开始录制隐私分析', { event: 'recording.privacy.start', context: { documentId: id } })
  try {
    signal.throwIfAborted()
    const read = await readRecordingUnderstanding(id); assertRecordingEditable(read.content)
    const media = read.content.media.filter(v => v.kind === 'screen' && v.durationUs > 0)
    if (!media.length) throw new Error('没有已保存的屏幕原片，请先恢复会话。')
    const events: CaptureEvent[] = []
    const cursorSampler = read.content.source?.cursorEmbedded ? recordingPrivacyCursor(media) : undefined
    let offset: number | null = 0
    while (offset !== null) {
      signal.throwIfAborted()
      const page = await recordingEvents(id, offset, 256)
      events.push(...page.events.filter(e => e.kind === 'sensitive' || e.kind === 'control'))
      if (cursorSampler) for (const event of page.events) cursorSampler.append(event)
      if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('录制事件分页没有推进。')
      offset = page.nextOffset
    }
    const cursor = cursorSampler?.finish() ?? []
    const result: RecordingPrivacy = { candidates: [], warnings: [] }, total = media.reduce((sum, v) => sum + v.durationUs, 0)
    let done = 0
    for (const source of media) {
      signal.throwIfAborted()
      const requestId = crypto.randomUUID(), api = getPlatform().smartRegions
      const cancel = (): void => { void api.cancelSensitiveText(requestId).catch(error => logger.warn('取消敏感信息识别失败', { event: 'recording.privacy.cancel.failed', error })) }
      const unsubscribe = api.onPrivacyProgress(event => { if (event.requestId === requestId) progress((done + event.progress * source.durationUs) / total) })
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const detected = await api.detectSensitiveText({ requestId, quality, source: source.path, mediaId: source.id, startUs: 0, endUs: source.durationUs, originUs: source.monoUs, ...(cursor.length ? { cursor: cursor.filter(c => c.monoUs >= source.monoUs - 100000 && c.monoUs < source.monoUs + source.durationUs) } : {}) })
        signal.throwIfAborted()
        result.candidates.push(...detected.privacy.candidates); result.warnings.push(...detected.privacy.warnings)
        done += source.durationUs; progress(done / total)
      } finally { signal.removeEventListener('abort', cancel); unsubscribe() }
    }
    signal.throwIfAborted()
    result.candidates.push(...recordingDomPrivacyCandidates(events, read.content.media, () => crypto.randomUUID()))
    if ((await readRecordingUnderstanding(id)).meta.revision !== read.meta.revision) throw new Error('CONFLICT:识别期间会话已修改，请重新读取后识别。')
    const privacy = recordingPrivacySchema.parse({ ...result, warnings: [...new Set(result.warnings)] })
    logger.info('录制隐私分析完成', { event: 'recording.privacy.completed', context: { documentId: id, candidates: privacy.candidates.length } })
    return { privacy, revision: read.meta.revision }
  } catch (error) { logger.error('录制隐私分析失败', error, { event: signal.aborted ? 'recording.privacy.cancelled' : 'recording.privacy.failed', context: { documentId: id } }); throw error }
  finally { running.delete(id) }
}
