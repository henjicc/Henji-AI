import { expect, it, vi } from 'vitest'
import { calculatePreviewGain, createPreviewOutput } from './previewGain'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'

it('amplifies quiet recordings with bounded gain without amplifying silence or boosting loud audio', () => {
  expect(calculatePreviewGain([0.05, 0.1, 0.08])).toBe(8)
  expect(calculatePreviewGain([0.001])).toBe(16)
  expect(calculatePreviewGain([0, 0, Number.NaN])).toBe(1)
  expect(calculatePreviewGain([0.95])).toBe(1)
  expect(calculatePreviewGain([])).toBe(1)
})

it('routes boost through peak protection and independent monitor volume, with smooth live updates', () => {
  const gainNode = () => ({ gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() })
  const boost = gainNode()
  const volume = gainNode()
  const protection = { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }
  const context = { currentTime: 10, destination: {}, createGain: vi.fn().mockReturnValueOnce(boost).mockReturnValueOnce(volume), createDynamicsCompressor: () => protection }
  const output = createPreviewOutput(context as unknown as AudioContext)
  output.setLevels(8, 0.8)
  expect(output.input).toBe(boost)
  expect(boost.connect).toHaveBeenCalledWith(protection)
  expect(protection.connect).toHaveBeenCalledWith(volume)
  expect(volume.connect).toHaveBeenCalledWith(context.destination)
  expect(boost.gain.setTargetAtTime).toHaveBeenLastCalledWith(8, 10, 0.03)
  expect(volume.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 10, 0.03)
  output.setLevels(1, 0)
  expect(boost.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 10, 0.03)
  expect(volume.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.03)
  output.dispose()
  for (const node of [boost, volume, protection]) expect(node.disconnect).toHaveBeenCalledOnce()
})

it('clamps monitor volume to a finite valid range', () => {
  const store = useAudioEditPlaybackStore.getState()
  store.setVolume(-1)
  expect(useAudioEditPlaybackStore.getState().volume).toBe(0)
  store.setVolume(3)
  expect(useAudioEditPlaybackStore.getState().volume).toBe(1)
  store.setVolume(Number.NaN)
  expect(useAudioEditPlaybackStore.getState().volume).toBe(0.8)
})
