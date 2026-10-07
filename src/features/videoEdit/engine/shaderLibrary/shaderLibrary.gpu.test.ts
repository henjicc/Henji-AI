import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { WHITE_HEX } from '../../../../core/theme/colorTokens'
import { SHADER_EFFECT_DEFINITIONS, SHADER_TRANSITION_DEFINITIONS, SHADER_TRANSITION_PARAM_DEFINITIONS } from '../../../../core/videoEdit/shaderLibrary/catalog'
import type { VideoEditBuiltinParam } from '../../../../core/videoEdit/builtinEffects'
import type { GpuDevice, GpuTexture } from '../../../../core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditBuiltinEffectsGpu } from '../videoEditBuiltinEffectsGpu'
import { TrustedShaderLibraryRenderer, type ShaderLibraryRenderRequest } from './render'

const W = 64; const H = 36
type Device = Gpu['gpu']
let gpu: Awaited<ReturnType<typeof init>>
let device: Device
let effects: VideoEditBuiltinEffectsGpu
let renderer: TrustedShaderLibraryRenderer
const copies = 1 | 2; const sampled = 4; const attachment = 16
const benchmark = process.env.HENJI_SHADER_LIBRARY_PERF === '1'
beforeAll(async () => {
  gpu = await init(benchmark ? { requiredFeatures: ['timestamp-query'] } : {})
  device = gpu.gpu
  effects = runtime(device)
  renderer = new TrustedShaderLibraryRenderer(effects)
})
afterAll(() => { effects?.dispose(); gpu?.dispose() })
function runtime(owner: Device): VideoEditBuiltinEffectsGpu {
  return new VideoEditBuiltinEffectsGpu(owner as unknown as GpuDevice, owner.createSampler({ minFilter: 'linear', magFilter: 'linear' }), {
    allocate: (width, height, format) => owner.createTexture({ size: [width, height], format: format as 'rgba8unorm', usage: sampled | attachment }) as unknown as GpuTexture,
    release: texture => texture.destroy(),
  })
}
function target(width = W, height = H): GpuTexture { return device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: copies | sampled | attachment }) as unknown as GpuTexture }
function source(width = W, height = H, second = false): GpuTexture {
  const texture = target(width, height); const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = x < 2 ? 0 : y < 4 ? 128 : 255
    const gray = Math.round(x / (width - 1) * alpha)
    pixels.set(second ? [alpha - gray, gray, gray, alpha] : [gray, gray, y % 8 === 0 ? alpha : gray, alpha], (y * width + x) * 4)
  }
  device.queue.writeTexture({ texture: texture as never }, pixels, { bytesPerRow: width * 4 }, [width, height])
  return texture
}
async function read(texture: GpuTexture, width = W, height = H): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: 1 | 8 })
  try {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, [width, height])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
    const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
    return pixels
  } finally { buffer.unmap(); buffer.destroy() }
}
function boundaries(params: readonly VideoEditBuiltinParam[], bound: 'min' | 'max'): Record<string, unknown> { return Object.fromEntries(params.map(param => [param.key, param.type === 'number' ? param[bound] : param.default])) }
function validPremul(pixels: Uint8Array, name: string): void {
  expect(pixels.some(value => value > 0), name).toBe(true)
  for (let i = 0; i < pixels.length; i += 4) expect(Math.max(pixels[i], pixels[i + 1], pixels[i + 2]), name).toBeLessThanOrEqual(pixels[i + 3] + 1)
}

