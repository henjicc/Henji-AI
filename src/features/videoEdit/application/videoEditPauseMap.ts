import { createLogger } from '@/core/logging'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import type { SpeechTimings } from '@/core/media/speechTimings'
import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditTextMediaIdentity, videoEditTranscriptWords } from '@/core/videoEdit/textTranscript'
import { subtitleFrameBoundary } from '@/core/videoEdit/subtitleStyleProfiles'
import { getPlatform } from '@/platform/runtime'
import { readGenerationResultTimings } from '@/features/generation'
import { getDocumentOperations } from '@/features/documents'
import { loadAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.pauseMap')
export interface VideoEditPause { startFrame: number; endFrame: number; durationMs: number; kind: 'silence' | 'breath' | 'punct' }

export async function readClipSpeechTimings(projectId: string, sequenceId: string, clipId: string): Promise<SpeechTimings | undefined> {
  const composition = videoEditComposition(requireVideoEditInstance(projectId).document, sequenceId)
  const clip = composition.clips.find(value => value.id === clipId)
  const media = composition.media.find(value => value.id === composition.items.find(item => item.id === clip?.itemId)?.mediaId)
  if (!clip || !media) throw new Error('请选择引用声音素材的片段。')
  const source = composition.textTranscription?.sources.find(value => value.itemId === clip.itemId && value.mediaIdentity === videoEditTextMediaIdentity(composition, clip.itemId) && (value.audioMappingIdentity === undefined || value.audioMappingIdentity === JSON.stringify(clip.audioMapping ?? null)))
  let fallback: SpeechTimings | undefined = source?.blocks.length ? { granularity: source.blocks.every(block => block.granularity === 'word') ? 'word' : 'sentence', items: source.blocks.map(block => ({ text: block.text, startMs: block.startFrame / 1000, endMs: block.endFrame / 1000 })) } : undefined
  if (fallback?.granularity === 'word') return fallback
  if (media.creativeSource?.type === 'generation') {
    const origin = media.creativeSource
    const native = (await readGenerationResultTimings(origin.recordId)).find(value => value.outputIndex === origin.outputIndex)?.timings
    if (native?.items.length) { if (native.granularity === 'word') return native; fallback ??= native }
  }
  const summaries = await getDocumentOperations().listDocuments({ kind: 'audio_edit', container: { kind: 'any' }, includeDrafts: true, includeMissing: false })
  // Background load uses the same document session; it never opens an editor surface.
  for (const summary of summaries.filter(summary => summary.summary.mediaType !== null)) {
    const audio = await loadAudioEditProject(summary.id)
    if (audio.document.source.sourcePath !== media.path || !audio.document.transcript.length) continue
    const saved: SpeechTimings = { granularity: audio.document.transcript.every(block => block.granularity === 'word') ? 'word' : 'sentence', items: audio.document.transcript.filter(block => block.included).map(block => ({ text: block.text, startMs: block.startFrame * 1000 / audio.document.source.sampleRate, endMs: block.endFrame * 1000 / audio.document.source.sampleRate })) }
    if (saved.granularity === 'word') return saved
    fallback ??= saved
  }
  return fallback
}

/** Existing FFmpeg silence detector, with a source-only read path and a short evidence floor. */
export async function readClipEnergyPauses(projectId: string, sequenceId: string, clipId: string, signal?: AbortSignal) {
  const composition = videoEditComposition(requireVideoEditInstance(projectId).document, sequenceId)
  const clip = composition.clips.find(value => value.id === clipId)
  const media = composition.media.find(value => value.id === composition.items.find(item => item.id === clip?.itemId)?.mediaId)
  if (!clip || !media || !['audio', 'video'].includes(clip.kind)) throw new Error('请选择引用声音素材的片段。')
  return readSourceEnergyPauses(media.path, signal, videoEditClipSourceRange(clip, composition.fps))
}

export async function readSourceEnergyPauses(sourcePath: string, signal?: AbortSignal, range?: { from: number; to: number }) {
  const requestId = crypto.randomUUID(); const platform = getPlatform()
  const cancel = () => { void platform.audioEdit.cancelTask(requestId).catch(error => logger.warn('停顿图取消失败', { event: 'video_edit.pause_map.cancel_failed', error })) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    const source = await platform.audioEdit.probeSource(sourcePath, requestId)
    signal?.throwIfAborted()
    const result = await platform.audioEdit.detectSilence({ sourcePath, requestId,
      settings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, silenceThresholdMs: 100, retainedSilenceMs: 0, trimEdges: true },
      ...(range ? { range: { startFrame: Math.floor(range.from * source.sampleRate), endFrame: Math.ceil(range.to * source.sampleRate) } } : {}) })
    signal?.throwIfAborted()
    return result.suggestions.map(value => ({ startMs: value.startFrame * 1000 / source.sampleRate, endMs: value.endFrame * 1000 / source.sampleRate }))
  } finally { signal?.removeEventListener('abort', cancel) }
}

