import { expect, it } from 'vitest'
import { init } from 'vgpu/node'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditSpatialGpu } from './videoEditSpatialComposite'
import { planAuthorDefocus, planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { videoEditHalfToFloat } from './videoEditGpuShaders'

it('真实镜头核在小 CoC 连接段连续，零半径不污染预乘透明边缘', async () => {
  const gpu = await init(), device = gpu.gpu, size = 64
  const allocations = new Set<unknown>()
  const host = new VideoEditSpatialGpu(device as unknown as GpuDevice, {
    allocate(spec, mipLevelCount) {
      const texture = device.createTexture({ size: [spec.width, spec.height], format: spec.format, usage: spec.usage, mipLevelCount })
      allocations.add(texture); return texture
    },
    release(texture) { allocations.delete(texture); texture.destroy() },
  })
  const source = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 2 | 4 })
  const destination = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 1 | 16 })
  const buffer = device.createBuffer({ size: size * size * 8, usage: 1 | 8 })
  try {
    const input = new Uint16Array(size * size * 4)
    for (let y = 10; y < 54; y++) for (let x = 10; x < 54; x++) input.set([0x3800, 0x3000, 0, 0x3800], (y * size + x) * 4)
    device.queue.writeTexture({ texture: source }, input, { bytesPerRow: size * 8 }, [size, size])
    const metrics: Array<{ radius: number; maxDifference: number; meanDifference: number }> = []
    for (const radius of [0, .124, .125, .126, .13, .2, .5]) {
      await host.encodeBuiltin(planAuthorDefocus(size, size, radius, true, false, { radiusY: radius, outputRadius: radius }), source, destination, 'rgba16float', [])
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture: destination }, { buffer, bytesPerRow: size * 8 }, [size, size])
      device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
      const actual = new Uint16Array(buffer.getMappedRange())
      let maximum = 0, total = 0
      for (let index = 0; index < input.length; index++) {
        const difference = Math.abs(videoEditHalfToFloat(actual[index]) - videoEditHalfToFloat(input[index]))
        maximum = Math.max(maximum, difference); total += difference
      }
      if (radius <= .125) expect(maximum).toBe(0)
      if (radius === .126) expect(maximum).toBeLessThan(1 / 1024)
      expect(Number.isFinite(total)).toBe(true)
      metrics.push({ radius, maxDifference: maximum, meanDifference: total / input.length })
      buffer.unmap()
    }
    expect(metrics.at(-1)!.maxDifference).toBeGreaterThan(0)
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') process.stdout.write(`spatial-coc-continuity ${JSON.stringify(metrics)}\n`)
  } finally { await host.dispose(); source.destroy(); destination.destroy(); buffer.destroy(); gpu.dispose() }
  expect(allocations.size).toBe(0)
}, 30_000)

it.each<Parameters<typeof planVideoEditBuiltinEffect>[0]>([
  { id: 'blur', params: { mode: 'uniform', amount: 40, repeat_edges: false } },
  { id: 'stroke', params: { width: 120, position: 'outside' } },
])('空间材料的 $id 效果保留中间格式且不丢失画面', async effect => {
  const gpu = await init(), device = gpu.gpu, size = 64
  const host = new VideoEditSpatialGpu(device as unknown as GpuDevice, {
    allocate(spec, mipLevelCount) {
      return device.createTexture({ size: [spec.width, spec.height], format: spec.format, usage: spec.usage, mipLevelCount })
    },
    release(texture) { texture.destroy() },
  })
  const source = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 2 | 4 })
  const output = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 1 | 16 })
  const buffer = device.createBuffer({ size: size * size * 8, usage: 1 | 8 })
  try {
    const pixels = new Uint16Array(size * size * 4)
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) pixels.set([0x3c00, 0, 0, 0x3c00], (y * size + x) * 4)
    device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 8 }, [size, size])
    const plan = planVideoEditBuiltinEffect(effect, { width: size, height: size, frame: 0, quality: 'final', referenceSize: { width: size, height: size } })
    device.pushErrorScope('validation')
    await host.encodeBuiltin(plan, source, output, 'rgba16float', [])
    expect(await device.popErrorScope()).toBeNull()
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: size * 8 }, [size, size])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
    const result = new Uint16Array(buffer.getMappedRange()), center = (32 * size + 32) * 4
    expect(videoEditHalfToFloat(result[center])).toBeCloseTo(1, 3)
    // 预乘不越界：颜色不超过 alpha；软件渲染器的半精度取整可能让颜色低 1 个单位
    expect(result[center]).toBeLessThanOrEqual(result[center + 3]); expect(result[center + 3] - result[center]).toBeLessThanOrEqual(1)
    buffer.unmap()
  } finally { await host.dispose(); source.destroy(); output.destroy(); buffer.destroy(); gpu.dispose() }
}, 30_000)
