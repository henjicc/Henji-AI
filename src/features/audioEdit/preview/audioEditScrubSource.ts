import { AudioEffectChain, type AudioEffectInstance } from '@/core/audio/effects/audioEffectChain'
import { editedDurationFrames, outputFrameToSourceFrame, sourceFrameToOutputFrame } from '@/core/audioEdit/timeline'
import type { AudioEditPreviewMode, AudioEditProjectDocument, AudioEditTimelineSpan } from '@/core/audioEdit/types'
import type { AudioScrubSource } from '@/services/audioScrub/audioScrubEngine'
import type { PreviewChunkCache } from './previewChunkCache'

/** 有实时效果时每块先预读这么久让效果状态稳定（擦洗是试听，不追求混响长尾）。 */
const EFFECT_PREROLL_SECONDS = 0.3

export interface AudioEditScrubSource extends AudioScrubSource {
  /** 播放头的源帧换成擦洗声音的位置（秒）：原始试听按源时间，剪后与交付按剪后时间（删掉的部分不占位置）。 */
  seconds(sourceFrame: number): number
  dispose(): void
}

/**
 * 音频编辑的擦洗声音来源：按当前试听模式的成片时间读声音（删除点的拼接淡化、静音与正常播放逐样本一致，见 PreviewChunkCache），
 * 有实时效果时经同一套效果链处理，拖动听到的就是播放听到的。
 */
export function audioEditScrubSource(project: AudioEditProjectDocument, mode: AudioEditPreviewMode, spans: readonly AudioEditTimelineSpan[], cache: PreviewChunkCache, effects: readonly AudioEffectInstance[]): AudioEditScrubSource {
  const { sampleRate, channels, durationFrames } = project.source
  const original = mode === 'source'
  const frames = original ? durationFrames : editedDurationFrames(spans)
  const planar = (pcm: Float32Array, count: number): Float32Array[] => Array.from({ length: channels }, (_, channel) => {
    const plane = new Float32Array(count)
    for (let frame = 0; frame < count; frame++) plane[frame] = pcm[frame * channels + channel]
    return plane
  })
  const readOutput = async (start: number, count: number): Promise<Float32Array[]> => {
    const lead = Math.max(0, -start)
    const cursor = original ? start + lead : outputFrameToSourceFrame(start + lead, spans)
    const planes = planar(cursor === null || count - lead <= 0 ? new Float32Array(0) : await cache.readSequence(cursor, count - lead), count - lead)
    if (!lead) return planes
    return planes.map(plane => { const padded = new Float32Array(count); padded.set(plane, lead); return padded })
  }
  let chain: AudioEffectChain | undefined
  let closed = false
  return {
    sampleRate, channels, frames,
    // 读取走主进程取块与拼接渲染，可两路并行；效果链只有一条，有效果时逐块处理。
    concurrency: effects.length ? 1 : 2,
    seconds(sourceFrame) {
      if (original) return sourceFrame / sampleRate
      // 落在删掉的部分：吸到后一段开头（与播放头跳过删除部分一致）。
      const span = spans.find(candidate => sourceFrame < candidate.sourceEndFrame)
      const output = !span ? frames : sourceFrame < span.sourceStartFrame ? span.outputStartFrame : sourceFrameToOutputFrame(sourceFrame, spans) ?? span.outputStartFrame
      return output / sampleRate
    },
    async read(start, count) {
      if (!effects.length) return readOutput(start, count)
      chain ??= new AudioEffectChain(sampleRate, channels)
      const active = chain
      // 擦洗的块不连续：每块重置效果状态并预读一小段，再扣掉效果链延迟与预读。
      const abandoned = (): DOMException => { active.dispose(); return new DOMException('擦洗声音来源已更换。', 'AbortError') }
      await active.reset(effects)
      if (closed) throw abandoned()
      const preroll = Math.min(start, Math.round(EFFECT_PREROLL_SECONDS * sampleRate))
      const latency = active.latency
      const total = preroll + count + latency
      const planes = await readOutput(start - preroll, total)
      if (closed) throw abandoned()
      active.locate(start - preroll)
      active.process(planes, total)
      return planes.map(plane => plane.subarray(preroll + latency, preroll + latency + count))
    },
    dispose() { closed = true; chain?.dispose(); chain = undefined },
  }
}
