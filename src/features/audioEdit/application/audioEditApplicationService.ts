import type { AudioEditExportRequest, AudioEditExportResult, AudioEditRange, AudioEditTranscriptionRequest, AudioEditProjectDocument, AudioEditSuggestion } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, cleanAudioEditFillers, DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { getPlatform } from '@/platform/runtime'
import { withPaidOperation, transcriptionEstimatedCny } from '@/services/paidApproval'
import { readTranscriptionFacts, TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { createLogger } from '@/core/logging'
import { formatAudioEditCaptions, buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import { audioEditRetakeSuggestion } from '@/core/audioEdit/retakes'
import { acceptAudioEditNativeResult, editAudioEditProject, flushAudioEditProject, loadAudioEditProject, resetAudioEditProject, withAudioEditProjectOperation, type AudioEditProjectInstance } from './audioEditProjectInstances'
import { detectAudioEditRetakesOffThread } from './audioEditRetakeDetection'

const logger = createLogger('features.audioEdit.operations')

export async function undoAllAudioEditChanges(projectId: string, expectedVersion?: number): Promise<void> {
  const instance = await loadAudioEditProject(projectId)
  logger.info('audio_edit.reset.start', { context: { projectId } })
  try {
    resetAudioEditProject(projectId, expectedVersion ?? instance.version)
    await flushAudioEditProject(projectId)
    if (hasAudioEditModifications(instance.document)) throw new Error('口播在保存期间发生了新修改，未将其覆盖，请重新查看。')
    logger.info('audio_edit.reset.completed', { context: { projectId } })
  } catch (error) {
    logger.error('audio_edit.reset.failed', { context: { projectId }, error })
    throw error
  }
}

export async function formatProjectAudioEditCaptions(projectId: string): Promise<number> {
  const instance = await loadAudioEditProject(projectId)
  logger.info('audio_edit.captions.start', { context: { projectId } })
  try {
    editAudioEditProject(projectId, formatAudioEditCaptions)
    await flushAudioEditProject(projectId)
    const count = buildAudioEditCaptionGroups(instance.document.transcript, instance.document.source.sampleRate).filter((group) => group.text && group.blocks.some((block) => block.included)).length
    logger.info('audio_edit.captions.completed', { context: { projectId, count } })
    return count
  } catch (error) {
    logger.error('audio_edit.captions.failed', { context: { projectId }, error })
    throw error
  }
}

/** 是否有可以逐词剪辑的转写（去重念、清理语气词都需要）。 */
function hasWordTranscript(document: AudioEditProjectDocument): boolean {
  return document.transcript.length > 0 && document.transcript.every((block) => block.granularity === 'word')
}
/** 少于几个词不可能有重念，快速处理不必为此读取声音证据 */
const RETAKE_MIN_WORDS = 4

/**
 * 检测重念：读取实际声音的停顿证据（与停顿图、字幕断句共用的全频/高频能量分析），在 Worker 里比对转写，
 * 返回待应用的“重念”剪辑线索。参考稿只用来排除稿子里本来就有的重复。
 */
async function detectRetakeSuggestions(instance: AudioEditProjectInstance, range: AudioEditRange | undefined, requestId: string): Promise<AudioEditSuggestion[]> {
  const document = instance.document
  if (!document.transcript.length) throw new Error('这份口播还没有转写，请先识别口播。')
  if (!hasWordTranscript(document)) throw new Error('这份转写只有整句时间，无法逐词去掉重念；请用支持逐词时间的识别模型重新识别。')
  const detected = await getPlatform().audioEdit.detectSilence({ projectId: document.id, settings: document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS, requestId, energy: {} })
  if (detected.revision !== instance.persistedRevision) throw new Error('口播已更新，请重新检测重念。')
  if (!detected.energy) throw new Error('没有取得声音停顿证据，请重试。')
  const retakes = await detectAudioEditRetakesOffThread(document.transcript, {
    sampleRate: document.source.sampleRate, pauses: detected.energy.pauses, referenceScript: document.referenceScript, ...(range ? { range } : {}),
  })
  return retakes.map(audioEditRetakeSuggestion)
}

/** 把检测到的重念并入线索并逐条应用；已处理或已隐藏的同一处不重复提出。 */
function applyRetakeSuggestions(document: AudioEditProjectDocument, detected: readonly AudioEditSuggestion[]): AudioEditProjectDocument {
  const existing = new Set(document.suggestions.filter((item) => item.status !== 'pending').map((item) => item.id))
  const fresh = detected.filter((item) => !existing.has(item.id))
  let draft: AudioEditProjectDocument = { ...document, suggestions: [...document.suggestions.filter((item) => item.kind !== 'retake' || item.status !== 'pending'), ...fresh] }
  for (const suggestion of fresh) draft = applyAudioEditSuggestion(draft, suggestion.id)
  return draft
}

const appliedCount = (detected: readonly AudioEditSuggestion[], before: AudioEditProjectDocument, after: AudioEditProjectDocument): number => {
  const applied = new Set(before.suggestions.filter((item) => item.status === 'applied').map((item) => item.id))
  return detected.filter((item) => !applied.has(item.id) && after.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length
}

export async function cleanProjectAudioEditRetakes(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID()): Promise<{ count: number; shortenedMs: number }> {
  logger.info('audio_edit.retakes.start', { requestId, context: { projectId, range: Boolean(range) } })
  try {
    const result = await withAudioEditProjectOperation(projectId, async (instance, commit) => {
      const original = instance.document
      const before = editedDurationFrames(buildProjectAudioEditTimeline(original))
      const detected = await detectRetakeSuggestions(instance, range, requestId)
      const next = commit((document) => applyRetakeSuggestions(document, detected))
      await flushAudioEditProject(projectId)
      return { count: appliedCount(detected, original, next), shortenedMs: Math.round((before - editedDurationFrames(buildProjectAudioEditTimeline(next))) * 1000 / next.source.sampleRate) }
    })
    logger.info('audio_edit.retakes.completed', { requestId, context: { projectId, ...result } })
    return result
  } catch (error) {
    logger.error('audio_edit.retakes.failed', { requestId, context: { projectId }, error })
    throw error
  }
}

export async function compressAudioEditSilence(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID(), includeFillers = false): Promise<{ count: number; shortenedMs: number; retakeCount: number }> {
  return withAudioEditProjectOperation(projectId, async (instance, commit) => {
    const settings = instance.document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const before = editedDurationFrames(buildProjectAudioEditTimeline(instance.document))
    // 快速处理（连带语气词）在有逐词转写时先去掉重念，再压缩停顿，整批一个撤销步骤
    const retakes = includeFillers && hasWordTranscript(instance.document) && instance.document.transcript.length >= RETAKE_MIN_WORDS ? await detectRetakeSuggestions(instance, range, requestId) : []
    const detected = await getPlatform().audioEdit.detectSilence({ projectId, settings, range, requestId })
    if (detected.revision !== instance.persistedRevision) throw new Error('口播已更新，请重新分析停顿。')
    const appliedIds = new Set(instance.document.suggestions.filter((item) => item.status === 'applied').map((item) => item.id))
    const next = commit((document) => {
      let draft = retakes.length ? applyRetakeSuggestions(document, retakes) : document
      const existing = new Set(draft.suggestions.filter((item) => item.status !== 'pending').map((item) => item.id))
      const suggestions = detected.suggestions.filter((item) => !existing.has(item.id))
      draft = { ...draft, batchSettings: settings, suggestions: [...draft.suggestions.filter((item) => item.kind !== 'long_silence' || item.status !== 'pending'), ...suggestions] }
      for (const suggestion of suggestions) draft = applyAudioEditSuggestion(draft, suggestion.id)
      if (includeFillers) draft = cleanAudioEditFillers(draft, settings.fillers, range)
      return draft
    })
    await flushAudioEditProject(projectId)
    return { count: detected.suggestions.filter((item) => !appliedIds.has(item.id) && next.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length,
      shortenedMs: Math.round((before - editedDurationFrames(buildProjectAudioEditTimeline(next))) * 1000 / next.source.sampleRate),
      retakeCount: retakes.filter((item) => !appliedIds.has(item.id) && next.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length }
  })
}

export async function quickProcessAudioEdit(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID()) {
  return compressAudioEditSilence(projectId, range, requestId, true)
}

export async function cleanProjectAudioEditFillers(projectId: string, range?: AudioEditRange): Promise<number> {
  const instance = await loadAudioEditProject(projectId)
  const before = instance.document.transcript.filter((block) => !block.included).length
  const next = editAudioEditProject(projectId, (document) => cleanAudioEditFillers(document, (document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS).fillers, range))
  await flushAudioEditProject(projectId)
  return next.transcript.filter((block) => !block.included).length - before
}

export async function transcribeAudioEdit(request: AudioEditTranscriptionRequest, signal?: AbortSignal, approvalDocumentId = request.projectId): Promise<void> {
  let dispatched = false
  let completed = false
  let applied = false
  try {
  await withAudioEditProjectOperation(request.projectId, async (instance) => {
    const version = instance.version
    const prepared = await preflightAudioEditTranscription(request.projectId, request.modelId, request.language)
    const transcribe = async () => {
      signal?.throwIfAborted()
      dispatched = true
      return getPlatform().audioEdit.transcribe({ ...request, modelId: prepared.modelId ?? request.modelId })
    }
    const result = prepared.requiresConfirmation
      ? await withPaidOperation({ category: 'recognition', documentId: approvalDocumentId, estimatedCny: transcriptionEstimatedCny(prepared), titleKey: 'paidApproval.recognizeAudio' }, transcribe, signal)
      : await transcribe()
    completed = true
    acceptAudioEditNativeResult(request.projectId, result.project, version)
    applied = true
    // 付费识别结果立即写进文档文件，不等防抖
    await flushAudioEditProject(request.projectId)
  })
  } catch (error) {
    throw new TranscriptionFailure(error, { billing: completed ? 'completed' : dispatched ? 'unknown' : 'not_charged', targetMutation: applied ? 'applied' : 'none',
      ...readTranscriptionFacts(error), audioDocumentId: request.projectId })
  }
}

export async function preflightAudioEditTranscription(projectId: string, modelId?: string, language?: string): Promise<import('@/core/audioEdit/transcriptionFailure').TranscriptionPreparation> {
  const instance = await loadAudioEditProject(projectId)
  if (instance.document.transcript.length) return { requiresConfirmation: false }
  const source = instance.document.source
  return getPlatform().audioEdit.preflightTranscription({ sourcePath: source.sourcePath, durationMs: source.durationFrames * 1000 / source.sampleRate, modelId, language, audioDocumentId: projectId })
}
export async function exportAudioEdit(request: AudioEditExportRequest): Promise<AudioEditExportResult> {
  return withAudioEditProjectOperation(request.projectId, () => getPlatform().audioEdit.exportProject(request))
}
export async function prepareAudioEditProcessing(projectId: string, requestId: string): Promise<void> {
  return withAudioEditProjectOperation(projectId, () => getPlatform().audioEdit.prepareProcessing(projectId, requestId))
}
/** 重新定位原素材：主进程确认是同一份内容后返回新的素材信息，实例接收并经文档会话保存。 */
export async function relinkAudioEdit(projectId: string, sourcePath: string): Promise<AudioEditProjectDocument> {
  return withAudioEditProjectOperation(projectId, async (instance) => {
    const version = instance.version
    const source = await getPlatform().audioEdit.relinkSource(projectId, sourcePath)
    acceptAudioEditNativeResult(projectId, { ...instance.document, source }, version)
    await flushAudioEditProject(projectId)
    return instance.document
  })
}
