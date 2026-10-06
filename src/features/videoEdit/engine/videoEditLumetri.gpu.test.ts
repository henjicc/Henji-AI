import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { lumetriLinear, lumetriSrgb, lumetriWhiteBalance } from '@/core/videoEdit/lumetri'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'
import { readVideoEditPreciseRow, videoEditGradientLevels, videoEditHalfToFloat } from './videoEditGpuShaders'

let gpu: Gpu; let effects: VideoEditBuiltinEffectsGpu
type Texture = ReturnType<Gpu['gpu']['createTexture']>
const textures: Texture[] = []
beforeAll(async () => {
  gpu = await init(); const device = gpu.gpu
  effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), { allocate: (width, height, format) => texture(width, format) as unknown as GpuTexture, release: value => value.destroy() })
})
afterAll(() => { effects?.dispose(); textures.forEach(value => value.destroy()); gpu?.dispose() })
function texture(width: number, format: string): Texture {
  const value = gpu.gpu.createTexture({ size: [width, 1], format: format as 'rgba16float', usage: 1 | 2 | 4 | 16 }); textures.push(value); return value
}
function half(value: number): number {
  const bits = new Uint32Array(new Float32Array([value]).buffer)[0]; const exponent = ((bits >>> 23) & 255) - 127 + 15
  return exponent <= 0 ? 0 : (exponent << 10) | ((bits >>> 13) & 1023)
}
async function run(params: Record<string, number>, pixels: readonly number[], width = 64): Promise<number[]> {
  const source = texture(width, 'rgba16float'); const target = texture(width, 'rgba16float')
  const input = new Uint16Array(width * 4)
  for (let i = 0; i < width; i++) input.set(pixels.length === 4 ? pixels.map(half) : pixels.slice(i * 4, i * 4 + 4).map(half), i * 4)
  gpu.gpu.queue.writeTexture({ texture: source }, input, { bytesPerRow: width * 8 }, [width, 1])
  await effects.render({ id: 'lumetri_color', params }, { texture: source as unknown as GpuTexture, width, height: 1, format: 'rgba16float' }, target as unknown as GpuTexture, 0)
  const output = await readVideoEditPreciseRow(gpu.gpu, target, width, 0)
  return [...output].map(videoEditHalfToFloat)
}
const near = (got: readonly number[], expected: readonly number[]): void => { expected.forEach((value, i) => expect(got[i]).toBeCloseTo(value, 2)) }
describe('Lumetri 正式 GPU 像素', () => {
  it('中性逐值恒等，1024 灰阶经中性及曝光保留高精度；透明度不变', async () => {
    const pixels = Array.from({ length: 1024 }, (_, i) => [i / 1023, i / 1023, i / 1023, 1]).flat()
    const neutral = await run({}, pixels, 1024)
    neutral.forEach((x, i) => expect(x).toBe(videoEditHalfToFloat(half(pixels[i]))))
    const exposed = await run({ exposure: -.25 }, pixels, 1024)
    expect(videoEditGradientLevels(new Uint16Array(neutral.map(half)))).toBe(1024)
    expect(new Set(exposed.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(1000)
    near(await run({ exposure: 1 }, [.2, .2, .2, .5]), [lumetriSrgb(lumetriLinear(.4) * 2) * .5, lumetriSrgb(lumetriLinear(.4) * 2) * .5, lumetriSrgb(lumetriLinear(.4) * 2) * .5, .5])
  })
  it('曝光/白平衡按线性增益；曲线固定点与通道独立；红色中间调轮保持亮度', async () => {
    const gains = lumetriWhiteBalance(30, -20)
    near(await run({ temperature: 30, tint: -20 }, [.4, .4, .4, 1]), [...gains.map(g => lumetriSrgb(lumetriLinear(.4) * g)), 1])
    near(await run({ curve_master_2: 75 }, [.5, .5, .5, 1]), [.75, .75, .75, 1])
    near(await run({ curve_red_2: 75 }, [.5, .5, .5, 1]), [.75, .5, .5, 1])
    near(await run({ midtone_hue: 0, midtone_strength: 40 }, [.5, .5, .5, 1]), [.5 + .7874 * .1, .5 - .2126 * .1, .5 - .2126 * .1, 1])
    near(await run({ shadow_luminance: 40 }, [0, 0, 0, 1]), [.1, .1, .1, 1])
  })
  it('各分区的 WGSL 编译与组合执行，锐化/创意/曲线/三色轮/晕影保留透明度', async () => {
    const result = await run({ exposure: .2, contrast: 20, highlights: -20, shadows: 20, whites: 10, blacks: -10, saturation: 20, vibrance: 10, faded_film: 10, sharpen: 20, creative_shadow_hue: 240, creative_shadow_strength: 20, creative_highlight_hue: 60, creative_highlight_strength: 10, curve_green_1: 30, shadow_hue: 240, shadow_strength: 20, midtone_luminance: 10, highlight_hue: 60, highlight_strength: 10, vignette_amount: -20, vignette_roundness: 100 }, [.3, .3, .3, 1])
    expect(result.every(Number.isFinite)).toBe(true); expect(result.filter((_, i) => i % 4 === 3).every(x => x === 1)).toBe(true)
  })
})
