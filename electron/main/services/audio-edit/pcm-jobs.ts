import type { AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'
import { AudioEditSpliceRenderer } from '../../../../src/core/audioEdit/spliceCrossfade'
import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { applyAudioEditGainLayers } from './gain-layers'
import { createF32WavWriter, openF32Wav, openF32WavForPatch } from './pcm-wav'

/*
 * 整段搬运 PCM 的几步（增益层、只重算改动帧、成片拼接）：在效果工作线程里跑，主进程只派活、等结果，
 * 一小时素材的几千轮读写与计算不占主进程事件循环。输入都是 32 位浮点 WAV，输出与输入同采样率、同声道。
 * 增益层每层的区域已按处理顺序排好（见 gain-layers.ts）。
 */

export type AudioEditPcmJob =
  | { kind: 'gains'; input: string; output: string; layers: AudioEditGainRegion[][] }
  /** output 是上一版编辑后声音的副本：只把 ranges 内的帧改写成 input × 增益层，其余帧原样保留。 */
  | { kind: 'gains-patch'; input: string; output: string; layers: AudioEditGainRegion[][]; ranges: Array<[number, number]> }
  | { kind: 'splices'; input: string; output: string; spans: AudioEditTimelineSpan[]; durationFrames: number; layers?: AudioEditGainRegion[][] }

/** 每块秒数：块越大轮次越少；增益与拼接都逐采样计算，分块大小不影响结果。 */
const BLOCK_SECONDS = 8

export async function runAudioEditPcmJob(job: AudioEditPcmJob, onProgress?: (value: number) => void): Promise<void> {
  const reader = await openF32Wav(job.input)
  if (!reader) throw new Error('声音处理只接受 32 位浮点 WAV。')
  const { sampleRate, channels } = reader
  const block = sampleRate * BLOCK_SECONDS
  try {
    if (job.kind === 'gains') {
      const writer = await createF32WavWriter(job.output, sampleRate, channels, reader.frames)
      const buffer = new Float32Array(block * channels)
      try {
        for (let start = 0; start < reader.frames; start += block) {
          const count = Math.min(block, reader.frames - start)
          const pcm = await reader.read(start, count, count === block ? buffer : undefined)
          applyAudioEditGainLayers(pcm, start, channels, job.layers)
          await writer.write(pcm)
          onProgress?.((start + count) / reader.frames)
        }
      } finally { await writer.close() }
      return
    }
    if (job.kind === 'gains-patch') {
      const target = await openF32WavForPatch(job.output)
      if (!target || target.sampleRate !== sampleRate || target.channels !== channels || target.frames !== reader.frames) { await target?.close(); throw new Error('上一版编辑后声音与底声规格不一致') }
      const total = job.ranges.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0)
      let done = 0
      try {
        for (const [from, to] of job.ranges) {
          for (let start = Math.max(0, from); start < Math.min(to, reader.frames); start += block) {
            const count = Math.min(block, Math.min(to, reader.frames) - start)
            const pcm = await reader.read(start, count)
            applyAudioEditGainLayers(pcm, start, channels, job.layers)
            await target.write(start, pcm)
            done += count
            onProgress?.(done / Math.max(1, total))
          }
        }
      } finally { await target.close() }
      return
    }
    const layers = job.layers ?? []
    // 拼接要读被删部分紧挨着的声音：经过增益层的读取与读“整段乘好的文件”逐样本相同。
    const source = layers.length ? { read: async (start: number, count: number) => { const pcm = await reader.read(start, count); applyAudioEditGainLayers(pcm, start, channels, layers); return pcm } } : reader
    const splices = new AudioEditSpliceRenderer(job.spans, { sampleRate, channels, durationFrames: reader.frames }, source)
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
