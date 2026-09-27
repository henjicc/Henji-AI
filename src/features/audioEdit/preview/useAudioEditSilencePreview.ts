import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioEditProjectDocument, AudioEditRange, AudioEditSuggestion } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, cleanAudioEditFillers, DEFAULT_AUDIO_EDIT_SETTINGS, subtractRanges } from '@/core/audioEdit/edits'
import { buildProjectAudioEditTimeline } from '@/core/audioEdit/timeline'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { flushAudioEditProject } from '../application/audioEditProjectInstances'

const logger = createLogger('features.audioEdit.silencePreview')

export function useAudioEditSilencePreview(project: AudioEditProjectDocument | null, range: AudioEditRange | undefined, enabled: boolean) {
  const key = JSON.stringify(project ? [project.id, project.source, project.transcript, project.cuts, project.suggestions, project.batchSettings, range] : null)
  const latest = useRef({ project, range })
  latest.current = { project, range }
  const [result, setResult] = useState<{ key: string; suggestions: AudioEditSuggestion[]; error?: string } | null>(null)
  useEffect(() => {
    if (!enabled || !latest.current.project) return
    let disposed = false
    let started = false
    const requestId = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      const { project: snapshot, range: selection } = latest.current
      if (!snapshot) return
      void (async () => {
        try {
          await flushAudioEditProject(snapshot.id)
          if (disposed) return
          started = true
          const detected = await getPlatform().audioEdit.detectSilence({ projectId: snapshot.id, settings: snapshot.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS, range: selection, requestId })
          if (!disposed) setResult({ key, suggestions: detected.suggestions })
        } catch (error) {
          if (!disposed) {
            logger.warn('audio_edit.silence_preview.failed', { projectId: snapshot.id, error: String(error) })
            setResult({ key, suggestions: [], error: '停顿预览失败，请重试或检查原素材。' })
          }
        }
      })()
    }, 450)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      if (started) void getPlatform().audioEdit.cancelTask(requestId).catch((error: unknown) => logger.warn('audio_edit.silence_preview.cancel_failed', { error: String(error) }))
    }
  }, [key, enabled])
  const ranges = useMemo(() => {
    if (!project || !enabled) return []
    const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    let draft = cleanAudioEditFillers(project, settings.fillers, range)
    if (result?.key === key && !result.error) {
      const completed = new Set(project.suggestions.filter((item) => item.status !== 'pending').map((item) => item.id))
      const suggestions = result.suggestions.filter((item) => !completed.has(item.id))
      draft = { ...draft, suggestions }
      for (const suggestion of suggestions) draft = applyAudioEditSuggestion(draft, suggestion.id)
    }
    return subtractRanges(buildProjectAudioEditTimeline(project).map((span) => ({ startFrame: span.sourceStartFrame, endFrame: span.sourceEndFrame })), buildProjectAudioEditTimeline(draft).map((span) => ({ startFrame: span.sourceStartFrame, endFrame: span.sourceEndFrame })))
  }, [project, enabled, result, key, range])
  return { ranges, pending: enabled && result?.key !== key, error: result?.key === key ? result.error : undefined }
}
