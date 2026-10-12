import type { AudioEditExportRequest, AudioEditExportResult, AudioEditRange, AudioEditTranscriptionRequest, AudioEditProjectDocument } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, cleanAudioEditFillers, DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { getPlatform } from '@/platform/runtime'
import { withPaidOperation, transcriptionEstimatedCny } from '@/services/paidApproval'
import { readTranscriptionFacts, TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { createLogger } from '@/core/logging'
import { formatAudioEditCaptions, buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import { acceptAudioEditNativeResult, editAudioEditProject, flushAudioEditProject, loadAudioEditProject, resetAudioEditProject, withAudioEditProjectOperation } from './audioEditProjectInstances'

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

export async function compressAudioEditSilence(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID(), includeFillers = false): Promise<{ count: number; shortenedMs: number }> {
  return withAudioEditProjectOperation(projectId, async (instance, commit) => {
    const settings = instance.document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const before = editedDurationFrames(buildProjectAudioEditTimeline(instance.document))
    const detected = await getPlatform().audioEdit.detectSilence({ projectId, settings, range, requestId })
    if (detected.revision !== instance.persistedRevision) throw new Error('口播已更新，请重新分析停顿。')
    const appliedIds = new Set(instance.document.suggestions.filter((item) => item.status === 'applied').map((item) => item.id))
    const next = commit((document) => {
      const existing = new Set(document.suggestions.filter((item) => item.status !== 'pending').map((item) => item.id))
      const suggestions = detected.suggestions.filter((item) => !existing.has(item.id))
      let draft: AudioEditProjectDocument = { ...document, batchSettings: settings, suggestions: [...document.suggestions.filter((item) => item.kind !== 'long_silence' || item.status !== 'pending'), ...suggestions] }
      for (const suggestion of suggestions) draft = applyAudioEditSuggestion(draft, suggestion.id)
      if (includeFillers) draft = cleanAudioEditFillers(draft, settings.fillers, range)
      return draft
    })
    await flushAudioEditProject(projectId)
    return { count: detected.suggestions.filter((item) => !appliedIds.has(item.id) && next.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length,
      shortenedMs: Math.round((before - editedDurationFrames(buildProjectAudioEditTimeline(next))) * 1000 / next.source.sampleRate) }
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
      ? await withPaidOperation({ category: 'recognition', documentId: approvalDocumentId, estimatedCny: transcriptionEstimatedCny(prepared), title: '识别声音' }, transcribe, signal)
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
