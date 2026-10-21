import { expect, it, vi } from 'vitest'
vi.mock('./audio-worker-client', () => ({ invokeAudioWorker: vi.fn(async () => ({})) }))
import { audioRepairMaskDimensions, encodeAudioRepairMask, parseSpectrogram, runAudioRepair } from './dsp-adapter'
import { invokeAudioWorker } from './audio-worker-client'

it('validates HJSP header and preserves planar u8 payload with time/frequency metadata', () => {
  const m = { sampleRate: 48000, channels: 2, fftSize: 256, hop: 64, frames: 2, bins: 129, startFrame: 100, endFrame: 200 }
  const bytes = new Uint8Array(64 + 2 * 2 * 129), view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('HJSP')); view.setUint16(4, 1, true); view.setUint16(6, 64, true)
  for (const [offset, value] of [[8, m.sampleRate], [12, m.channels], [16, m.fftSize], [20, m.hop], [32, m.bins]]) view.setUint32(offset, value, true)
  view.setBigUint64(24, 2n, true); view.setBigUint64(40, 100n, true); view.setBigUint64(48, 200n, true); bytes[64] = 255
  const result = parseSpectrogram(bytes, m, 200)
  expect(result.values.length).toBe(516); expect(result.values[0]).toBe(255); expect(result.startFrame).toBe(100)
  expect(() => parseSpectrogram(bytes.subarray(0, bytes.length - 1), m, 200)).toThrow('不匹配')
  bytes[0] = 0; expect(() => parseSpectrogram(bytes, m, 200)).toThrow('文件头')
})
it('uses HJMK dimensions and routes repair commands with the published snake-case contract', async () => {
  const repair = { id: 'r', kind: 'spectral_heal' as const, startFrame: 100, endFrame: 1124, lowHz: 100, highHz: 1000, enabled: true, strength: 1 }
  const { width, height } = audioRepairMaskDimensions(repair, 48000)
  expect({ width, height }).toEqual({ width: 2, height: 38 })
  const bytes = encodeAudioRepairMask(new Uint8Array(width * height).fill(255), width, height)
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('HJMK'); expect(bytes.length).toBe(92)
  await runAudioRepair('input.wav', 'out.wav', repair, 'mask.bin')
  expect(invokeAudioWorker).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'spectral_heal', regions: [{ start_frame: 100, end_frame: 1124, low_hz: 100, high_hz: 1000, mask_path: 'mask.bin' }] }), 120000, undefined)
  await runAudioRepair('input.wav', 'out.wav', { ...repair, kind: 'declick' })
  expect(invokeAudioWorker).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'declick', ranges: [{ start_frame: 100, end_frame: 1124 }] }), 120000, undefined)
})
