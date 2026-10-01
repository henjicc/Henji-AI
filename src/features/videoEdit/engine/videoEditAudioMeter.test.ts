import { expect, it, vi } from 'vitest'
import { createVideoEditAudioMeter } from './videoEditAudioMeter'
it('电平读取真实输出图的L/R采样，峰值/RMS不归一化并可完整释放', () => {
  const connections: Array<ReturnType<typeof vi.fn>> = []; let channel = 0
  const node = () => { const disconnect = vi.fn(); connections.push(disconnect); return { connect: vi.fn(), disconnect } }
  const context = { destination: {}, createGain: () => ({ ...node(), gain: { value: 1 } }), createChannelSplitter: node, createAnalyser: () => { const index = channel++; return { ...node(), fftSize: 1024, getFloatTimeDomainData: (data: Float32Array) => data.fill(index === 0 ? 1.25 : -.5) } } } as unknown as AudioContext
  const meter = createVideoEditAudioMeter(context, 2)
  expect(meter.read()).toEqual([{ peak: 1.25, rms: 1.25 }, { peak: .5, rms: .5 }])
  meter.dispose(); meter.dispose(); expect(connections.every(disconnect => disconnect.mock.calls.length === 1)).toBe(true)
  expect(meter.read()).toEqual([{ peak: 0, rms: 0 }, { peak: 0, rms: 0 }])
})
