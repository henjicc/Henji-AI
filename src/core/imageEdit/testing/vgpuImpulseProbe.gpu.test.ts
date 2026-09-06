import { describe, expect, it } from 'vitest'
import { init } from 'vgpu/node'
import { runVgpuHdrImpulseProbe } from './vgpuImpulseProbe'

// npm run test:gpu 与 CI 的 WebGPU 专项均无条件执行，设备初始化失败必须变红。
describe('VGPU HDR impulse 真实设备专项 probe', () => {
  it('通过 Target.readFloats 保留半浮点 HDR，并保持 impulse 能量与质心', async () => {
    const gpu = await init()
    try {
      const result = await runVgpuHdrImpulseProbe(gpu)
      expect(result.format).toBe('rgba16float')
      expect(result.pixels).toHaveLength(65 * 65 * 4)
      for (const [channel, expectedEnergy] of [8, 4, 2, 1].entries()) {
        const metrics = result.analysis.channels[channel]
        expect(metrics.signedEnergy).toBeCloseTo(expectedEnergy, 3)
        expect(metrics.negativeEnergy).toBe(0)
        expect(metrics.nonFiniteSamples).toBe(0)
        expect(metrics.peak.value).toBeCloseTo(expectedEnergy, 3)
        expect(metrics.centroidOffsetPx?.[0]).toBeCloseTo(0, 3)
        expect(metrics.centroidOffsetPx?.[1]).toBeCloseTo(0, 3)
      }
    } finally {
      gpu.dispose()
    }
  }, 30_000)
})
