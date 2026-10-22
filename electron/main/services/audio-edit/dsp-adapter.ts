import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import fs from 'node:fs/promises'
import { z } from 'zod'
import type { AudioEditRepair, AudioEditSpectrogramChunk } from '../../../../src/core/audioEdit/regions'
import { invokeAudioWorker } from './audio-worker-client'

/** HJSP/HJMK v1 contract from audio-dsp; keep binary changes in this adapter. */
const metadataSchema = z.object({ sampleRate: z.number().int().positive(), channels: z.number().int().positive(), fftSize: z.number().int().positive(), hop: z.number().int().positive(), frames: z.number().int().nonnegative(), bins: z.number().int().positive(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() })
export type SpectrogramMetadata = z.infer<typeof metadataSchema>
export function parseSpectrogram(bytes: Uint8Array, raw: unknown, endFrame: number): AudioEditSpectrogramChunk {
  const m = metadataSchema.parse(raw)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = m.channels * m.frames * m.bins
  if (bytes.byteLength < 64 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'HJSP' || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 64) throw new Error('不支持的频谱文件头')
  if (!Number.isSafeInteger(size) || size > 32 * 1024 * 1024 || bytes.byteLength !== 64 + size || m.endFrame !== endFrame
    || view.getUint32(8, true) !== m.sampleRate || view.getUint32(12, true) !== m.channels || view.getUint32(16, true) !== m.fftSize
    || view.getUint32(20, true) !== m.hop || view.getBigUint64(24, true) !== BigInt(m.frames) || view.getUint32(32, true) !== m.bins
    || view.getBigUint64(40, true) !== BigInt(m.startFrame) || view.getBigUint64(48, true) !== BigInt(m.endFrame)
    || m.bins !== m.fftSize / 2 + 1) throw new Error('频谱二进制与元数据不匹配')
  return { sampleRate: m.sampleRate, channels: m.channels, fftSize: m.fftSize, hop: m.hop, timeBins: m.frames, frequencyBins: m.bins, startFrame: m.startFrame, endFrame, values: new Uint8Array(bytes.buffer, bytes.byteOffset + 64, size) }
}

/** HJSP 文件头已携带全部元数据，读回时直接借用二进制缓冲区。 */
export function readSpectrogram(bytes: Uint8Array): AudioEditSpectrogramChunk {
  if (bytes.byteLength < 64) throw new Error('不支持的频谱文件头')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const metadata = { sampleRate: view.getUint32(8, true), channels: view.getUint32(12, true), fftSize: view.getUint32(16, true), hop: view.getUint32(20, true), frames: Number(view.getBigUint64(24, true)), bins: view.getUint32(32, true), startFrame: Number(view.getBigUint64(40, true)), endFrame: Number(view.getBigUint64(48, true)) }
  if (!Number.isSafeInteger(metadata.startFrame) || !Number.isSafeInteger(metadata.endFrame) || metadata.endFrame <= metadata.startFrame || metadata.frames !== Math.ceil((metadata.endFrame - metadata.startFrame) / metadata.hop)) throw new Error('频谱二进制范围无效')
  return parseSpectrogram(bytes, metadata, metadata.endFrame)
}
export function audioRepairMaskDimensions(repair: AudioEditRepair, sampleRate: number): { width: number; height: number } {
  return { width: Math.ceil((repair.endFrame - repair.startFrame) / 512), height: Math.floor(repair.highHz * 2048 / sampleRate) - Math.ceil(repair.lowHz * 2048 / sampleRate) + 1 }
}
export function encodeAudioRepairMask(bytes: Uint8Array, width: number, height: number): Uint8Array {
  if (bytes.length !== width * height || width < 1 || height < 1) throw new Error('修复掩码尺寸无效')
  const output = new Uint8Array(16 + bytes.length), view = new DataView(output.buffer)
  output.set(new TextEncoder().encode('HJMK')); view.setUint16(4, 1, true); view.setUint16(6, 16, true)
  view.setUint32(8, width, true); view.setUint32(12, height, true); output.set(bytes, 16)
  return output
}
export async function runSpectrogram(input: string, output: string, options: { startFrame: number; endFrame: number; fftSize: number; hop: number; channel?: number }, signal?: AbortSignal): Promise<void> {
  const metadata = await invokeAudioWorker<unknown>({ type: 'spectrogram', input_path: input, output_path: output, fft_size: options.fftSize, hop: options.hop, start_frame: options.startFrame, end_frame: options.endFrame, ...(options.channel === undefined ? {} : { channel: options.channel }) }, 120000, signal)
  // 校验后原样发布 Worker 的 HJSP，避免 JSON/base64 编解码和一次整块拷贝。
  parseSpectrogram(await fs.readFile(output), metadata, options.endFrame)
}
export async function runAudioRepair(input: string, output: string, repair: AudioEditRepair, maskPath?: string, signal?: AbortSignal): Promise<void> {
  if (repair.kind === 'declick') {
    const repaired = repair.strength < 1 ? `${output}.declick.wav` : output
    try {
      await invokeAudioWorker({ type: 'declick', input_path: input, output_path: repaired, ranges: [{ start_frame: repair.startFrame, end_frame: repair.endFrame }] }, 120000, signal)
      if (repaired !== output) await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', input, '-i', repaired, '-filter_complex', `[0:a][1:a]amix=inputs=2:weights='${1 - repair.strength} ${repair.strength}':normalize=0[out]`, '-map', '[out]', '-c:a', 'pcm_f32le', output], signal)
    } finally { if (repaired !== output) await removeUnmanagedCachePath(repaired, { force: true }) }
  } else {
    await invokeAudioWorker({ type: 'spectral_heal', input_path: input, output_path: output, strength: repair.strength, fft_size: 2048,
      regions: [{ start_frame: repair.startFrame, end_frame: repair.endFrame, low_hz: repair.lowHz, high_hz: repair.highHz, ...(maskPath ? { mask_path: maskPath } : {}) }] }, 120000, signal)
  }
}