describe('可信着色器：正式WGSL与工序在Dawn上渲染', () => {
  it('全部34效果：默认非空、所有参数上下界、透明预乘、强度0恢复输入、相同秒时间逐像素确定', async () => {
    const input = source(); const output = target(); const baseline = await read(input)
    try {
      for (const definition of SHADER_EFFECT_DEFINITIONS) {
        const request = { name: definition.id, input, output, width: W, height: H, format: 'rgba8unorm', timeSeconds: 1.25 }
        await renderer.render(request); const first = await read(output); validPremul(first, definition.id)
        // Evaluate out of order before repeating: no effect may depend on its previous frame.
        await renderer.render({ ...request, timeSeconds: 8.5 })
        await renderer.render(request); expect(await read(output), definition.id).toEqual(first)
        for (const bound of ['min', 'max'] as const) {
          await renderer.render({ ...request, params: boundaries(definition.params, bound) }); validPremul(await read(output), `${definition.id}:${bound}`)
        }
        await renderer.render({ ...request, params: { strength: 0 } }); expect(await read(output), definition.id).toEqual(baseline)
      }
    } finally { input.destroy(); output.destroy() }
  }, 60_000)
  it('全部6转场：首尾与单侧透明准确，中帧/参数边界非空，种子与进度确定，强度0交叉溶解', async () => {
    const input = source(); const second = source(W, H, true); const output = target()
    const firstPixels = await read(input); const lastPixels = await read(second)
    try {
      for (const definition of SHADER_TRANSITION_DEFINITIONS) {
        const request = { name: definition.kind, input, second, output, width: W, height: H, format: 'rgba8unorm', timeSeconds: 1, progress: .5 }
        await renderer.render(request); const middle = await read(output); validPremul(middle, definition.kind)
        await renderer.render(request); expect(await read(output)).toEqual(middle)
        for (const bound of ['min', 'max'] as const) { await renderer.render({ ...request, params: boundaries(SHADER_TRANSITION_PARAM_DEFINITIONS[definition.kind], bound) }); validPremul(await read(output), definition.kind) }
        await renderer.render({ ...request, progress: 0 }); expect(await read(output)).toEqual(firstPixels)
        await renderer.render({ ...request, progress: 1 }); expect(await read(output)).toEqual(lastPixels)
        await renderer.render({ ...request, progress: 0, emptyOutgoing: true }); expect((await read(output)).every(value => value === 0)).toBe(true)
        await renderer.render({ ...request, progress: 1, emptyIncoming: true }); expect((await read(output)).every(value => value === 0)).toBe(true)
        await renderer.render({ ...request, params: { strength: 0 } }); const dissolved = await read(output)
        for (let i = 0; i < dissolved.length; i++) expect(Math.abs(dissolved[i] - (firstPixels[i] + lastPixels[i]) / 2)).toBeLessThanOrEqual(1)
      }
    } finally { input.destroy(); second.destroy(); output.destroy() }
  }, 60_000)
  it('辉光PRO有光晕与保色高光肩部；静态图案不随秒时间变，动态波浪随时间变', async () => {
    const input = source(); const output = target()
    const request = { name: 'shader_glow_pro', input, output, width: W, height: H, format: 'rgba8unorm', timeSeconds: 1 }
    try {
      await renderer.render(request); const glow = await read(output); expect(glow).not.toEqual(await read(input))
      for (const name of ['shader_linear_gradient', 'shader_wave']) {
        await renderer.render({ ...request, name, timeSeconds: 0 }); const first = await read(output)
        await renderer.render({ ...request, name, timeSeconds: 2 }); const next = await read(output)
        if (name === 'shader_wave') expect(next).not.toEqual(first)
        else expect(next).toEqual(first)
      }
    } finally { input.destroy(); output.destroy() }
  }, 60_000)
  it.runIf(benchmark)('4K代表效果GPU时间戳；单效果预算与硬件证据写入缓存', async () => {
    const querySet = device.createQuerySet({ type: 'timestamp', count: 128 })
    const resolve = device.createBuffer({ size: 128 * 8, usage: 0x200 | 4 })
    const staging = device.createBuffer({ size: 128 * 8, usage: 1 | 8 })
    let count = 0
    const timed = new Proxy(device, { get(owner, key) {
      if (key === 'createCommandEncoder') return (): ReturnType<Device['createCommandEncoder']> => {
        const encoder = owner.createCommandEncoder()
        return new Proxy(encoder, { get(raw, prop) {
          if (prop === 'beginRenderPass') return (descriptor: Parameters<typeof raw.beginRenderPass>[0]): ReturnType<typeof raw.beginRenderPass> => {
            const begin = count++; const end = count++
            return raw.beginRenderPass({ ...descriptor, timestampWrites: { querySet, beginningOfPassWriteIndex: begin, endOfPassWriteIndex: end } })
          }
          if (prop === 'finish') return (): ReturnType<typeof raw.finish> => {
            if (count) { raw.resolveQuerySet(querySet, 0, count, resolve, 0); raw.copyBufferToBuffer(resolve, 0, staging, 0, count * 8) }
            return raw.finish()
          }
          const value: unknown = Reflect.get(raw, prop); return value instanceof Function ? value.bind(raw) : value
        } })
      }
      const value: unknown = Reflect.get(owner, key); return value instanceof Function ? value.bind(owner) : value
    } })
    const local = runtime(timed); const api = new TrustedShaderLibraryRenderer(local)
    const input = source(3840, 2160); const second = source(3840, 2160, true); const output = target(3840, 2160)
    const results: Array<{ name: string; gpuMedianMs: number; gpuP95Ms: number; passes: number; over4K60Budget: boolean }> = []
    try {
      for (const name of ['shader_linear_gradient', 'shader_fractal_noise', 'shader_aurora', 'shader_worley_noise', 'shader_glass', 'shader_ascii', 'shader_zoom_blur', 'shader_glow_pro', 'shader_noise_dissolve', 'glow']) {
        const samples: number[] = []
        for (let sample = 0; sample < 15; sample++) {
          count = 0
          const request: ShaderLibraryRenderRequest = { name, input, second, output, width: 3840, height: 2160, format: 'rgba8unorm', timeSeconds: sample / 60, progress: .5 }
          if (name === 'glow') await local.render({ id: name, params: {} }, { texture: input, width: 3840, height: 2160, format: 'rgba8unorm' }, output, sample)
          else await api.render(request)
          await staging.mapAsync(1); const ticks = new BigUint64Array(staging.getMappedRange()); let nanoseconds = 0n
          for (let i = 0; i < count; i += 2) nanoseconds += ticks[i + 1] - ticks[i]
          staging.unmap(); if (sample >= 3) samples.push(Number(nanoseconds) / 1e6)
          local.releaseIdle()
        }
        samples.sort((a, b) => a - b)
        const median = samples[Math.floor(samples.length / 2)]; const p95 = samples[Math.ceil(samples.length * .95) - 1]
        expect(median).toBeGreaterThan(0)
        results.push({ name, gpuMedianMs: median, gpuP95Ms: p95, passes: count / 2, over4K60Budget: p95 > 1000 / 60 })
      }
      const folder = path.resolve('node_modules/.cache/t66-shader-library'); mkdirSync(folder, { recursive: true })
      writeFileSync(path.join(folder, 'performance.json'), JSON.stringify({ adapter: gpu.adapter, dimensions: [3840, 2160], format: 'rgba8unorm', method: 'GPU timestamp sum, 3 warmup + 12 samples, nanoseconds converted to ms', results }, null, 2))
      // Export production pixels for visual review, not an Electron/DOM surrogate.
      const thumbWidth = 256; const thumbHeight = 144
      const thumbInput = source(thumbWidth, thumbHeight); const thumbOutput = target(thumbWidth, thumbHeight)
      const panels: OverlayOptions[] = []
      try {
        const names = [...SHADER_EFFECT_DEFINITIONS.map(definition => definition.id), 'glow']
        for (const [index, name] of names.entries()) {
          count = 0
          if (name === 'glow') await local.render({ id: name, params: {} }, { texture: thumbInput, width: thumbWidth, height: thumbHeight, format: 'rgba8unorm' }, thumbOutput, 0)
          else await api.render({ name, input: thumbInput, output: thumbOutput, width: thumbWidth, height: thumbHeight, format: 'rgba8unorm', timeSeconds: 1 })
          const pixels = await read(thumbOutput, thumbWidth, thumbHeight)
          const png = await sharp(pixels, { raw: { width: thumbWidth, height: thumbHeight, channels: 4 } }).png().toBuffer()
          const left = (index % 5) * thumbWidth; const top = Math.floor(index / 5) * (thumbHeight + 24)
          panels.push({ input: png, left, top })
          panels.push({ input: Buffer.from(`<svg width="256" height="24"><text x="4" y="17" fill="${WHITE_HEX}" font-size="12">${name}</text></svg>`), left, top: top + thumbHeight })
        }
        await sharp({ create: { width: thumbWidth * 5, height: Math.ceil(names.length / 5) * (thumbHeight + 24), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).composite(panels).png().toFile(path.join(folder, 'contact-sheet.png'))
      } finally { thumbInput.destroy(); thumbOutput.destroy() }
    } finally { local.dispose(); input.destroy(); second.destroy(); output.destroy(); resolve.destroy(); staging.destroy(); querySet.destroy() }
  }, 120_000)
})
