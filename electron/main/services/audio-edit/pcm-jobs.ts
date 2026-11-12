import { applyAudioEditGainRegions, type AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'
import { AudioEditSpliceRenderer } from '../../../../src/core/audioEdit/spliceCrossfade'
import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { createF32WavWriter, openF32Wav } from './pcm-wav'

/*
 * 整段搬运 PCM 的两步（区间音量与呼吸减弱、成片拼接）：在效果工作线程里跑，主进程只派活、等结果，
 * 一小时素材的几千轮读写与计算不占主进程事件循环。输入都是 32 位浮点 WAV，输出与输入同采样率、同声道。
 */

export type AudioEditPcmJob =
  | { kind: 'gains'; input: string; output: string; regions: AudioEditGainRegion[] }
  | { kind: 'splices'; input: string; output: string; spans: AudioEditTimelineSpan[]; durationFrames: number }

/** 每块秒数：块越大轮次越少；增益与拼接都逐采样计算，分块大小不影响结果。 */
const BLOCK_SECONDS = 8

export async function runAudioEditPcmJob(job: AudioEditPcmJob, onProgress?: (value: number) => void): Promise<void> {
  const reader = await openF32Wav(job.input)
  if (!reader) throw new Error('声音处理只接受 32 位浮点 WAV。')
  const { sampleRate, channels } = reader
  const block = sampleRate * BLOCK_SECONDS
  try {
    if (job.kind === 'gains') {
      const sorted = [...job.regions].sort((a, b) => a.startFrame - b.startFrame)
      const writer = await createF32WavWriter(job.output, sampleRate, channels, reader.frames)
      const buffer = new Float32Array(block * channels)
      try {
        for (let start = 0; start < reader.frames; start += block) {
          const count = Math.min(block, reader.frames - start)
          const pcm = await reader.read(start, count, count === block ? buffer : undefined)
          applyAudioEditGainRegions(pcm, start, channels, sorted.filter(region => region.startFrame < start + count && region.endFrame > start))
          await writer.write(pcm)
          onProgress?.((start + count) / reader.frames)
        }
      } finally { await writer.close() }
      return
    }
    const splices = new AudioEditSpliceRenderer(job.spans, { sampleRate, channels, durationFrames: reader.frames }, reader)
    const writer = await createF32WavWriter(job.output, sampleRate, channels, job.durationFrames)
    let written = 0
    try {
      for (const [index, span] of job.spans.entries()) {
        const length = span.sourceEndFrame - span.sourceStartFrame
        for (let local = 0; local < length; local += block) {
          const end = Math.min(length, local + block)
          await writer.write(await splices.render(index, local, end))
          written += end - local
          onProgress?.(written / Math.max(1, job.durationFrames))
        }
      }
    } finally { await writer.close() }
  } finally { await reader.close() }
}
