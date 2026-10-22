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
