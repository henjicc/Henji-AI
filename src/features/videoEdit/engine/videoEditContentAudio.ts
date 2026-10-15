import type { AudioContentAnalysis } from '@/core/audioAnalysis/contentAnalysis'
import { createLogger } from '@/core/logging'
import { videoEditClipSchema, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { analyzeVideoEditBeatsOffThread } from '../application/videoEditBeatWorkerClient'

export interface ContentAudioMixer { mixAudio(start: number, duration: number): Promise<Float32Array[]>; dispose(): Promise<void> }
const logger = createLogger('features.videoEdit.contentAudio')
/** Bounded completed results only. Cancelled or failed analysis never poisons the cache. */
export class VideoEditContentAudio {
  private readonly cache = new Map<string, AudioContentAnalysis>()
  private bytes = 0
  private identities = new WeakMap<VideoEditComposition, string>()
  constructor(private readonly mixer: (document: VideoEditComposition) => ContentAudioMixer) {}
  clear(): void { this.cache.clear(); this.bytes = 0; this.identities = new WeakMap() }
  async analyze(document: VideoEditComposition, start: number, duration: number, signal: AbortSignal, progress?: (value: number) => void): Promise<AudioContentAnalysis> {
    signal.throwIfAborted()
    if (![start, duration].every(Number.isFinite) || start < 0 || duration <= 0) throw new Error('音频分析区间无效。')
    let identity = this.identities.get(document)
    if (!identity) { identity = JSON.stringify(document); this.identities.set(document, identity) }
    const key = `${start}:${duration}:${identity}`
    const cached = this.cache.get(key)
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); progress?.(1); return cached }
    const renderer = this.mixer(document)
    logger.debug('内容音频分析开始', { event: 'video_edit.content_audio.start', context: { sequenceId: document.id, start, duration } })
    try {
      const blocks = async function* (): AsyncGenerator<Float32Array[]> {
        // Integer sample boundaries preserve the exact same PCM regardless of chunk partition.
        const first = Math.ceil(start * document.sampleRate - 1e-7), end = Math.ceil((start + duration) * document.sampleRate - 1e-7)
        for (let sample = first; sample < end;) {
          signal.throwIfAborted()
          const next = Math.min(end, sample + document.sampleRate)
          const planes = await renderer.mixAudio(sample / document.sampleRate, (next - sample) / document.sampleRate)
          signal.throwIfAborted(); yield planes; sample = next; progress?.((sample - first) / (end - first))
        }
      }
      const result = await analyzeVideoEditBeatsOffThread(document.sampleRate, blocks(), signal, document.fps)
      signal.throwIfAborted()
      const size = this.size(result)
      {
        // Keep at least the just-completed interval, even if it exceeds the soft budget;
        // otherwise every frame of a long clip would restart the same offline analysis.
        while ((this.bytes + size > 32 * 1024 ** 2 || this.cache.size >= 32) && this.cache.size) { const oldest = this.cache.keys().next().value!; this.bytes -= this.size(this.cache.get(oldest)!); this.cache.delete(oldest) }
        this.cache.set(key, result); this.bytes += size
      }
      logger.debug('内容音频分析完成', { event: 'video_edit.content_audio.completed', context: { sequenceId: document.id, bpm: result.bpm, frames: result.levels.length } })
      return result
    } catch (error) {
      if (!signal.aborted) logger.warn('内容音频分析失败', { event: 'video_edit.content_audio.failed', error, context: { sequenceId: document.id } })
      throw error
    } finally { await renderer.dispose() }
  }
  private size(data: AudioContentAnalysis): number { return (data.levels.length * 4 + data.beats.length + data.onsets.length) * 8 }
}

type AudioComposition = { document: VideoEditComposition; start: number; duration: number }
const compositions = new WeakMap<VideoEditComposition, Map<string, AudioComposition>>()
export function codeAudioComposition(document: VideoEditComposition, clip: VideoEditClip, mediaId?: string): AudioComposition {
  let entries = compositions.get(document)
  if (!entries) { entries = new Map(); compositions.set(document, entries) }
  const key = JSON.stringify([clip.id, clip.start, clip.duration, clip.track, mediaId])
  let result = entries.get(key)
  if (!result) { result = audioComposition(document, clip, mediaId); entries.set(key, result) }
  return result
}
function audioComposition(document: VideoEditComposition, clip: VideoEditClip, mediaId?: string): AudioComposition {
  if (mediaId) {
    const media = document.media.find(media => media.id === mediaId && ['audio', 'video'].includes(media.kind))
    if (!media) throw new Error('音频参数引用的音频或视频素材不存在。')
    const item = document.items.find(item => item.mediaId === media.id)
    if (!item) throw new Error('音频素材项不存在。')
    const source = videoEditClipSchema.parse({ id: 'content-audio', itemId: item.id, name: media.name, kind: media.kind, start: 0, track: 0, duration: Math.max(1, Math.ceil(media.durationSeconds * document.fps)), sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, text: '', volume: 1 })
    return { document: { ...document, clips: [source], transitions: [], tracks: [{ id: 'content-audio', name: '音频', kind: 'audio', index: 0, enabled: true, muted: false, solo: false, locked: false }] }, start: 0, duration: Math.max(1 / document.fps, media.durationSeconds) }
  }
  const clips = document.clips.filter(candidate => candidate.id !== clip.id && candidate.track < clip.track)
  const ids = new Set(clips.map(candidate => candidate.id))
  return { document: { ...document, clips, transitions: document.transitions?.filter(transition => (!transition.leftClipId || ids.has(transition.leftClipId)) && (!transition.rightClipId || ids.has(transition.rightClipId))) }, start: clip.start / document.fps, duration: clip.duration / document.fps }
}
