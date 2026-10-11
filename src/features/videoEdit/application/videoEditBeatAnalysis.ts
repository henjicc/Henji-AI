import { createLogger } from '@/core/logging'
import { videoEditComposition, audibleVideoEditClips } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import type { VideoEditMarker } from '@/core/videoEdit/timedContent'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { analyzeVideoEditBeatsOffThread } from './videoEditBeatWorkerClient'
import { videoEditClipHasSound } from './videoEditLoudness'
import { editVideoSequence, holdVideoEditActivity, listVideoEditInstances, requireVideoEditInstance, subscribeVideoEdit, type VideoEditInstance } from './videoEditService'

export interface VideoEditBeatTarget { projectId: string; sequenceId: string; clipId?: string }
interface BeatTask { controller: AbortController; progress: number }
const tasks = new WeakMap<VideoEditInstance, BeatTask>()
const listeners = new Set<() => void>(); let revision = 0
const logger = createLogger('features.videoEdit.beatAnalysis')
export function subscribeVideoEditBeats(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditBeatRevision(): number { return revision }
function publish(): void { revision++; listeners.forEach(listener => listener()) }
export function videoEditBeatTask(projectId: string): BeatTask | undefined { return tasks.get(requireVideoEditInstance(projectId)) }
export function cancelVideoEditBeatAnalysis(projectId: string): void { videoEditBeatTask(projectId)?.controller.abort(); publish() }

/** UI and assistant share PCM rendering, cancellable Worker analysis and one marker transaction. */
export async function analyzeVideoEditBeats(target: VideoEditBeatTarget, signal?: AbortSignal): Promise<VideoEditMarker[]> {
  const owner = requireVideoEditInstance(target.projectId), baseline = owner.document
  if (tasks.has(owner)) throw new Error('正在分析节拍，请稍候或取消。')
  const composition = structuredClone(videoEditComposition(baseline, target.sequenceId))
  const clip = target.clipId ? composition.clips.find(c => c.id === target.clipId) : undefined
  if (target.clipId && (!clip || !videoEditClipHasSound(composition, clip))) throw new Error('请选择带声音的片段分析节拍。')
  if (clip) assertVideoEditClipsEditable(composition, [clip.id])
  const clips = clip ? [clip] : audibleVideoEditClips(composition).filter(c => videoEditClipHasSound(composition, c))
  if (!clips.length) throw new Error('序列没有可分析的声音。')
  const start = clips.reduce((min, c) => Math.min(min, c.start), Infinity), end = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0)
  // Explicit clip analysis ignores track mute/solo, while sequence analysis uses the actual audible mix.
  const source = clip ? { ...composition, clips: [clip], transitions: [], tracks: composition.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })) } : composition
  const task: BeatTask = { controller: new AbortController(), progress: 0 }
  const abort = (): void => task.controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const assertCurrent = (): void => {
    task.controller.signal.throwIfAborted()
    if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('剪辑已有修改或已关闭，请重新分析节拍。')
  }
  const unsubscribe = subscribeVideoEdit(() => { if (!listVideoEditInstances().includes(owner)) task.controller.abort() })
  const release = holdVideoEditActivity(target.projectId, '分析节拍')
  tasks.set(owner, task); publish()
  let renderer: VideoEditRenderSession | undefined
  logger.info('节拍分析开始', { event: 'video_edit.beats.start', context: { projectId: target.projectId, sequenceId: target.sequenceId, clipId: target.clipId } })
  try {
    assertCurrent(); renderer = new VideoEditRenderSession(source, 1)
    const blocks = async function* (): AsyncGenerator<Float32Array[]> {
      for (let frame = start; frame < end;) {
        assertCurrent()
        const next = Math.min(end, frame + Math.max(1, Math.round(composition.fps)))
        const buffer = await renderer!.mixAudio(frame / composition.fps, (next - frame) / composition.fps)
        assertCurrent()
        // Copies isolate the render session's cached AudioBuffers from transfer detachment.
        yield Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice())
        frame = next; task.progress = (frame - start) / (end - start); publish()
      }
    }
    const result = await analyzeVideoEditBeatsOffThread(composition.sampleRate, blocks(), task.controller.signal)
    assertCurrent()
    if (!result.beats.length) throw new Error('未找到稳定节拍，请换一段声音。')
    const byFrame = new Map<number, VideoEditMarker>()
    for (const beat of result.beats) {
      const frame = start + Math.round(beat.seconds * composition.fps)
      if (frame >= end) continue
      const existing = byFrame.get(frame)
      if (!existing || beat.strength > (existing.strength ?? 0)) byFrame.set(frame, { id: crypto.randomUUID(), frame, name: beat.strength >= .7 ? '重音' : '节拍', type: 'beat', strength: beat.strength, ...(clip ? { clipId: clip.id } : {}) })
    }
    const markers = [...byFrame.values()]
    editVideoSequence(target.projectId, target.sequenceId, sequence => ({ ...sequence, markers: [...(sequence.markers ?? []).filter(mark => mark.type !== 'beat' || mark.clipId !== target.clipId), ...markers] }))
    logger.info('节拍分析完成', { event: 'video_edit.beats.completed', context: { projectId: target.projectId, beats: markers.length, onsets: result.onsets.length, tempo: result.tempo } })
    return markers
  } catch (error) {
    if (task.controller.signal.aborted) logger.info('节拍分析已取消', { event: 'video_edit.beats.cancelled', context: { projectId: target.projectId } })
    else logger.error('节拍分析失败', error, { event: 'video_edit.beats.failed', context: { projectId: target.projectId } })
    throw error
  } finally {
    signal?.removeEventListener('abort', abort); unsubscribe(); tasks.delete(owner); release(); publish(); await renderer?.dispose()
  }
}
