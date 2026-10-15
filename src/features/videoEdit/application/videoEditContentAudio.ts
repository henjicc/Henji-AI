import { VideoEditContentAudio, codeAudioComposition } from '../engine/videoEditContentAudio'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditComposition, type VideoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import type { AudioContentAnalysis } from '@/core/audioAnalysis/contentAnalysis'
import { requireVideoEditInstance, holdVideoEditActivity, subscribeVideoEdit, listVideoEditInstances } from './videoEditService'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'

type MediaAudioAnalysis = Pick<AudioContentAnalysis, 'fps' | 'bpm' | 'beats' | 'onsets' | 'beatsPerBar' | 'barOrigin'>
const analyses = new WeakMap<ReturnType<typeof requireVideoEditInstance>, Map<string, { identity: string; data: MediaAudioAnalysis }>>()
const tasks = new WeakMap<ReturnType<typeof requireVideoEditInstance>, { controller: AbortController; progress: number }>()
function identity(document: VideoEditComposition, mediaId: string): string { return JSON.stringify([document.media.find(media => media.id === mediaId), document.sampleRate, document.fps]) }
export function readVideoEditMediaAudio(projectId: string, mediaId: string): MediaAudioAnalysis | undefined {
  const owner = requireVideoEditInstance(projectId), entry = analyses.get(owner)?.get(mediaId)
  if (!entry || !owner.document.sequences.some(sequence => entry.identity === identity(videoEditComposition(owner.document, sequence.id), mediaId))) return undefined
  return entry.data
}
export function videoEditContentAudioProgress(projectId: string): number | null { return tasks.get(requireVideoEditInstance(projectId))?.progress ?? null }
export async function analyzeVideoEditMediaAudio(projectId: string, sequenceId: string, mediaId: string, signal?: AbortSignal): Promise<MediaAudioAnalysis> {
  const owner = requireVideoEditInstance(projectId), version = owner.contentVersion
  if (tasks.has(owner)) throw new Error('已有音频分析正在进行。')
  const controller = new AbortController(), abort = (): void => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const unsubscribe = subscribeVideoEdit(() => { if (!listVideoEditInstances().includes(owner) || !isVideoEditContentCurrent(owner, version)) controller.abort(new Error('剪辑已关闭或修改，请重新分析。')) })
  const release = holdVideoEditActivity(projectId, '分析音频')
  const task = { controller, progress: 0 }; tasks.set(owner, task)
  const cache = new VideoEditContentAudio(document => {
    const renderer = new VideoEditRenderSession(document, 1)
    return { async mixAudio(start, duration) { const audio = await renderer.mixAudio(start, duration); return Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel).slice()) }, dispose: () => renderer.dispose() }
  })
  try {
    controller.signal.throwIfAborted()
    const document = videoEditComposition(owner.document, sequenceId)
    const media = document.media.find(media => media.id === mediaId)
    if (!media || !['audio', 'video'].includes(media.kind)) throw new Error('请选择音频或视频素材。')
    const cached = readVideoEditMediaAudio(projectId, mediaId)
    if (cached?.fps === document.fps) return cached
    const base: VideoEditClip = { id: 'audio-analysis', itemId: 'audio-analysis', name: media.name, kind: 'audio', track: 0, start: 0, duration: 1, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
    const source = codeAudioComposition(document, base, mediaId)
    const { fps, bpm, beats, onsets, beatsPerBar, barOrigin } = await cache.analyze(source.document, source.start, source.duration, controller.signal, value => { task.progress = value })
    const data: MediaAudioAnalysis = { fps, bpm, beats, onsets, beatsPerBar, barOrigin }
    controller.signal.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, version)) throw new Error('剪辑已修改，请重新分析。')
    let entries = analyses.get(owner); if (!entries) { entries = new Map(); analyses.set(owner, entries) }
    // Summary readers need no PCM or frame arrays; bound the per-project results.
    if (entries.size >= 16) entries.delete(entries.keys().next().value!)
    entries.set(mediaId, { identity: identity(document, mediaId), data })
    return data
  } finally { signal?.removeEventListener('abort', abort); unsubscribe(); release(); tasks.delete(owner); cache.clear() }
}
