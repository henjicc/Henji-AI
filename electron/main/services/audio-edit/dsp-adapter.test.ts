import fs from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
vi.mock('./audio-worker-client', () => ({ invokeAudioWorker: vi.fn(async () => ({})) }))
import { AUDIO_WORKER_CONTRACT, audioRepairMaskDimensions, encodeAudioRepairMask, runAudioRepair } from './dsp-adapter'
import { invokeAudioWorker } from './audio-worker-client'

it('“修复只读选区两侧多少帧”所依赖的常量与原生 heal.rs 取值一致', () => {
  const source = fs.readFileSync(path.resolve('native/audio-worker/src/dsp/heal.rs'), 'utf8')
  const native = (name: string): number => Number(new RegExp(`const ${name}: \\w+ = (\\d+);`).exec(source)?.[1])
  expect({
    healHopDivisor: native('HEAL_HOP_DIVISOR'), declickMaxRanges: native('DECLICK_MAX_RANGES'), declickMaxMs: native('DECLICK_MAX_MS'),
    declickMarginPerLimit: native('DECLICK_MARGIN_PER_LIMIT'), declickMarginMin: native('DECLICK_MARGIN_MIN'), declickMarginMax: native('DECLICK_MARGIN_MAX'),
  }).toEqual({
    healHopDivisor: AUDIO_WORKER_CONTRACT.healHopDivisor, declickMaxRanges: AUDIO_WORKER_CONTRACT.declickMaxRanges, declickMaxMs: AUDIO_WORKER_CONTRACT.declickMaxMs,
    declickMarginPerLimit: AUDIO_WORKER_CONTRACT.declickMarginPerLimit, declickMarginMin: AUDIO_WORKER_CONTRACT.declickMarginMin, declickMarginMax: AUDIO_WORKER_CONTRACT.declickMarginMax,
  })
})

it('uses HJMK dimensions and routes repair commands with the published snake-case contract', async () => {
  const repair = { id: 'r', kind: 'spectral_heal' as const, startFrame: 100, endFrame: 1124, lowHz: 100, highHz: 1000, enabled: true, strength: 1 }
  const { width, height } = audioRepairMaskDimensions(repair, 48000)
  expect({ width, height }).toEqual({ width: 2, height: 38 })
  const bytes = encodeAudioRepairMask(new Uint8Array(width * height).fill(255), width, height)
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('HJMK'); expect(bytes.length).toBe(92)
  await runAudioRepair('input.wav', 'out.wav', repair, 'mask.bin')
  expect(invokeAudioWorker).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'spectral_heal', regions: [{ start_frame: 100, end_frame: 1124, low_hz: 100, high_hz: 1000, mask_path: 'mask.bin' }] }), 60_000, undefined)
  await runAudioRepair('input.wav', 'out.wav', { ...repair, kind: 'declick' })
  expect(invokeAudioWorker).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'declick', ranges: [{ start_frame: 100, end_frame: 1124 }] }), 60_000, undefined)
})
