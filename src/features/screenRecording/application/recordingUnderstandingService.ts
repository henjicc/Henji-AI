import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { recordingDocumentSchema, type RecordingDocument } from '@/core/screenRecording/document'
import { recordingUnderstandingSchema, type RecordingUnderstanding, type RecordingRange, type RecordingTranscript } from '@/core/screenRecording/understanding'
import { intersectRecordingRanges, subtractRecordingRanges, segmentRecording } from '@/core/screenRecording/segmentation'
import type { CaptureEvent } from '@/core/captureLog/events'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { audioEditContentSchema } from '@/core/documents/kinds/audioEdit'
import type { DocumentReadResult } from '@/core/documents/types'
import { defaultDocumentOperationChanges } from '@/features/documents'
import { createAudioEditDraft, flushAudioEditProject, loadAudioEditProject, transcribeAudioEdit } from '@/features/audioEdit'
import { recordingEvents } from './recordingService'
import { recordedScriptSource, assertRecordedScriptEdits, recordingScriptIgnoredCapabilities } from './recordingScriptSource'
import { directorPlanIdentity, recordingDirectorPlanSchema, assertDirectorTargets } from '@/core/screenRecording/director'

const logger = createLogger('features.screenRecording.understanding')
export function assertRecordingEditable(content: RecordingDocument): void {
  if (!['stopped', 'interrupted'].includes(content.status)) throw new Error('请先停止录制，或恢复已中断的会话后再分析和修改步骤。')
}
export async function readRecordingUnderstanding(id: string): Promise<Omit<DocumentReadResult, 'content'> & { content: RecordingDocument }> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话。')
  return { ...read, content: recordingDocumentSchema.parse(read.content) }
}
/** Disk revision is the single source of truth; failed writes leave the original untouched. */
export async function saveRecordingUnderstanding(id: string, value: RecordingUnderstanding, expectedRevision: number): Promise<number> {
  const read = await readRecordingUnderstanding(id)
  assertRecordingEditable(read.content)
  if (read.meta.revision !== expectedRevision) throw new Error('CONFLICT:录制会话已修改，请重新读取理解结果。')
  const understanding = recordingUnderstandingSchema.parse(value)
  if (understanding.director) {
    const plan = recordingDirectorPlanSchema.parse({ director: understanding.director, operationScript: understanding.operationScript })
    const prior = read.content.understanding
    if (!prior.director) throw new Error('请通过规划导演录制创建脚本。')
    assertDirectorTargets(plan, read.content.scriptCapture)
    if ((read.content.sessionId || read.content.directorRun?.recordingId) && directorPlanIdentity(plan) !== directorPlanIdentity({ director: prior.director, operationScript: prior.operationScript })) throw new Error('此脚本已形成录制，请在成片中补录旁白，或重新规划一份教程。')
  } else if (read.content.understanding.director) throw new Error('不能移除导演脚本归属。')
  else if (understanding.operationScript.steps.length) assertRecordedScriptEdits(understanding.operationScript, await recordedScriptSource(id, { ...read.content, understanding }))
  const active = read.content.media.filter(v => v.kind === 'screen').map(v => ({ startUs: v.monoUs, endUs: v.monoUs + v.durationUs }))
  for (const range of [...understanding.transcript, ...understanding.steps, ...understanding.candidates]) {
    if (subtractRecordingRanges([range], active).length) throw new Error('理解结果超出已保存的屏幕片段，不能跨越暂停或缺片空档。')
  }
  for (const candidate of understanding.privacy.candidates) {
    const source = read.content.media.find(v => v.id === candidate.mediaId && v.kind === 'screen')
    if (!source || candidate.startUs < source.monoUs || candidate.endUs > source.monoUs + source.durationUs) throw new Error('打码候选超出其屏幕原片范围。')
  }
  logger.info('保存录制理解', { event: 'recording.understanding.save.start', context: { documentId: id } })
  try {
    const saved = await getPlatform().documents.saveDocument({ target: { id }, expectedRevision, content: { ...read.content, understanding } })
    defaultDocumentOperationChanges.changed()
    logger.info('录制理解已保存', { event: 'recording.understanding.save.completed', context: { documentId: id } })
    return saved.meta.revision
  } catch (error) { logger.error('录制理解保存失败', { event: 'recording.understanding.save.failed', error, context: { documentId: id } }); throw error }
}
export interface RecordingAnalysisOptions { transcribe: boolean; detectVisuals: boolean }
export interface RecordingAudioUpdate { id: string; created: boolean; transcribed: boolean }
const running = new Set<string>()
/** Sequential media analysis bounds decoder memory. Existing ASR documents retain paid results. */
export async function analyzeRecording(id: string, options: RecordingAnalysisOptions, signal: AbortSignal, onAudioWrite?: (update: RecordingAudioUpdate) => void): Promise<{ understanding: RecordingUnderstanding; revision: number; audioUpdates: RecordingAudioUpdate[] }> {
  if (running.has(id)) throw new Error('该会话正在分析，请等待或取消后重试。')
  running.add(id)
  logger.info('开始理解录制', { event: 'recording.understanding.analyze.start', context: { documentId: id } })
  try {
    signal.throwIfAborted()
    const read = await readRecordingUnderstanding(id), content = read.content
    assertRecordingEditable(content)
    const screen = content.media.filter(v => v.kind === 'screen' && v.durationUs > 0)
    if (!screen.length) throw new Error('会话没有已保存的屏幕片段，请先恢复录制。')
    const active = screen.map(v => ({ startUs: v.monoUs, endUs: v.monoUs + v.durationUs }))
    const events: CaptureEvent[] = []
    const ignoredCapabilities = recordingScriptIgnoredCapabilities()
    let offset: number | null = 0
    while (offset !== null) {
      signal.throwIfAborted()
      const page = await recordingEvents(id, offset, 256)
      // 120Hz cursor samples have no segmentation semantics; do not retain a 60-minute trace.
      events.push(...page.events.filter(event => event.kind !== 'cursor' && (event.kind !== 'capability' || !ignoredCapabilities.has(event.capability))))
      if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('事件分页没有推进，请恢复会话后重试。')
      offset = page.nextOffset
    }
    const warnings: string[] = []
    if (!content.eventPages.length) warnings.push('没有操作日志，仅使用声音和画面证据切分；等待段不作无输入判断。')
    const audioMedia = content.media.filter(v => ['microphone', 'systemAudio'].includes(v.kind) && v.durationUs > 0)
    const directed = Boolean(content.understanding.director)
    const transcript: RecordingTranscript[] = directed ? structuredClone(content.understanding.transcript) : []
    const audioUpdates: RecordingAudioUpdate[] = []
    // Unknown/missing audio intervals are not silence. For overlaps, every recorded audio track must be silent.
    let silence = audioMedia.length ? active : content.devices.microphone || content.devices.systemAudio ? [] : active
    const documents = await getPlatform().documents.listDocuments({ kind: 'audio_edit', includeMissing: false, includeDrafts: true })
    const audioByPath = new Map<string, Awaited<ReturnType<typeof loadAudioEditProject>>>()
    for (const summary of documents) {
      signal.throwIfAborted()
      const saved = await getPlatform().documents.readDocument({ id: summary.id })
      const parsed = audioEditContentSchema.parse(saved.content), source = parsed.source
      const previous = source ? audioByPath.get(source.sourcePath) : undefined
      if (source && audioMedia.some(media => media.path === source.sourcePath) && (!previous || !previous.document.transcript.length && parsed.transcript.length > 0)) audioByPath.set(source.sourcePath, await loadAudioEditProject(summary.id))
    }
    const kindSilences = new Map<string, RecordingRange[]>()
    for (const media of audioMedia) {
      signal.throwIfAborted()
      let audio = audioByPath.get(media.path)
      const requestId = crypto.randomUUID()
      const cancel = (): void => { void getPlatform().audioEdit.cancelTask(requestId).catch(error => logger.warn('取消声音分析失败', { event: 'recording.understanding.cancel.failed', error })) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const source = audio?.document.source ?? await getPlatform().audioEdit.probeSource(media.path, requestId)
        signal.throwIfAborted()
        if (options.transcribe && !directed && !audio) {
          audio = await createAudioEditDraft(source, read.meta.container)
          const update = { id: audio.document.id, created: true, transcribed: false }
          audioUpdates.push(update); onAudioWrite?.(update)
          await flushAudioEditProject(audio.document.id)
        }
        if (options.transcribe && !directed && audio && !audio.document.transcript.length) {
          await transcribeAudioEdit({ projectId: audio.document.id, requestId }, signal, id)
          const update = audioUpdates.find(v => v.id === audio!.document.id) ?? { id: audio.document.id, created: false, transcribed: false }
          if (!audioUpdates.includes(update)) audioUpdates.push(update)
          update.transcribed = true; onAudioWrite?.(update)
        }
        signal.throwIfAborted()
        const map = (start: number, end: number): RecordingRange => ({ startUs: media.monoUs + Math.round(start * 1e6 / source.sampleRate), endUs: Math.min(media.monoUs + media.durationUs, media.monoUs + Math.round(end * 1e6 / source.sampleRate)) })
        for (const block of directed ? [] : audio?.document.transcript ?? []) {
          const range = map(block.startFrame, block.endFrame)
          if (block.included && range.endUs > range.startUs) transcript.push({ id: `${media.id}:${block.id}`, ...range, text: block.text, granularity: block.granularity, audioDocumentId: audio!.document.id, mediaId: media.id, protected: block.locked })
        }
        const detected = await getPlatform().audioEdit.detectSilence({ sourcePath: media.path, requestId, settings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, retainedSilenceMs: 0, trimEdges: true } })
        const ranges = detected.suggestions.map(v => map(v.startFrame, v.endFrame)).filter(v => v.endUs > v.startUs)
        kindSilences.set(media.kind, [...(kindSilences.get(media.kind) ?? []), ...ranges])
      } finally { signal.removeEventListener('abort', cancel) }
    }
    for (const ranges of kindSilences.values()) silence = intersectRecordingRanges(silence, ranges)
    silence = subtractRecordingRanges(silence, (content.tracks?.tracks.filter(track => track.kind !== 'camera') ?? []).flatMap(track => track.gaps.map(gap => ({ startUs: gap.monoSpanUs[0], endUs: gap.monoSpanUs[1] }))))
    if (content.devices.microphone && !kindSilences.has('microphone') || content.devices.systemAudio && !kindSilences.has('systemAudio')) silence = []
    if (audioMedia.length && !transcript.length) warnings.push('尚无文字稿；可开启转写，识别沿用户当前模型设置和付费策略执行。')
    const stillness: RecordingRange[] = [], sceneCutsUs: number[] = []
    if (options.detectVisuals) for (const media of screen) {
      signal.throwIfAborted()
      const requestId = crypto.randomUUID()
      const cancel = (): void => { void getPlatform().sceneDetection.cancel(requestId).catch(error => logger.warn('取消画面分析失败', { event: 'recording.understanding.cancel.failed', error })) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const result = await getPlatform().sceneDetection.detect({ requestId, source: media.path, startSeconds: 0, endSeconds: media.durationUs / 1e6, sensitivity: 50, includeStillness: true })
        signal.throwIfAborted()
        if (!await getPlatform().sceneDetection.validate(media.path, result.contentIdentity)) throw new Error('录制原片在分析期间已变化，请重新分析。')
        sceneCutsUs.push(...result.cutsSeconds.map(t => media.monoUs + Math.round(t * 1e6)))
        stillness.push(...(result.stillness ?? []).map(v => ({ startUs: media.monoUs + Math.round(v.startSeconds * 1e6), endUs: media.monoUs + Math.round(v.endSeconds * 1e6) })))
      } finally { signal.removeEventListener('abort', cancel) }
    }
    else warnings.push('未检测画面，不生成等待加速候选。')
    signal.throwIfAborted()
    if ((await readRecordingUnderstanding(id)).meta.revision !== read.meta.revision) throw new Error('CONFLICT:分析期间会话已修改，保留已有结果，请重新分析。')
    const understanding = segmentRecording({ active, events, transcript, silence, stillness: content.eventPages.length ? stillness : [], sceneCutsUs, warnings })
    understanding.privacy = content.understanding.privacy
    if (directed) Object.assign(understanding, { director: content.understanding.director, operationScript: content.understanding.operationScript, steps: content.understanding.steps, chapters: content.understanding.chapters })
    logger.info('录制理解完成', { event: 'recording.understanding.analyze.completed', context: { documentId: id, steps: understanding.steps.length, candidates: understanding.candidates.length } })
    return { understanding, revision: read.meta.revision, audioUpdates }
  } catch (error) { logger.error('录制理解失败', { event: 'recording.understanding.analyze.failed', error, context: { documentId: id } }); throw error }
  finally { running.delete(id) }
}
