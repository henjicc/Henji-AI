import fs from 'node:fs/promises'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import type { AudioEditRepair } from '../../../../src/core/audioEdit/regions'
import { invokeAudioWorker } from './audio-worker-client'

/** 修复与去爆音要复制整条声音：worker 边处理边报进度，这里只限制无进展的时长，不限制总时长。 */
const REPAIR_IDLE_TIMEOUT_MS = 60_000

/**
 * 与原生 native/audio-worker/src/dsp/heal.rs 的契约常量（那边同名的 HEAL_HOP_DIVISOR、DECLICK_* 与这里一一对应，改了要两边一起改；
 * dsp-adapter.test.ts 读原生源码核对）。编辑后声音只重算改动帧时，按它们判断修复读选区两侧多少帧。
 */
export const AUDIO_WORKER_CONTRACT = {
  /** 频谱修复的 FFT 长度与 hop = n / healHopDivisor。 */
  healFft: 2048,
  healHopDivisor: 4,
  /** 去爆音一次最多几段（超过分批接力，后一批读前一批的输出）。 */
  declickMaxRanges: 4096,
  /** 去爆音单段上限（毫秒）；两侧训练上下文 = 上限帧数 × declickMarginPerLimit，夹在 [declickMarginMin, declickMarginMax]。 */
  declickMaxMs: 128,
  declickMarginPerLimit: 4,
  declickMarginMin: 512,
  declickMarginMax: 8192,
} as const
const HEAL_HOP = AUDIO_WORKER_CONTRACT.healFft / AUDIO_WORKER_CONTRACT.healHopDivisor
/** 频谱修复读选区两侧各 n + hop 帧（锚点窗与逐块分析窗都在里面；原生测试 repairs_only_read_their_declared_context 证明）。 */
export const AUDIO_WORKER_HEAL_CONTEXT = AUDIO_WORKER_CONTRACT.healFft + HEAL_HOP
/** 去爆音每段两侧的训练上下文帧数。 */
export function audioWorkerDeclickMargin(sampleRate: number): number {
  const { declickMaxMs, declickMarginPerLimit, declickMarginMin, declickMarginMax } = AUDIO_WORKER_CONTRACT
  return Math.min(declickMarginMax, Math.max(declickMarginMin, Math.floor(sampleRate * declickMaxMs / 1000) * declickMarginPerLimit))
}

/** HJMK v1 修复掩码契约；二进制格式的改动只放在这个适配层。 */
export function audioRepairMaskDimensions(repair: AudioEditRepair, sampleRate: number): { width: number; height: number } {
  const fft = AUDIO_WORKER_CONTRACT.healFft
  return { width: Math.ceil((repair.endFrame - repair.startFrame) / HEAL_HOP), height: Math.floor(repair.highHz * fft / sampleRate) - Math.ceil(repair.lowHz * fft / sampleRate) + 1 }
}
export function encodeAudioRepairMask(bytes: Uint8Array, width: number, height: number): Uint8Array {
  if (bytes.length !== width * height || width < 1 || height < 1) throw new Error('修复掩码尺寸无效')
  const output = new Uint8Array(16 + bytes.length), view = new DataView(output.buffer)
  output.set(new TextEncoder().encode('HJMK')); view.setUint16(4, 1, true); view.setUint16(6, 16, true)
  view.setUint32(8, width, true); view.setUint32(12, height, true); output.set(bytes, 16)
  return output
}
/** 口水音实际修的范围：先排序、合并重叠，夹到离首尾至少 32 个样本（插值需要两侧干净的上下文）。 */
export function audioEditMouthDeclickRanges(clicks: ReadonlyArray<{ startFrame: number; endFrame: number }>, frames: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const click of [...clicks].sort((a, b) => a.startFrame - b.startFrame)) {
    const start = Math.max(32, click.startFrame), end = Math.min(frames - 32, click.endFrame)
    if (end <= start) continue
    const last = ranges.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }
  return ranges
}

/** 口水音批量修复：同一遍 LPC 插值修多处（原生工作进程一次最多处理一批，超出分批接力）。 */
export async function runAudioMouthDeclick(input: string, output: string, clicks: ReadonlyArray<{ startFrame: number; endFrame: number }>, frames: number, signal?: AbortSignal): Promise<void> {
  const ranges = audioEditMouthDeclickRanges(clicks, frames).map(([start_frame, end_frame]) => ({ start_frame, end_frame }))
  if (!ranges.length) { await fs.copyFile(input, output); return }
  const batch = AUDIO_WORKER_CONTRACT.declickMaxRanges
  const batches = Array.from({ length: Math.ceil(ranges.length / batch) }, (_, index) => ranges.slice(index * batch, (index + 1) * batch))
  let current = input
  const temporary: string[] = []
  try {
    for (const [index, batch] of batches.entries()) {
      signal?.throwIfAborted()
      const target = index === batches.length - 1 ? output : `${output}.part${index}.wav`
      if (target !== output) temporary.push(target)
      await invokeAudioWorker({ type: 'declick', input_path: current, output_path: target, ranges: batch }, REPAIR_IDLE_TIMEOUT_MS, signal)
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
      await invokeAudioWorker({ type: 'declick', input_path: input, output_path: repaired, ranges: [{ start_frame: repair.startFrame, end_frame: repair.endFrame }] }, REPAIR_IDLE_TIMEOUT_MS, signal)
      if (repaired !== output) await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-y', '-i', input, '-i', repaired, '-filter_complex', `[0:a][1:a]amix=inputs=2:weights='${1 - repair.strength} ${repair.strength}':normalize=0[out]`, '-map', '[out]', '-c:a', 'pcm_f32le', '-rf64', 'auto', output], signal)
    } finally { if (repaired !== output) await removeUnmanagedCachePath(repaired, { force: true }) }
  } else {
    await invokeAudioWorker({ type: 'spectral_heal', input_path: input, output_path: output, strength: repair.strength, fft_size: AUDIO_WORKER_CONTRACT.healFft,
      regions: [{ start_frame: repair.startFrame, end_frame: repair.endFrame, low_hz: repair.lowHz, high_hz: repair.highHz, ...(maskPath ? { mask_path: maskPath } : {}) }] }, REPAIR_IDLE_TIMEOUT_MS, signal)
  }
}
