import type { AudioEditExportRequest, AudioEditExportResult, AudioEditRange, AudioEditTranscriptionRequest, AudioEditProjectDocument } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, cleanAudioEditFillers, DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { getPlatform } from '@/platform/runtime'
import { acceptAudioEditNativeResult, editAudioEditProject, flushAudioEditProject, loadAudioEditProject, releaseAudioEditProject, withAudioEditProjectOperation } from './audioEditProjectInstances'

export async function compressAudioEditSilence(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID(), includeFillers = false): Promise<{ count: number; shortenedMs: number }> {
  return withAudioEditProjectOperation(projectId, async (instance, commit) => {
    const settings = instance.document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const before = editedDurationFrames(buildProjectAudioEditTimeline(instance.document))
    const detected = await getPlatform().audioEdit.detectSilence({ projectId, settings, range, requestId })
    if (detected.revision !== instance.persistedRevision) throw new Error('工程已更新，请重新分析停顿。')
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

export async function transcribeAudioEdit(request: AudioEditTranscriptionRequest): Promise<void> {
  await withAudioEditProjectOperation(request.projectId, async (instance) => {
    const version = instance.version
    const result = await getPlatform().audioEdit.transcribe(request)
    acceptAudioEditNativeResult(request.projectId, result.project, version)
  })
}
export async function exportAudioEdit(request: AudioEditExportRequest): Promise<AudioEditExportResult> {
  return withAudioEditProjectOperation(request.projectId, () => getPlatform().audioEdit.exportProject(request))
}
export async function prepareAudioEditProcessing(projectId: string, requestId: string): Promise<void> {
  return withAudioEditProjectOperation(projectId, () => getPlatform().audioEdit.prepareProcessing(projectId, requestId))
}
export async function relinkAudioEdit(projectId: string, sourcePath: string): Promise<AudioEditProjectDocument> {
  return withAudioEditProjectOperation(projectId, async (instance) => {
    const result = await getPlatform().audioEdit.relinkSource(projectId, sourcePath)
    acceptAudioEditNativeResult(projectId, result, instance.version)
    return result
  })
}
export async function deleteAudioEdit(projectId: string): Promise<void> {
  await withAudioEditProjectOperation(projectId, () => getPlatform().audioEdit.deleteProject(projectId))
  releaseAudioEditProject(projectId)
}
