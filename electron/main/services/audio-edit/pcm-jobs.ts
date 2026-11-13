import { createHash } from 'node:crypto'
import type { AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'
import { AudioEditSpliceRenderer } from '../../../../src/core/audioEdit/spliceCrossfade'
import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { AudioEditHumCollector, AudioEditSoundStatsCollector, audioEditNoiseFrames, type AudioEditSoundStats } from '../../../../src/core/audioEdit/soundCheck'
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
  /** 补录拼接：按顺序把几段浮点 WAV 的帧原样接成一个文件（样本字节不变，不经过任何计算），顺带算出整个文件的 SHA-256。 */
  | { kind: 'concat'; output: string; sampleRate: number; channels: number; pieces: Array<{ input: string; startFrame: number; frames: number }> }
  /** 只读：成品声音一段的采样级统计（电平、峰值、削波、嗡声），给“听起来怎样”的读回用。 */
  | { kind: 'sound-stats'; input: string; startFrame: number; endFrame: number }

/** 每块秒数：块越大轮次越少；增益与拼接都逐采样计算，分块大小不影响结果。 */
const BLOCK_SECONDS = 8

/** 拼接写出的结果：digest 是写出文件全部字节的 SHA-256（与事后整文件哈希相同）。 */
export interface AudioEditConcatResult { digest: string }

async function concatF32Wavs(job: Extract<AudioEditPcmJob, { kind: 'concat' }>, onProgress?: (value: number) => void): Promise<AudioEditConcatResult> {
  const total = job.pieces.reduce((sum, piece) => sum + piece.frames, 0)
  const block = job.sampleRate * BLOCK_SECONDS
  const buffer = new Float32Array(block * job.channels)
  const hash = createHash('sha256')
  const writer = await createF32WavWriter(job.output, job.sampleRate, job.channels, total, hash)
  let written = 0
  try {
    for (const piece of job.pieces) {
      const reader = await openF32Wav(piece.input)
      try {
        if (!reader || reader.sampleRate !== job.sampleRate || reader.channels !== job.channels || piece.startFrame + piece.frames > reader.frames) throw new Error('拼接的声音与作品规格不一致')
        for (let offset = 0; offset < piece.frames; offset += block) {
          const count = Math.min(block, piece.frames - offset)
          await writer.write(await reader.read(piece.startFrame + offset, count, count === block ? buffer : undefined))
          written += count
          onProgress?.(written / Math.max(1, total))
        }
      } finally { await reader?.close() }
    }
  } finally { await writer.close() }
  return { digest: hash.digest('hex') }
}

/** 拼接写出返回整文件摘要，统计返回采样级统计，其余处理没有返回值。 */
export async function runAudioEditPcmJob(job: AudioEditPcmJob, onProgress?: (value: number) => void): Promise<AudioEditConcatResult | AudioEditSoundStats | void> {
  if (job.kind === 'concat') return concatF32Wavs(job, onProgress)
  const reader = await openF32Wav(job.input)
  if (!reader) throw new Error('声音处理只接受 32 位浮点 WAV。')
  const { sampleRate, channels } = reader
  const block = sampleRate * BLOCK_SECONDS
  try {
    if (job.kind === 'sound-stats') {
      // 两遍：第一遍电平、峰值、削波并定出非语音片段，第二遍只在非语音片段里估嗡声
      const collector = new AudioEditSoundStatsCollector(sampleRate, channels)
      const from = Math.max(0, job.startFrame), to = Math.min(reader.frames, job.endFrame)
      const buffer = new Float32Array(block * channels)
      for (let start = from; start < to; start += block) {
        const count = Math.min(block, to - start)
        collector.push(await reader.read(start, count, count === block ? buffer : undefined))
        onProgress?.((start + count - from) / Math.max(1, to - from) / 2)
      }
      const first = collector.finish()
      const hum = new AudioEditHumCollector(sampleRate, channels, audioEditNoiseFrames(first))
      for (let start = from; start < to; start += block) {
        const count = Math.min(block, to - start)
        hum.push(await reader.read(start, count, count === block ? buffer : undefined))
        onProgress?.(0.5 + (start + count - from) / Math.max(1, to - from) / 2)
      }
      return { ...first, hum: hum.finish() }
    }
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
