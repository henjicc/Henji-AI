import fs from 'node:fs/promises'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import type { AudioEditRepair } from '../../../../src/core/audioEdit/regions'
import { invokeAudioWorker } from './audio-worker-client'

/** HJMK v1 修复掩码契约；二进制格式的改动只放在这个适配层。 */
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
/**
 * 口水音批量修复：同一遍 LPC 插值修多处（原生工作进程一次最多 4096 段，超出分批接力）。
 * 范围先排序、合并重叠，夹到离首尾至少 32 个样本（插值需要两侧干净的上下文）。
 */
export async function runAudioMouthDeclick(input: string, output: string, clicks: ReadonlyArray<{ startFrame: number; endFrame: number }>, frames: number, signal?: AbortSignal): Promise<void> {
  const ranges: Array<{ start_frame: number; end_frame: number }> = []
  for (const click of [...clicks].sort((a, b) => a.startFrame - b.startFrame)) {
    const start = Math.max(32, click.startFrame), end = Math.min(frames - 32, click.endFrame)
    if (end <= start) continue
    const last = ranges.at(-1)
    if (last && start <= last.end_frame) last.end_frame = Math.max(last.end_frame, end)
    else ranges.push({ start_frame: start, end_frame: end })
  }
  if (!ranges.length) { await fs.copyFile(input, output); return }
  const batches = Array.from({ length: Math.ceil(ranges.length / 4096) }, (_, index) => ranges.slice(index * 4096, (index + 1) * 4096))
  let current = input
  const temporary: string[] = []
  try {
    for (const [index, batch] of batches.entries()) {
      signal?.throwIfAborted()
      const target = index === batches.length - 1 ? output : `${output}.part${index}.wav`
      if (target !== output) temporary.push(target)
      await invokeAudioWorker({ type: 'declick', input_path: current, output_path: target, ranges: batch }, 10 * 60_000, signal)
      current = target
    }
  } finally { await Promise.all(temporary.map(file => removeUnmanagedCachePath(file, { force: true }))) }
}

/** 原声与处理结果按比例混合（amount 为处理结果的比例 0–1），两者等长、同采样率与声道。 */
export async function mixAudioEditProcessed(original: string, processed: string, amount: number, output: string, signal?: AbortSignal): Promise<void> {
  if (amount >= 0.999) { await fs.copyFile(processed, output); return }
  await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', original, '-i', processed, '-filter_complex', `[0:a][1:a]amix=inputs=2:weights='${1 - amount} ${amount}':normalize=0[out]`, '-map', '[out]', '-c:a', 'pcm_f32le', '-rf64', 'auto', output], signal)
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
