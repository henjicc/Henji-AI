import type { AudioEditPreviewChunk, AudioEditPreviewMode, AudioEditProjectDocument, AudioEditTimelineSpan } from '@/core/audioEdit/types'
import { applyAudioEditSpliceFade, buildAudioEditSpliceFades, type AudioEditSpliceFade } from '@/core/audioEdit/spliceDeclick'
import { getPlatform } from '@/platform/runtime'
import { flushAudioEditProject } from '../application/audioEditProjectInstances'

/** 一秒对齐的 LRU；只保留 30 秒 PCM，传给 worklet 的始终是副本，缓存不会被 transfer 摘走。 */
export class PreviewChunkCache {
  private readonly blocks = new Map<number, Promise<AudioEditPreviewChunk>>()
  private flushed: Promise<void> | undefined
  private readonly fades: readonly AudioEditSpliceFade[]

  constructor(private readonly project: AudioEditProjectDocument, private readonly mode: AudioEditPreviewMode, private readonly spans: readonly AudioEditTimelineSpan[]) {
    this.fades = buildAudioEditSpliceFades(spans, project.source.sampleRate)
  }

  private block(frame: number): Promise<AudioEditPreviewChunk> {
    const { sampleRate, durationFrames } = this.project.source
    const start = Math.floor(frame / sampleRate) * sampleRate
    const existing = this.blocks.get(start)
    if (existing) { this.blocks.delete(start); this.blocks.set(start, existing); return existing }
    const pending = (async () => {
      if (this.mode !== 'source') {
        this.flushed ??= flushAudioEditProject(this.project.id)
        await this.flushed
      }
      return getPlatform().audioEdit.preparePreviewChunk({ projectId: this.project.id, sourceStartFrame: start, frameCount: Math.min(sampleRate, durationFrames - start), mode: this.mode === 'source' ? 'source' : 'edited', processing: this.mode === 'edited' && this.project.vstEnabled })
    })()
    this.blocks.set(start, pending)
    if (this.blocks.size > 30) this.blocks.delete(this.blocks.keys().next().value!)
    void pending.catch(() => { if (this.blocks.get(start) === pending) this.blocks.delete(start); this.flushed = undefined })
    return pending
  }

  async read(cursor: number, limit: number): Promise<AudioEditPreviewChunk | null> {
    let index = this.spans.findIndex(candidate => cursor >= candidate.sourceStartFrame && cursor < candidate.sourceEndFrame)
    if (index < 0) index = this.spans.findIndex(candidate => candidate.sourceStartFrame >= cursor)
    if (index < 0) return null
    const span = this.spans[index]
    const start = Math.max(cursor, span.sourceStartFrame)
    const { sampleRate, durationFrames, channels } = this.project.source
    const count = Math.min(limit, span.sourceEndFrame - start, (Math.floor(start / sampleRate) + 1) * sampleRate - start)
    const silent = span.muted || start < 0 || start >= durationFrames
    if (silent) return { sourceStartFrame: start, sourceEndFrame: start + count, channels, sampleRate, pcm: new Float32Array(count * channels).buffer }
    const block = await this.block(start)
    const end = Math.min(start + count, block.sourceEndFrame)
    if (end <= start) throw new Error('此位置无法读取音频，请重新定位后重试')
    const samples = new Float32Array(block.pcm, (start - block.sourceStartFrame) * block.channels * 4, (end - start) * block.channels)
    const pcm = this.mode === 'source' ? samples.slice() : applyAudioEditSpliceFade(samples, block.channels, start - span.sourceStartFrame, this.fades[index])
    return { ...block, sourceStartFrame: start, sourceEndFrame: end, pcm: pcm.buffer as ArrayBuffer }
  }

  async grain(frame: number): Promise<{ pcm: ArrayBuffer; channels: number }> {
    const channels = this.project.source.channels
    const count = Math.round(this.project.source.sampleRate * 0.08)
    const pcm = new Float32Array(count * channels)
    let written = 0
    let cursor = frame
    while (written < count) {
      const chunk = await this.read(cursor, count - written)
      if (!chunk) break
      const frames = chunk.sourceEndFrame - chunk.sourceStartFrame
      pcm.set(new Float32Array(chunk.pcm), written * channels)
      written += frames
      cursor = chunk.sourceEndFrame
    }
    return { pcm: pcm.buffer.slice(0, written * channels * 4), channels }
  }

  async prefetch(frame: number): Promise<void> {
    // 先读当前位置及两侧一秒；跨删除区间仍通过同一时间线取样。
    await Promise.all([frame, frame - this.project.source.sampleRate, frame + this.project.source.sampleRate]
      .map(cursor => this.read(Math.max(0, cursor), 1)))
  }
}