export async function getVideoEditClipPauseMap(projectId: string, sequenceId: string, clipId: string, signal?: AbortSignal): Promise<{ pauses: VideoEditPause[]; words: Array<{ text: string; startFrame: number; endFrame: number }>; source: 'words' | 'energy' }> {
  const owner = requireVideoEditInstance(projectId); const snapshot = owner.document
  const composition = videoEditComposition(snapshot, sequenceId); const clip = composition.clips.find(value => value.id === clipId)
  if (!clip) throw new Error('找不到目标片段。')
  logger.info('片段停顿图开始', { event: 'video_edit.pause_map.start', context: { projectId, sequenceId, clipId } })
  try {
    const saved = videoEditTranscriptWords(composition, [clipId])
    const timings = saved.length && saved.every(word => word.granularity === 'word') ? undefined : await readClipSpeechTimings(projectId, sequenceId, clipId)
    const map = (startMs: number, endMs: number) => {
      const a = videoEditClipFrameBoundaryAtSource(clip, startMs / 1000, composition.fps); const b = videoEditClipFrameBoundaryAtSource(clip, endMs / 1000, composition.fps)
      return { startFrame: Math.max(clip.start, subtitleFrameBoundary(Math.min(a, b))), endFrame: Math.min(clip.start + clip.duration, subtitleFrameBoundary(Math.max(a, b))) }
    }
    const words = (saved.length && saved.every(word => word.granularity === 'word') ? saved.map(word => ({ text: word.text,
      // Direct saved blocks retain microsecond source boundaries; avoid reusing outward-rounded text selections.
      ...(word.sourceVoiceId ? { startFrame: word.from, endFrame: word.to } : map(word.startFrame / 1000, word.endFrame / 1000)) }))
      : timings?.granularity === 'word' ? timings.items.map(item => ({ text: item.text, ...map(item.startMs, item.endMs) })) : []).filter(word => word.endFrame > word.startFrame).sort((a, b) => a.startFrame - b.startFrame)
    const gaps = words.slice(1).map((word, index) => (word.startFrame - words[index].endFrame) / composition.fps * 1000)
    const pauses: VideoEditPause[] = words.length ? words.slice(1).flatMap((word, index) => {
      const previous = words[index]; const durationMs = gaps[index]
      const punct = /[，。？！；：、…,.!?;:]$/u.test(previous.text)
      return durationMs > 0 ? [{ startFrame: previous.endFrame, endFrame: word.startFrame, durationMs, kind: punct ? 'punct' as const : 'breath' as const }] : []
    }) : (await readClipEnergyPauses(projectId, sequenceId, clipId, signal)).map(pause => {
      const range = map(pause.startMs, pause.endMs)
      return { ...range, durationMs: (range.endFrame - range.startFrame) / composition.fps * 1000, kind: 'silence' as const }
    }).filter(pause => pause.endFrame > pause.startFrame)
    signal?.throwIfAborted()
    if (owner.document !== snapshot) throw new Error('检测期间片段已改变，请重新读取停顿图。')
    logger.info('片段停顿图完成', { event: 'video_edit.pause_map.completed', context: { projectId, clipId, count: pauses.length, source: words.length ? 'words' : 'energy' } })
    return { pauses, words, source: words.length ? 'words' : 'energy' }
  } catch (error) { logger.error('片段停顿图失败', { event: 'video_edit.pause_map.failed', context: { projectId, clipId }, error }); throw error }
}
