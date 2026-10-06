import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { createLogger } from '@/core/logging'
import { audioEditProjectFromDocument } from '@/core/audioEdit/documentContent'
import { getPlatform } from '@/platform/runtime'
import { requireVideoEditInstance, videoEditDocumentOperations, type VideoEditInstance } from './videoEditService'
import { prepareVideoEditSubtitleAudio, generateVideoEditSubtitles, type SubtitleScope, type SubtitleTranscriptionOptions } from './videoEditAutoSubtitles'

const logger = createLogger('features.videoEdit.subtitleJobs')
export interface SubtitleJob {
  state: 'preparing' | 'confirming' | 'transcribing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  audioDocumentId?: string
  error?: string
  controller: AbortController
}
const jobs = new WeakMap<VideoEditInstance, Map<string, SubtitleJob>>()
const listeners = new Set<() => void>(); let revision = 0
function publish(): void { revision++; listeners.forEach(listener => listener()) }
export function subscribeSubtitleJobs(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function subtitleJobsRevision(): number { return revision }
export function readSubtitleJob(owner: VideoEditInstance, sequenceId: string): SubtitleJob | undefined { return jobs.get(owner)?.get(sequenceId) }
export function cancelSubtitleJob(owner: VideoEditInstance, sequenceId: string): void { readSubtitleJob(owner, sequenceId)?.controller.abort(new Error('字幕处理已取消。')) }
export async function runVideoEditSubtitleJob(owner: VideoEditInstance, sequenceId: string, scope: SubtitleScope, trackId: string | undefined, options: SubtitleTranscriptionOptions, resumeAudioId?: string): Promise<void> {
  const previous = readSubtitleJob(owner, sequenceId)
  if (previous && ['preparing', 'confirming', 'transcribing'].includes(previous.state)) throw new Error('字幕正在处理，请等待或取消。')
  const map = jobs.get(owner) ?? new Map<string, SubtitleJob>(); jobs.set(owner, map)
  const job: SubtitleJob = { state: 'preparing', progress: 0, controller: new AbortController(), audioDocumentId: resumeAudioId }; map.set(sequenceId, job); publish()
  const { signal } = job.controller
  try {
    job.audioDocumentId ??= await prepareVideoEditSubtitleAudio(owner.document.id, sequenceId, scope, trackId, signal, progress => { job.progress = progress; publish() })
    job.state = 'confirming'; publish()
    const accepted = await requestAlertConfirmation({ title: '转录并生成字幕', message: '复用口播识别：使用已配置、支持时间戳的语音模型。识别按该模型计费；若已有转录结果，继续整理字幕不会重复识别。是否继续？', type: 'warning', confirmLabel: '确认转录' }, signal)
    if (!accepted) { job.state = 'cancelled'; return }
    signal.throwIfAborted()
    if (requireVideoEditInstance(owner.document.id) !== owner) throw new Error('原剪辑已关闭，请重新准备字幕。')
    job.state = 'transcribing'; publish()
    await generateVideoEditSubtitles(owner.document.id, sequenceId, job.audioDocumentId, undefined, options, signal)
    job.state = 'completed'
  } catch (error) {
    job.state = signal.aborted ? 'cancelled' : 'failed'; job.error = error instanceof Error ? error.message : String(error)
    if (!signal.aborted) throw error
  } finally { publish() }
}

/** Reopen recovers only this module's saved project-local mixes, never unrelated voiceover documents. */
export async function findRecoverableSubtitleAudio(owner: VideoEditInstance, sequenceId: string): Promise<string | undefined> {
  const operations = videoEditDocumentOperations()
  const documents = await operations.listDocuments({ kind: 'audio_edit', container: owner.session.documentMeta.container, includeDrafts: true, includeMissing: false })
  for (const document of documents.sort((a, b) => b.updatedAt - a.updatedAt)) {
    try {
      const read = await operations.readDocument({ id: document.id })
      const source = audioEditProjectFromDocument(read.meta, read.content).project.source.sourcePath
      const path = `${source}.subtitle.json`
      if (!await getPlatform().system.fs.exists(path)) continue
      const manifest: unknown = JSON.parse(await getPlatform().system.fs.readTextFile(path))
      if (typeof manifest === 'object' && manifest !== null && 'projectId' in manifest && 'sequenceId' in manifest && !('committed' in manifest && manifest.committed === true) && manifest.projectId === owner.document.id && manifest.sequenceId === sequenceId) return document.id
    } catch (error) { logger.warn('字幕恢复记录无法读取', { event: 'video_edit.subtitle.recovery.failed', error, context: { audioDocumentId: document.id } }) }
  }
  return undefined
}
