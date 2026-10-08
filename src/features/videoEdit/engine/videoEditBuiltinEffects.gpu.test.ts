import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isShaderGraphEffect } from '@/core/videoEdit/shaderGraph/effects'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'

// 任务 4.7b 真实设备专项：内置效果的正式 WGSL 与工序在 Dawn 上编译并逐像素核对关键结果。npm run test:gpu 无条件执行。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
const W = 64; const H = 36
type Device = Gpu['gpu']
let gpu: Gpu
let device: Device
let effects: VideoEditBuiltinEffectsGpu
beforeAll(async () => {
  gpu = await init(); device = gpu.gpu
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, sampler, {
    allocate: (width, height, format) => device.createTexture({ size: [width, height], format: format as 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_DST }) as unknown as GpuTexture,
    release: texture => texture.destroy(),
  })
})
afterAll(() => { effects?.dispose(); gpu?.dispose() })

/** 不透明的水平灰阶，左上角一个纯红像素（看翻转与位置）。 */
function input(): GpuTexture {
  const texture = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC })
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const at = (y * W + x) * 4; const value = Math.round(x / (W - 1) * 255); data.set([value, value, value, 255], at) }
  data.set([255, 0, 0, 255], 0)
  device.queue.writeTexture({ texture }, data, { bytesPerRow: W * 4 }, [W, H])
  return texture as unknown as GpuTexture
}
function output(): GpuTexture { return device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture }
async function read(texture: GpuTexture): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(W * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * H, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, { width: W, height: H, depthOrArrayLayers: 1 })
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4)
  buffer.unmap(); buffer.destroy()
  return pixels
}
async function run(id: string, params: Record<string, unknown> = {}, frame = 0): Promise<Uint8Array> {
  const source = input(); const target = output()
  await effects.render({ id, params: params as Record<string, number> }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, frame)
  return read(target)
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]

describe('剪辑内置效果（真实设备）', () => {
  it('24个多工序模糊复用中间纹理，24份不同调色曲线跨帧不重复上传或编译', async () => {
    let allocations = 0; let compiles = 0; let scratchAllocations = 0
    const counted = new Proxy(device, { get: (target, key) => {
      if (key === 'createTexture') return (descriptor: Parameters<Device['createTexture']>[0]) => { allocations++; return target.createTexture(descriptor) }
      if (key === 'createRenderPipeline') return (descriptor: Parameters<Device['createRenderPipeline']>[0]) => { compiles++; return target.createRenderPipeline(descriptor) }
      const value = Reflect.get(target, key) as unknown
      return value instanceof Function ? value.bind(target) : value
    } })
    const local = new VideoEditBuiltinEffectsGpu(counted as unknown as GpuDevice, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), {
      allocate: (width, height, format) => { scratchAllocations++; return counted.createTexture({ size: [width, height], format: format as 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT }) as unknown as GpuTexture },
      release: texture => texture.destroy(),
    })
    const source = input(); const first = output(); const second = output()
    const blur = { id: 'gaussian_blur', params: { strength: 100 } }
    const draw = async (instance: Parameters<typeof local.render>[0], from: GpuTexture, to: GpuTexture): Promise<void> => local.render(instance, { texture: from, width: W, height: H, format: 'rgba8unorm' }, to, 0)
    try {
      await draw(blur, source, first)
      const oneEffect = { allocations, compiles, scratchAllocations }
      let current = first
      for (let index = 0; index < 24; index++) { const next = current === first ? second : first; await draw(blur, current, next); current = next }
      expect({ allocations, compiles, scratchAllocations }).toEqual(oneEffect)
      const curves = Array.from({ length: 24 }, (_, index) => ({ id: 'color_grade', params: { curve_master_2: 51 + index } }))
      let warm: { allocations: number; compiles: number; scratchAllocations: number } | undefined
      for (let frame = 0; frame < 2; frame++) {
        local.releaseIdle()
        for (const curve of curves) { const next = current === first ? second : first; await draw(curve, current, next); current = next }
        const count = { allocations, compiles, scratchAllocations }
        if (warm) expect(count).toEqual(warm)
        else warm = count
      }
      // One blur scratch and ColorGrade's two ping-pong textures, shared across all instances.
      expect(scratchAllocations).toBe(2)
      expect(pixel(await read(current), W / 2, H / 2)[3]).toBe(255)
    } finally { local.dispose(); source.destroy(); first.destroy(); second.destroy() }
  }, 60_000)
  it('全部效果的着色器在设备上编译，默认参数出画面且不透明区域保持不透明', async () => {
    // shaders.* 组件效果的真实设备覆盖在 shaderEngines/shaderGraph.gpu.test.ts。
    for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(value => value.media !== 'audio' && !isShaderGraphEffect(value.id))) {
      const pixels = await run(definition.id, videoEditBuiltinDefaults(definition))
      if (!['crop', 'chroma_key'].includes(definition.id)) expect(pixel(pixels, W / 2, H / 2)[3], definition.id).toBe(255)
    }
  }, 60_000)
  it('关键结果：反相、水平翻转、零强度模糊不变、模糊保持亮度均值、裁剪透明、抠掉纯绿', async () => {
    const original = await run('gaussian_blur', { strength: 0 })
    expect(pixel(original, 0, 0)).toEqual([255, 0, 0, 255]); expect(pixel(original, 10, 5)).toEqual([Math.round(10 / 63 * 255), Math.round(10 / 63 * 255), Math.round(10 / 63 * 255), 255])
    expect(pixel(await run('invert'), 0, 0)).toEqual([0, 255, 255, 255])
    expect(pixel(await run('flip', { axis: 'horizontal' }), W - 1, 0)).toEqual([255, 0, 0, 255])
    const blurred = await run('gaussian_blur', { strength: 100 })
    const row = (pixels: Uint8Array): number => Array.from({ length: W }, (_, x) => pixels[(18 * W + x) * 4 + 1]).reduce((sum, value) => sum + value, 0) / W
    expect(Math.abs(row(blurred) - row(original))).toBeLessThan(3)
    // 左上角的红点被晕开到相邻像素
    expect(pixel(blurred, 1, 1)[0] - pixel(blurred, 1, 1)[1]).toBeGreaterThan(10)
    const cropped = await run('crop', { left: 50 })
    expect(pixel(cropped, 5, 18)[3]).toBe(0); expect(pixel(cropped, 50, 18)[3]).toBe(255)
    const keyed = await run('chroma_key', { key_color: `#${'ff0000'}`, tolerance: 20, softness: 0, spill: 0 })
    expect(pixel(keyed, 0, 0)[3]).toBe(0); expect(pixel(keyed, 32, 18)[3]).toBe(255)
    const bw = await run('black_white')
    expect(new Set(pixel(bw, 0, 0).slice(0, 3)).size).toBe(1)
  }, 60_000)
  it('胶片颗粒同一帧逐像素相同，换一帧不同', async () => {
    const a = await run('film_grain', { amount: 60 }, 7); const b = await run('film_grain', { amount: 60 }, 7); const c = await run('film_grain', { amount: 60 }, 8)
    expect([...a]).toEqual([...b]); expect([...a]).not.toEqual([...c])
  }, 30_000)
})
