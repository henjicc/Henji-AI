import { expect, it, vi } from 'vitest'
vi.mock('./audio-worker-client', () => ({ invokeAudioWorker: vi.fn(async () => ({})) }))
import { audioRepairMaskDimensions, encodeAudioRepairMask, runAudioRepair } from './dsp-adapter'
import { invokeAudioWorker } from './audio-worker-client'

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
