import type { AudioEditPreviewChunk, AudioEditPreviewMode, AudioEditProjectDocument, AudioEditTimelineSpan } from '@/core/audioEdit/types'
import { AudioEditSpliceRenderer } from '@/core/audioEdit/spliceCrossfade'
import { getPlatform } from '@/platform/runtime'
import { flushAudioEditProject } from '../application/audioEditProjectInstances'

/**
 * 一份声音（原素材，或修复、整段效果、区间音量之后的剪后声音；都按源时间）的一秒块。
 * 删除、静音只改拼接表，不改这里的声音：换拼接表时把同一份接着交给新的 PreviewChunkCache，剪完马上播放不必重新向主进程要一遍。
 * 一秒对齐的 LRU；只保留 30 秒 PCM，传给 worklet 的始终是副本，缓存不会被 transfer 摘走。
 */
export class PreviewSoundBlocks {
  private readonly blocks = new Map<number, Promise<AudioEditPreviewChunk>>()
  private flushed: Promise<void> | undefined

  constructor(private readonly project: Pick<AudioEditProjectDocument, 'id' | 'source'>, private readonly kind: 'source' | 'edited') {}

  /** 按源帧读一段声音（可跨一秒块、可落在被删部分），越界补零。 */
  async readSource(startFrame: number, frameCount: number): Promise<Float32Array> {
    const { durationFrames, channels } = this.project.source
    const output = new Float32Array(Math.max(0, frameCount) * channels)
    for (let cursor = Math.max(0, startFrame); cursor < Math.min(durationFrames, startFrame + frameCount);) {
      const block = await this.block(cursor)
      const end = Math.min(startFrame + frameCount, block.sourceEndFrame)
      if (end <= cursor) break
      output.set(new Float32Array(block.pcm, (cursor - block.sourceStartFrame) * channels * 4, (end - cursor) * channels), (cursor - startFrame) * channels)
      cursor = end
    }
    return output
  }

  block(frame: number): Promise<AudioEditPreviewChunk> {
    const { sampleRate, durationFrames } = this.project.source
    const start = Math.floor(frame / sampleRate) * sampleRate
    const existing = this.blocks.get(start)
    if (existing) { this.blocks.delete(start); this.blocks.set(start, existing); return existing }
    const pending = (async () => {
      // 剪后声音由主进程按文件里的作品计算：这份声音第一次取块前先保存一次，之后同一份声音不再重复保存。
      if (this.kind !== 'source') {
        this.flushed ??= flushAudioEditProject(this.project.id)
        await this.flushed
      }
      return getPlatform().audioEdit.preparePreviewChunk({ projectId: this.project.id, sourceStartFrame: start, frameCount: Math.min(sampleRate, durationFrames - start), mode: this.kind })
    })()
    this.blocks.set(start, pending)
    if (this.blocks.size > 30) this.blocks.delete(this.blocks.keys().next().value!)
    void pending.catch(() => { if (this.blocks.get(start) === pending) this.blocks.delete(start); this.flushed = undefined })
    return pending
  }
}

/** 按拼接表（片段、静音、拼接点交叉淡化）读成片声音；声音本身来自 PreviewSoundBlocks。 */
export class PreviewChunkCache {
  private readonly splices: AudioEditSpliceRenderer

  constructor(
    private readonly project: AudioEditProjectDocument,
    private readonly mode: AudioEditPreviewMode,
    private readonly spans: readonly AudioEditTimelineSpan[],
    private readonly sound = new PreviewSoundBlocks(project, mode === 'source' ? 'source' : 'edited'),
  ) {
    // 拼接点的交叉淡化借用被删部分紧挨着的声音，和导出调用同一个渲染器
    this.splices = new AudioEditSpliceRenderer(spans, project.source, { read: (start, count) => this.sound.readSource(start, count) })
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
    const block = await this.sound.block(start)
    const end = Math.min(start + count, block.sourceEndFrame)
    if (end <= start) throw new Error('此位置无法读取音频，请重新定位后重试')
    const pcm = this.mode === 'source'
      ? new Float32Array(block.pcm, (start - block.sourceStartFrame) * block.channels * 4, (end - start) * block.channels).slice()
      : await this.splices.render(index, start - span.sourceStartFrame, end - span.sourceStartFrame)
    return { ...block, sourceStartFrame: start, sourceEndFrame: end, pcm: pcm.buffer as ArrayBuffer }
  }

  /** 从源帧 cursor 起按拼接表顺序连续读 count 帧成片声音（交错 PCM，与正常播放逐样本一致）；读到结尾后补零。 */
  async readSequence(cursor: number, count: number): Promise<Float32Array> {
    const channels = this.project.source.channels
    const pcm = new Float32Array(Math.max(0, count) * channels)
    let written = 0
    while (written < count) {
      const chunk = await this.read(cursor, count - written)
      if (!chunk) break
      pcm.set(new Float32Array(chunk.pcm), written * channels)
      written += chunk.sourceEndFrame - chunk.sourceStartFrame
      cursor = chunk.sourceEndFrame
    }
    return pcm
  }
}
