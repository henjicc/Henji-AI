import type { AudioContentAnalysis } from '@/core/audioAnalysis/contentAnalysis'
import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditAudioContent } from '@/core/videoEdit/audioContent'
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
    if (!identity) { identity = videoEditAudioContent(document); this.identities.set(document, identity) }
    const key = `${start}:${duration}:${identity}`
    const cached = this.cache.get(key)
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); progress?.(1); return cached }
    const renderer = this.mixer(document)
    let disposing: Promise<void> | undefined
    const dispose = (): Promise<void> => disposing ??= renderer.dispose()
    let rejectCancelled!: (reason: unknown) => void
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
    void cancelled.catch(() => undefined)
    const abort = (): void => {
      rejectCancelled(signal.reason ?? new DOMException('声音分析已取消。', 'AbortError'))
      void dispose().catch(error => logger.warn('取消后的声音资源释放失败', { event: 'video_edit.content_audio.dispose_failed', error }))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    logger.debug('内容音频分析开始', { event: 'video_edit.content_audio.start', context: { sequenceId: document.id, start, duration } })
    try {
      const blocks = async function* (): AsyncGenerator<Float32Array[]> {
        // Integer sample boundaries preserve the exact same PCM regardless of chunk partition.
        const first = Math.ceil(start * document.sampleRate - 1e-7), end = Math.ceil((start + duration) * document.sampleRate - 1e-7)
        for (let sample = first; sample < end;) {
          signal.throwIfAborted()
          const next = Math.min(end, sample + document.sampleRate)
          const planes = await Promise.race([renderer.mixAudio(sample / document.sampleRate, (next - sample) / document.sampleRate), cancelled])
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
    } finally { signal.removeEventListener('abort', abort); await dispose() }
  }
  private size(data: AudioContentAnalysis): number { return (data.levels.length * 4 + data.beats.length + data.onsets.length) * 8 }
}
