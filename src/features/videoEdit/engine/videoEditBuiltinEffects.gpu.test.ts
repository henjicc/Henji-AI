import { videoEditHalfToFloat } from './videoEditGpuShaders'
import { blurAmountForSigma } from '@/core/videoEdit/blur'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { authorEffectBleed } from '@/core/videoEdit/authorEffects'
import { float32ToFloat16 } from '../../imageEdit/v3/gpu/imageEditorGpuTileAtlasV3'
import { VideoEditAuthorEffects } from './videoEditAuthorEffects'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditCodePicture } from './videoEditCodePicture'
import { resolveAuthorEffects } from '@/core/videoEdit/authorEffects'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isShaderGraphEffect } from '@/core/videoEdit/shaderGraph/effects'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { VideoEditBuiltinEffectsGpu, type BuiltinEncodingBatch, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import { planAuthorDefocus } from './videoEditBuiltinEffectPasses'
import { authorLayerBlur } from './videoEditAuthorLayers'
import type { RecordingCursorDraw } from './videoEditRecordingCursorPlan'
import { RECORDING_FRAME_SOLID_DEFAULT_HEX, WHITE_HEX } from '@/core/theme/colorTokens'

// 任务 4.7b 真实设备专项：内置效果的正式 WGSL 与工序在 Dawn 上编译并逐像素核对关键结果。npm run test:gpu 无条件执行。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
const W = 64; const H = 36
type Device = Gpu['gpu']
let gpu: Gpu
let device: Device
let effects: VideoEditBuiltinEffectsGpu
function allocator(): VideoEditBuiltinScratchAllocator {
  return {
    allocate: (width, height, format, mipLevelCount = 1) => device.createTexture({ size: [width, height], format: format as 'rgba8unorm', mipLevelCount, usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_DST }) as unknown as GpuTexture,
    release: texture => texture.destroy(),
  }
}
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
async function read(texture: GpuTexture, width = W, height = H): Promise<Uint8Array> {
  const precise = texture.format === 'rgba16float'
  const bpp = precise ? 8 : 4
  const bytesPerRow = Math.ceil(width * bpp / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, { width, height, depthOrArrayLayers: 1 })
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(BUFFER_MAP_READ)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    if (precise) {
      const row = new Uint16Array(mapped.buffer, y * bytesPerRow, width * 4)
      for (let x = 0; x < row.length; x++) pixels[y * width * 4 + x] = Math.round(Math.min(1, Math.max(0, videoEditHalfToFloat(row[x]))) * 255)
    } else pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
  }
  buffer.unmap(); buffer.destroy()
  return pixels
}
async function run(id: string, params: Record<string, unknown> = {}, frame = 0): Promise<Uint8Array> {
  const source = input(); const target = output()
  await effects.render({ id, params: params as Record<string, number> }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, frame)
  return read(target)
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]

it.each([false, true])('30px 镜头散焦细线无横纹（前置效果：%s）', async precedingEffects => {
  const width = 228, height = 248, d = device as unknown as GpuDevice
  const host = new VideoEditCodeGpu(d), author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, host.effectAllocator)
  const source = host.effectAllocator.allocate(width, height, 'rgba8unorm', 1 + Math.floor(Math.log2(Math.max(width, height))))
  const target = host.effectAllocator.allocate(1280, 720, 'rgba8unorm')
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height + 256 * 62, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const data = new Uint8Array(width * height * 4)
  for (const [y0, thickness, color] of [[64, 5, [255, 255, 255]], [88, 3, [255, 48, 64]], [112, 3, [48, 64, 255]]] as const) {
    for (let y = y0; y < y0 + thickness; y++) for (let x = 64; x < 154; x++) data.set([...color, 255], (y * width + x) * 4)
  }
  device.queue.writeTexture({ texture: source as never }, data, { bytesPerRow: width * 4 }, [width, height])
  try {
    await author.begin(target); chain.begin(author.commandEncoder())
    device.pushErrorScope('validation')
    author.mipmaps(source, width, height)
    const result = await chain.encode('lines', source, width, height,
      resolveAuthorEffects(precedingEffects ? [{ id: 'color_grade' }] : []),
      { referenceSize: { width: 1280, height: 720 }, contentBounds: { x: 0, y: 0, width: 100, height: 120 }, rasterScale: 1, rasterOrigin: [64, 64], quality: 'final' },
      {}, undefined, { radius: 30, lens: true }, texture => author.mipmaps(texture, width, height))
    author.finish(); chain.commit()
    const rendered = await read(result.picture, width, height)
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: source as never, mipLevel: 2 }, { buffer, offset: bytesPerRow * height, bytesPerRow: 256 }, [57, 62, 1])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(BUFFER_MAP_READ)
    const pixels = new Uint8Array(buffer.getMappedRange())
    for (let y = 0; y < height; y++) pixels.set(rendered.subarray(y * width * 4, (y + 1) * width * 4), y * bytesPerRow)
    const rows = Array.from({ length: height }, (_, y) => {
      let sum = 0
      for (let x = 100; x < 118; x++) {
        const at = y * bytesPerRow + x * 4
        sum += .2126 * pixels[at] + .7152 * pixels[at + 1] + .0722 * pixels[at + 2]
      }
      return sum / 18
    })
    let highFrequency = 0
    for (let y = 35; y < 145; y++) highFrequency += (rows[y - 1] - 2 * rows[y] + rows[y + 1]) ** 2
    highFrequency = Math.sqrt(highFrequency / 110)
    let luminance = 0, energy = 0, alpha = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = y * bytesPerRow + x * 4
      luminance += .2126 * pixels[at] + .7152 * pixels[at + 1] + .0722 * pixels[at + 2]
      energy += pixels[at] + pixels[at + 1] + pixels[at + 2]; alpha += pixels[at + 3]
    }
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') process.stdout.write(`lens 前置效果=${precedingEffects} ${JSON.stringify({ highFrequency, meanLuminance: luminance / (width * height), energy, alpha })}\n`)
    const mipOffset = bytesPerRow * height
    const mipSamples = [16, 17, 22, 28].map(y => pixels[mipOffset + y * 256 + 27 * 4])
    buffer.unmap()
    expect(await device.popErrorScope()).toBeNull()
    // 同批生成的第二层须含预期细线覆盖率，避免把未生成的黑色 mip 误判成平滑结果。
    expect(mipSamples).toEqual([255, 64, 191, 36])
    expect(Math.max(...rows)).toBeGreaterThan(10)
    expect(highFrequency).toBeLessThan(1.5)
    // 固定圆盘在此夹具的 GPU 基线；约束亮度和预乘 RGB/透明度总能量，不能用减弱散焦消除横纹。
    expect(Math.abs(luminance / (width * height) / 4.009582374787763 - 1)).toBeLessThan(.03)
    expect(Math.abs(energy / 753335 - 1)).toBeLessThan(.03)
    expect(Math.abs(alpha / 334385 - 1)).toBeLessThan(.03)
  } finally { buffer.destroy(); chain.dispose(); await author.dispose(); host.effectAllocator.release(source); host.effectAllocator.release(target); await host.dispose() }
})

it('镜头散焦保留高光光斑的亮度、能量和大小，逐帧重编码稳定且与模糊效果的镜头方式一致', async () => {
  const width = 192, height = 192, radius = 30, d = device as unknown as GpuDevice
  const host = new VideoEditCodeGpu(d), author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, host.effectAllocator)
  const source = host.effectAllocator.allocate(width, height, 'rgba8unorm', 1 + Math.floor(Math.log2(width)))
  const target = host.effectAllocator.allocate(width, height, 'rgba16float')
  const direct = new VideoEditBuiltinEffectsGpu(d, device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' }), host.effectAllocator)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - width / 2, dy = y + .5 - height / 2
    if (dx * dx + dy * dy <= 36) data.set([255, 240, 192, 255], (y * width + x) * 4)
  }
  device.queue.writeTexture({ texture: source as never }, data, { bytesPerRow: width * 4 }, [width, height])
  try {
    let first: Uint8Array | undefined
    for (const frame of [0, 1, 47]) {
      await author.begin(target); chain.begin(author.commandEncoder())
      author.mipmaps(source, width, height)
      // 不提供内容键，确保每帧都执行着色器，不能靠复用缓存通过稳定性断言。
      const result = await chain.encode('spot', source, width, height, [],
        { referenceSize: { width, height }, contentBounds: { x: 0, y: 0, width, height }, rasterScale: 1, rasterOrigin: [0, 0], quality: 'final' },
        {}, undefined, { radius, lens: true }, texture => author.mipmaps(texture, width, height))
      author.finish(); chain.commit()
      const pixels = await read(result.picture, width, height)
      if (first) expect(pixels).toEqual(first)
      else first = pixels
      await direct.render({ id: 'blur', params: { mode: 'lens', amount: blurAmountForSigma(radius / height / 2), repeat_edges: false } }, { texture: source, width, height, format: 'rgba16float' }, target, frame)
      expect(await read(target, width, height)).toEqual(first)
    }
    let luminance = 0, energy = 0, alpha = 0, moment = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, pixels = first!
      const light = .2126 * pixels[at] + .7152 * pixels[at + 1] + .0722 * pixels[at + 2]
      luminance += light; energy += pixels[at] + pixels[at + 1] + pixels[at + 2]; alpha += pixels[at + 3]
      moment += light * ((x + .5 - width / 2) ** 2 + (y + .5 - height / 2) ** 2)
    }
    const rmsRadius = Math.sqrt(moment / luminance)
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') process.stdout.write(`lens 高光 ${JSON.stringify({ meanLuminance: luminance / (width * height), energy, alpha, rmsRadius })}\n`)
    // 同参数固定圆盘的 GPU 基线；二阶矩同时约束光斑大小，防止缩小半径换取平滑。
    expect(Math.abs(luminance / (width * height) / 1.1957859809027416 - 1)).toBeLessThan(.03)
    expect(Math.abs(energy / 126327 - 1)).toBeLessThan(.03)
    expect(Math.abs(alpha / 46925 - 1)).toBeLessThan(.03)
    expect(Math.abs(rmsRadius / 21.624576292927294 - 1)).toBeLessThan(.03)
  } finally { direct.dispose(); chain.dispose(); await author.dispose(); host.effectAllocator.release(source); host.effectAllocator.release(target); await host.dispose() }
})

function budgetAllocator(host: VideoEditCodeGpu): VideoEditBuiltinScratchAllocator & { residentBytes: number; peak: number; peakPrecise: number; peakEight: number; allocations: number } {
  const live = new Map<GpuTexture, { bytes: number; precise: boolean }>()
  const measured = {
    get residentBytes(): number { return [...live.values()].reduce((sum, entry) => sum + entry.bytes, 0) },
    peak: 0, peakPrecise: 0, peakEight: 0, allocations: 0,
    allocate(width: number, height: number, format: string, mipLevelCount = 1): GpuTexture {
      const texture = host.effectAllocator.allocate(width, height, format, mipLevelCount)
      let pixels = 0
      for (let i = 0; i < mipLevelCount; i++) pixels += Math.max(1, Math.floor(width / 2 ** i)) * Math.max(1, Math.floor(height / 2 ** i))
      live.set(texture, { bytes: pixels * (format === 'rgba32float' ? 16 : format === 'rgba16float' ? 8 : 4), precise: format !== 'rgba8unorm' })
      const all = [...live.values()], precise = all.filter(value => value.precise).reduce((sum, value) => sum + value.bytes, 0), eight = all.filter(value => !value.precise).reduce((sum, value) => sum + value.bytes, 0)
      measured.peakPrecise = Math.max(measured.peakPrecise, precise); measured.peakEight = Math.max(measured.peakEight, eight)
      measured.peak = Math.max(measured.peak, precise + eight); measured.allocations++
      return texture
    },
    release(texture: GpuTexture): void { expect(live.delete(texture)).toBe(true); host.effectAllocator.release(texture) },
  }
  return measured
}

it('1080p 与 4K 默认发光：小字与宽层、两层静止及三层参数动画 60 帧复用稳定并记录真实峰值', async () => {
  for (const [frameWidth, frameHeight] of [[1920, 1080], [3840, 2160]]) for (const [contentWidth, contentHeight] of [[100, 40], [800, 200]]) for (const rasterScale of [1, 2]) {
    const d = device as unknown as GpuDevice, host = new VideoEditCodeGpu(d), measured = budgetAllocator(host)
    const author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, measured)
    const target = measured.allocate(frameWidth, frameHeight, 'rgba8unorm')
    let source: GpuTexture | undefined, previousPad = -1, warmAllocations = 0, previousAllocations = 0
    try {
      device.pushErrorScope('validation')
      for (let frame = 0; frame < 62; frame++) {
        const effects = resolveAuthorEffects([{ id: 'glow', params: frame < 2 ? {} : { strength: 40 + Math.sin(frame / 10), radius: 60 + Math.sin(frame / 10) } }])
        const reference = { referenceSize: { width: frameWidth, height: frameHeight }, contentBounds: { x: 0, y: 0, width: contentWidth, height: contentHeight }, rasterScale, rasterOrigin: [0, 0] as [number, number], quality: 'final' as const }
        const pad = Math.max(16, Math.ceil((authorEffectBleed(effects, reference) * frameHeight * rasterScale + 4) / 64) * 64)
        const width = contentWidth * rasterScale + pad * 2, height = contentHeight * rasterScale + pad * 2
        reference.rasterOrigin = [pad, pad]
        if (pad !== previousPad) {
          if (source) measured.release(source)
          source = measured.allocate(width, height, 'rgba8unorm', 1 + Math.floor(Math.log2(Math.max(width, height))))
          const pixels = new Uint8Array(width * height * 4)
          for (let y = pad; y < pad + contentHeight * rasterScale; y++) pixels.fill(255, (y * width + pad) * 4, (y * width + pad + contentWidth * rasterScale) * 4)
          device.queue.writeTexture({ texture: source as never }, pixels, { bytesPerRow: width * 4 }, [width, height])
        }
        await author.begin(target); chain.begin(author.commandEncoder())
        if (pad !== previousPad) author.mipmaps(source!, width, height)
        for (let layer = 0; layer < (frame < 2 ? 2 : 3); layer++) {
          const result = await chain.encode(`title:${layer}`, source!, width, height, effects, reference, {}, `white:${pad}`, { radius: 0, lens: false }, texture => author.mipmaps(texture, width, height))
          author.draw(target, frameWidth, frameHeight, { texture: result.picture, x: -pad, y: -pad, width, height }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, frameWidth / 2, frameHeight / 2], opacity: 1 } }])
        }
        author.finish(); chain.commit(); await device.queue.onSubmittedWorkDone()
        if (frame === 0) warmAllocations = measured.allocations
        if (frame === 1) expect(measured.allocations).toBe(warmAllocations)
        if (frame > 2 && pad === previousPad) expect(measured.allocations).toBe(previousAllocations)
        previousAllocations = measured.allocations
        previousPad = pad
      }
      expect(await device.popErrorScope()).toBeNull()
      expect(measured.residentBytes).toBe(host.diagnostics().residentBytes)
      process.stdout.write(`发光预算峰值 MiB ${JSON.stringify({ frameWidth, frameHeight, contentWidth, contentHeight, rasterScale, pad: previousPad, total: measured.peak / 1024 ** 2, rgba8: measured.peakEight / 1024 ** 2, precise: measured.peakPrecise / 1024 ** 2 })}\n`)
    } finally { try { chain.dispose(); await author.dispose(); if (source) measured.release(source); measured.release(target) } finally { await host.dispose() } }
    expect(measured.residentBytes).toBe(0)
    expect(host.diagnostics().residentBytes).toBe(0)
  }
}, 300_000)

it('默认发光按能量截断：未裁切参考在规划边界之外不足半级，不切掉可见光', async () => {
  const d = device as unknown as GpuDevice, host = new VideoEditCodeGpu(d), author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, host.effectAllocator)
  const contentWidth = 800, contentHeight = 200, pad = 1280, width = contentWidth + pad * 2, height = contentHeight + pad * 2
  const source = host.effectAllocator.allocate(width, height, 'rgba8unorm'), target = host.effectAllocator.allocate(1, 1, 'rgba8unorm')
  const context = { referenceSize: { width: 1920, height: 1080 }, contentBounds: { x: 0, y: 0, width: contentWidth, height: contentHeight }, rasterScale: 1, rasterOrigin: [pad, pad] as const, quality: 'final' as const }
  const effects = resolveAuthorEffects([{ id: 'glow', params: { source_opacity: 0 } }])
  const cutoff = Math.ceil(authorEffectBleed(effects, context) * 1080)
  const pixels = new Uint8Array(width * height * 4)
  for (let y = pad; y < pad + contentHeight; y++) pixels.fill(255, (y * width + pad) * 4, (y * width + pad + contentWidth) * 4)
  device.queue.writeTexture({ texture: source as never }, pixels, { bytesPerRow: width * 4 }, [width, height])
  try {
    await author.begin(target); chain.begin(author.commandEncoder())
    const result = await chain.encode('reference', source, width, height, effects, context, {}, undefined, { radius: 0, lens: false }, texture => author.mipmaps(texture, width, height))
    author.finish(); chain.commit()
    const data = await read(result.picture, width, height), bytesPerRow = width * 4
    let tail = 0, visible = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const value = data[y * bytesPerRow + x * 4]
      if (x < pad - cutoff || x >= pad + contentWidth + cutoff || y < pad - cutoff || y >= pad + contentHeight + cutoff) tail = Math.max(tail, value)
      else visible = Math.max(visible, value)
    }
    expect(visible).toBeGreaterThan(20); expect(tail).toBe(0)
  } finally { chain.dispose(); await author.dispose(); host.effectAllocator.release(source); host.effectAllocator.release(target); await host.dispose() }
}, 60_000)

it('已预热的 pose.blur scratch 在连续弃帧时保留复用，恢复提交有正确像素', async () => {
  const d = device as unknown as GpuDevice, host = new VideoEditCodeGpu(d), measured = budgetAllocator(host), chain = new VideoEditAuthorEffects(d, measured), author = new VideoEditAuthorGpu(d)
  const source = input(), target = output(), context = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
  try {
    let warm = 0
    for (let frame = 0; frame < 20; frame++) {
      await author.begin(target); chain.begin(author.commandEncoder())
      const result = await chain.encode('blur', source, W, H, [], context, {}, undefined, { radius: 1 + frame / 100, lens: false }, texture => author.mipmaps(texture, W, H))
      if (frame === 0) warm = measured.allocations
      else expect(measured.allocations).toBe(warm)
      if (frame > 0 && frame < 19) { author.abandon(); chain.abandon() }
      else {
        author.draw(target, W, H, { texture: result.picture, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
        author.finish(); chain.commit()
      }
    }
    expect(pixel(await read(target), W / 2, H / 2)[3]).toBe(255)
  } finally { chain.dispose(); await author.dispose(); source.destroy(); target.destroy(); await host.dispose() }
})

it('弃帧未用到的预热 scratch 档位在拖动返回时仍能复用', async () => {
  const d = device as unknown as GpuDevice, host = new VideoEditCodeGpu(d), measured = budgetAllocator(host)
  const local = new VideoEditBuiltinEffectsGpu(d, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), measured)
  const source = input(), target = output()
  const encode = async (radius: number, commit: boolean): Promise<void> => {
    const batch: BuiltinEncodingBatch = { encoder: d.createCommandEncoder(), uniformIndex: 0, taken: new Set(), created: new Set() }
    await local.encodePlan(planAuthorDefocus(W, H, radius, false), 'rgba8unorm', source, target, undefined, [], batch)
    if (commit) { d.queue.submit([batch.encoder.finish()]); local.releaseIdle() }
    else local.abandon(batch)
  }
  try {
    await encode(2, true)
    const warm = measured.allocations
    for (let index = 0; index < 4; index++) await encode(0, false)
    await encode(2, true)
    expect(measured.allocations).toBe(warm)
    expect(pixel(await read(target), W / 2, H / 2)[3]).toBe(255)
  } finally { local.dispose(); source.destroy(); target.destroy(); await host.dispose() }
})

it('4K 10-bit 输入加 final 高斯保留 32f 工序，复用峰值低于 512MiB', async () => {
  const width = 3840, height = 2160, d = device as unknown as GpuDevice, host = new VideoEditCodeGpu(d), measured = budgetAllocator(host)
  const local = new VideoEditBuiltinEffectsGpu(d, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), measured)
  const source = measured.allocate(width, height, 'rgba16float'), target = measured.allocate(width, height, 'rgba16float')
  // 10 位解码后的正式工作格式，额外保留一幅高精度素材表面覆盖导出期间的在途画面。
  const inFlight = measured.allocate(width, height, 'rgba16float')
  const value = float32ToFloat16(512 / 1023), row = new Uint16Array(width * height * 4)
  for (let i = 0; i < row.length; i += 4) row.set([value, value, value, float32ToFloat16(1)], i)
  device.queue.writeTexture({ texture: source as never }, row, { bytesPerRow: width * 8 }, [width, height])
  try {
    device.pushErrorScope('validation')
    for (const amount of [17.43, 40.01, 79.67]) {
      await local.render({ id: 'blur', params: { amount } }, { texture: source, width, height, format: 'rgba16float' }, target, 0, 1, [], 'final')
      await device.queue.onSubmittedWorkDone(); local.releaseIdle()
    }
    const buffer = device.createBuffer({ size: 256, usage: BUFFER_MAP_READ | BUFFER_COPY_DST }), encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: target as never, origin: [width / 2, height / 2] }, { buffer, bytesPerRow: 256 }, [1, 1, 1])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(BUFFER_MAP_READ)
    expect([...new Uint16Array(buffer.getMappedRange()).slice(0, 4)]).toEqual([value, value, value, float32ToFloat16(1)])
    buffer.unmap(); buffer.destroy()
    expect(await device.popErrorScope()).toBeNull(); expect(measured.peakPrecise).toBeLessThan(512 * 1024 ** 2)
    process.stdout.write(`4K 10-bit final 高斯预算峰值 MiB ${measured.peakPrecise / 1024 ** 2}\n`)
  } finally { local.dispose(); measured.release(source); measured.release(target); measured.release(inFlight); await host.dispose() }
}, 120_000)

it('半透明边缘推亮后，片段与图层调色均保持 RGB≤alpha，其他层产光不改变调色结果', async () => {
  const source = input(), target = output(), author = new VideoEditAuthorGpu(device as unknown as GpuDevice), chain = new VideoEditAuthorEffects(device as unknown as GpuDevice, allocator())
  const pixels = new Uint8Array(W * H * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([96, 64, 32, 128], i)
  device.queue.writeTexture({ texture: source as never }, pixels, { bytesPerRow: W * 4 }, [W, H])
  const grade = resolveAuthorEffects([{ id: 'color_grade', params: { exposure: 4, saturation: 100 } }])
  const context = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
  try {
    await effects.render(grade[0], { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
    const expected = await read(target)
    expect(expected.every((v, i) => i % 4 === 3 || v <= expected[i - i % 4 + 3])).toBe(true)
    for (const strength of [0, .1, 40, 0]) {
      await author.begin(target); chain.begin(author.commandEncoder())
      await chain.encode('light', source, W, H, resolveAuthorEffects([{ id: 'glow', params: { strength } }]), context, {}, undefined, { radius: 0, lens: false }, t => author.mipmaps(t, W, H))
      const result = await chain.encode('grade', source, W, H, grade, context, {}, undefined, { radius: 0, lens: false }, t => author.mipmaps(t, W, H))
      author.draw(target, W, H, { texture: result.picture, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
      author.finish(); chain.commit(); expect(await read(target)).toEqual(expected)
    }
  } finally { chain.dispose(); await author.dispose(); source.destroy(); target.destroy() }
})

describe('剪辑内置效果（真实设备）', () => {
  it('录制光标矢量轮廓、移动、按键颜色、隐藏和半透明原片的像素一致', async () => {
    const source = input(); const target = output()
    const draw: RecordingCursorDraw = { point: [0.25, 0.25], size: 0.5, shape: 0, rotation: 0, opacity: 1, style: 0, button: 0 }
    const render = async (cursorDraws: RecordingCursorDraw[]): Promise<Uint8Array> => {
      await effects.render({ id: 'recording_cursor', params: {}, cursorDraws }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
      return read(target)
    }
    try {
      const original = await read(source)
      expect(await render([])).toEqual(original)
      const first = await render([draw])
      expect(pixel(first, 18, 14)[0]).toBeGreaterThan(200)
      expect(pixel(first, 50, 30)).toEqual(pixel(original, 50, 30))
      const moved = await render([{ ...draw, point: [0.6, 0.25] }])
      expect(pixel(moved, 18, 14)).toEqual(pixel(original, 18, 14))
      expect(pixel(moved, 40, 14)[0]).toBeGreaterThan(200)
      expect(await render([{ ...draw, opacity: 0 }])).toEqual(original)
      const ring = { ...draw, point: [0.5, 0.5] as [number, number], shape: -1, size: 0.25 }
      const left = await render([ring]); const right = await render([{ ...ring, button: 1 }])
      expect(pixel(left, 40, 18)[2]).toBeGreaterThan(pixel(left, 40, 18)[0])
      expect(pixel(right, 40, 18)[0]).toBeGreaterThan(pixel(right, 40, 18)[2])
      // All captured shapes compile and produce output; hidden is excluded by the sampler.
      for (const shape of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) expect(await render([{ ...draw, point: [0.5, 0.5], shape }])).not.toEqual(original)
      // Premultiplied alpha is preserved: fading a clip cannot leave a bright floating cursor.
      device.queue.writeTexture({ texture: source as never }, new Uint8Array(W * H * 4), { bytesPerRow: W * 4 }, [W, H])
      expect((await render([ring, draw])).every(value => value === 0)).toBe(true)
      const faded = new Uint8Array(W * H * 4); for (let i = 0; i < faded.length; i += 4) faded.set([64, 64, 64, 128], i)
      device.queue.writeTexture({ texture: source as never }, faded, { bytesPerRow: W * 4 }, [W, H])
      const overlay = await render([ring, draw])
      expect(overlay.every((value, index) => index % 4 === 3 ? value === 128 : value <= 128)).toBe(true)
    } finally { source.destroy(); target.destroy() }
  })
  it('自动缩放双三次放大视野、片段外透明；录屏画框缩小居中、四周铺不透明背景', async () => {
    const source = input(); const target = output()
    try {
      // 整幅片段、2 倍、视野中心 (0.75, 0.5)：输出左边缘取样输入水平中点，灰阶仍是直线（双三次对线性渐变无误差）。
      const zoom = { sample: [0.5, 0, 0, 0.5, 0.5, 0.25] as [number, number, number, number, number, number], clip: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
      await effects.render({ id: 'recording_zoom', params: {}, zoom }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
      const zoomed = await read(target)
      const expected = (x: number): number => (0.5 + (x + 0.5) / W * 0.5) * W - 0.5
      for (const x of [4, 20, 40, 58]) expect(Math.abs(pixel(zoomed, x, 18)[1] - expected(x) / (W - 1) * 255)).toBeLessThan(2)
      expect(pixel(zoomed, 30, 18)[3]).toBe(255)
      // 片段只占左半幅：右半幅保持透明
      await effects.render({ id: 'recording_zoom', params: {}, zoom: { ...zoom, clip: [2, 0, 0, 1, 0, 0] } }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
      const half = await read(target)
      expect(pixel(half, 50, 18)[3]).toBe(0); expect(pixel(half, 10, 18)[3]).toBe(255)
      const background = [1, 3, 5].map(index => parseInt(RECORDING_FRAME_SOLID_DEFAULT_HEX.slice(index, index + 2), 16))
      await effects.render({ id: 'recording_frame', params: { background: 'solid', padding: 20, radius: 0, shadow: 0 } }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
      const framed = await read(target)
      expect(pixel(framed, 0, 0)).toEqual([...background, 255]); expect(pixel(framed, W / 2, 2)).toEqual([...background, 255])
      expect(Math.abs(pixel(framed, W / 2, H / 2)[1] - 128)).toBeLessThan(8)
      await effects.render({ id: 'recording_frame', params: {} }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
      expect((await read(target)).every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    } finally { source.destroy(); target.destroy() }
  })
  it('24个多工序模糊复用中间纹理，24份不同调色曲线跨帧不重复上传或编译', async () => {
    let allocations = 0; let compiles = 0; let scratchAllocations = 0
    const counted = new Proxy(device, { get: (target, key) => {
      if (key === 'createTexture') return (descriptor: Parameters<Device['createTexture']>[0]) => { allocations++; return target.createTexture(descriptor) }
      if (key === 'createRenderPipelineAsync') return (descriptor: Parameters<Device['createRenderPipelineAsync']>[0]) => { compiles++; return target.createRenderPipelineAsync(descriptor) }
      if (key === 'createRenderPipeline') return (descriptor: Parameters<Device['createRenderPipeline']>[0]) => { compiles++; return target.createRenderPipeline(descriptor) }
      const value = Reflect.get(target, key) as unknown
      return value instanceof Function ? value.bind(target) : value
    } })
    const local = new VideoEditBuiltinEffectsGpu(counted as unknown as GpuDevice, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), {
      allocate: (width, height, format) => { scratchAllocations++; return counted.createTexture({ size: [width, height], format: format as 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT }) as unknown as GpuTexture },
      release: texture => texture.destroy(),
    })
    const source = input(); const first = output(); const second = output()
    const blur = { id: 'blur', params: { amount: 79.67 } }
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
      // Gaussian's three linear targets, shared across all instances; a single-stage grade writes straight to its output.
      expect(scratchAllocations).toBe(oneEffect.scratchAllocations)
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
  it('关键结果：反相、水平翻转、零强度模糊不变、模糊在线性光混合、裁剪透明、抠掉纯绿', async () => {
    const original = await run('blur', { amount: 0.0 })
    expect(pixel(original, 0, 0)).toEqual([255, 0, 0, 255]); expect(pixel(original, 10, 5)).toEqual([Math.round(10 / 63 * 255), Math.round(10 / 63 * 255), Math.round(10 / 63 * 255), 255])
    expect(pixel(await run('invert'), 0, 0)).toEqual([0, 255, 255, 255])
    expect(pixel(await run('flip', { axis: 'horizontal' }), W - 1, 0)).toEqual([255, 0, 0, 255])
    const blurred = await run('blur', { amount: 79.67 })
    const row = (pixels: Uint8Array): number => Array.from({ length: W }, (_, x) => pixels[(18 * W + x) * 4 + 1]).reduce((sum, value) => sum + value, 0) / W
    expect(Math.abs(row(blurred) - row(original))).toBeLessThan(5)
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
  it('颗粒彩色时各通道各自起伏，单色时三通道一致', async () => {
    const mono = await run('film_grain', { amount: 80 }, 3); const color = await run('film_grain', { amount: 80, monochrome: false }, 3)
    const spread = (pixels: Uint8Array) => Array.from({ length: W * H }, (_, i) => Math.max(Math.abs(pixels[i * 4] - pixels[i * 4 + 1]), Math.abs(pixels[i * 4 + 1] - pixels[i * 4 + 2]))).slice(W)
    expect(Math.max(...spread(mono))).toBeLessThanOrEqual(1)
    expect(Math.max(...spread(color))).toBeGreaterThan(4)
  }, 30_000)
  it('暗角：黑色与旧公式一致、白色提亮四周；中心不动，抖动只在被暗角改动的像素上且不超过半级', async () => {
    const original = await run('blur', { amount: 0 })
    const black = await run('vignette', { amount: 60 }); const white = await run('vignette', { amount: 60, color: WHITE_HEX })
    const at = (x: number, y: number) => (y * W + x) * 4
    // 中心离暗角起点很远：逐像素不变。
    expect([...black.slice(at(32, 18), at(32, 18) + 4)]).toEqual([...original.slice(at(32, 18), at(32, 18) + 4)])
    // 角落：旧公式 rgb × (1 − 数量 × t)，t 在角落为 1；抖动最多半级，加上取整误差不超过 1。
    const corner = original[at(W - 1, H - 1)]
    expect(Math.abs(black[at(W - 1, H - 1)] - Math.round(corner * 0.4))).toBeLessThanOrEqual(1)
    expect(Math.abs(white[at(0, H - 1) + 1] - Math.round(original[at(0, H - 1) + 1] + (255 - original[at(0, H - 1) + 1]) * 0.6))).toBeLessThanOrEqual(1)
  }, 30_000)
  it('暗角抖动按叠到底色后的半级算：暗底平滑渐变上打散色带，半透明画面的抖动不随透明度变小', async () => {
    const width = 512, height = 64
    const flat = (alpha: number): GpuTexture => {
      const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC })
      const data = new Uint8Array(width * height * 4)
      for (let i = 0; i < width * height; i++) data.set([Math.round(24 * alpha), Math.round(24 * alpha), Math.round(24 * alpha), Math.round(255 * alpha)], i * 4)
      device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 }, [width, height])
      return texture as unknown as GpuTexture
    }
    const levels = async (alpha: number): Promise<number> => {
      const source = flat(alpha), target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture
      await effects.render({ id: 'vignette', params: { amount: 100, midpoint: 50, feather: 100 } }, { texture: source, width, height, format: 'rgba8unorm' }, target, 0)
      const pixels = await read(target, width, height)
      // 中间一行从中心到右边缘：没有抖动时同值像素连成长段（色带），抖动后相邻像素交错。
      const row = Array.from({ length: width / 2 }, (_, x) => pixels[((height / 2) * width + width / 2 + x) * 4])
      return row.slice(1).filter((value, x) => value !== row[x]).length
    }
    const opaque = await levels(1), half = await levels(0.5)
    // 24 级到 0 级的渐变只有 24 个台阶；抖动后变化点远多于台阶数，半透明画面同样多。
    expect(opaque).toBeGreaterThan(60); expect(half).toBeGreaterThan(40)
  }, 30_000)
  it('模糊四种方式守恒亮度：整幅不透明画面的平均亮度不变；不重复边缘时四边向透明淡出', async () => {
    const original = await run('blur', { amount: 0 })
    const mean = (pixels: Uint8Array, channel = 1) => Array.from({ length: W * H }, (_, i) => pixels[i * 4 + channel]).reduce((sum, value) => sum + value, 0) / (W * H)
    for (const params of [{ mode: 'uniform', amount: 120 }, { mode: 'directional', amount: 120, angle: 30 }, { mode: 'radial', amount: 120 }, { mode: 'lens', amount: 120, highlights: 0 }]) {
      const blurred = await run('blur', params)
      expect(Math.abs(mean(blurred) - mean(original)), params.mode).toBeLessThan(4)
      expect([...blurred], params.mode).not.toEqual([...original])
      // 放射只朝中心取样，边缘像素取不到画面外。
      if (params.mode === 'radial') continue
      const edge = await run('blur', { ...params, repeat_edges: false })
      expect(edge[(18 * W) * 4 + 3], params.mode).toBeLessThan(255)
      expect(edge[(18 * W + 32) * 4 + 3], params.mode).toBeGreaterThan(edge[(18 * W) * 4 + 3])
    }
  }, 60_000)
  it('锐化阈值：明暗差小于阈值的细碎起伏不加强，真正的边缘照样加强', async () => {
    const source = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC })
    const data = new Uint8Array(W * H * 4)
    // 左半是 ±3 级的棋盘细纹，右半是亮块，中间一条明显的边。
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const value = x < W / 2 ? 60 + ((x + y) % 2 ? 3 : -3) : 200; data.set([value, value, value, 255], (y * W + x) * 4) }
    device.queue.writeTexture({ texture: source }, data, { bytesPerRow: W * 4 }, [W, H])
    const sharpen = async (threshold: number): Promise<Uint8Array> => { const target = output(); await effects.render({ id: 'sharpen', params: { amount: 100, threshold } }, { texture: source as unknown as GpuTexture, width: W, height: H, format: 'rgba8unorm' }, target, 0); return read(target) }
    const change = (pixels: Uint8Array, x: number, y = 18) => Math.abs(pixels[(y * W + x) * 4] - data[(y * W + x) * 4])
    const all = await sharpen(0), kept = await sharpen(40)
    expect(change(all, 10)).toBeGreaterThan(1)
    expect(change(kept, 10)).toBeLessThanOrEqual(1)
    expect(change(kept, W / 2 - 1)).toBeGreaterThan(5); expect(change(kept, W / 2)).toBeGreaterThan(5)
    source.destroy()
  }, 30_000)
  it('发光：透明底的内容向外发光，强度 0 与原画相同；色差数量 0 不改画面', async () => {
    // 代码图层多是透明底：光要照到透明处，而且叠到黑底上要和同样内容放在不透明黑底上一样亮，否则透明底的文字外发光会偏暗。
    const square = (backdrop: number[]): { texture: GpuTexture; data: Uint8Array } => {
      const texture = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC }) as unknown as GpuTexture
      const data = new Uint8Array(W * H * 4)
      for (let at = 0; at < W * H; at++) data.set(backdrop, at * 4)
      for (let y = 14; y < 22; y++) for (let x = 28; x < 36; x++) data.set([255, 255, 255, 255], (y * W + x) * 4)
      device.queue.writeTexture({ texture: texture as never }, data, { bytesPerRow: W * 4 }, [W, H])
      return { texture, data }
    }
    const clear = square([0, 0, 0, 0]); const black = square([0, 0, 0, 255])
    const render = async (source: GpuTexture, id: string, params: Record<string, unknown>): Promise<Uint8Array> => {
      const target = output()
      await effects.render({ id, params: params as Record<string, number> }, { texture: source, width: W, height: H, format: 'rgba8unorm' }, target, 0)
      return read(target)
    }
    const glow = { threshold: 0, strength: 60, radius: 40 }
    const onClear = await render(clear.texture, 'glow', glow); const onBlack = await render(black.texture, 'glow', glow)
    expect(pixel(onClear, 31, 17)).toEqual([255, 255, 255, 255])
    const near = pixel(onClear, 38, 17)
    expect(near[3]).toBeGreaterThan(40)
    expect(Math.max(near[0], near[1], near[2])).toBeLessThanOrEqual(near[3])
    expect(pixel(onClear, 2, 2)[3]).toBeLessThan(near[3])
    // 预乘颜色就是叠到黑底上的结果，不能比不透明黑底上暗。透明底边缘的半覆盖像素按线性光算会略亮一点（黑底上是在编码值里混合的），所以只按比例留上方的余量。
    for (const [x, y] of [[38, 17], [44, 17], [31, 26], [10, 5]]) {
      const clearPixel = pixel(onClear, x, y); const blackPixel = pixel(onBlack, x, y)
      for (let channel = 0; channel < 3; channel++) { expect(clearPixel[channel]).toBeGreaterThanOrEqual(blackPixel[channel] - 1); expect(clearPixel[channel]).toBeLessThanOrEqual(blackPixel[channel] * 1.3 + 6) }
    }
    // 光照不到的原画一点不变（中灰最能看出编码有没有算错）。
    const gray = square([128, 128, 128, 255])
    const grayResult = await render(gray.texture, 'glow', { threshold: 95, strength: 40, radius: 0 })
    expect(pixel(grayResult, 2, 2)).toEqual([128, 128, 128, 255])
    expect(pixel(grayResult, 60, 33)).toEqual([128, 128, 128, 255])
    expect([...await render(clear.texture, 'glow', { strength: 0 })]).toEqual([...clear.data])
    expect([...await render(clear.texture, 'chromatic_aberration', { amount: 0 })]).toEqual([...clear.data])
  }, 30_000)
})

/** 经过正式作者合成与片段合成器，检查零 alpha 光在 picture 边界仍然相加。 */
describe('作者图层效果（真实设备）', () => {
  it('连续取消且调色曲线逐帧变化时，查找表纹理复用，恢复提交仍能正确绘制', async () => {
    let allocations = 0
    const counted = new Proxy(device, { get: (target, key) => {
      if (key === 'createTexture') return (descriptor: Parameters<Device['createTexture']>[0]) => { allocations++; return target.createTexture(descriptor) }
      const value = Reflect.get(target, key) as unknown
      return value instanceof Function ? value.bind(target) : value
    } })
    const d = counted as unknown as GpuDevice, author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator()), source = input(), target = output()
    const context = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'interactive' as const }
    try {
      let warm = 0
      for (let frame = 0; frame < 24; frame++) {
        await author.begin(target); chain.begin(author.commandEncoder())
        await chain.encode('title', source, W, H, resolveAuthorEffects([{ id: 'color_grade', params: { curve_master_2: 51 + frame } }]), context, {}, 'pixels', { radius: 0, lens: false }, texture => author.mipmaps(texture, W, H))
        author.abandon(); chain.abandon()
        if (!frame) warm = allocations
        else expect(allocations).toBe(warm)
      }
      await author.begin(target); chain.begin(author.commandEncoder())
      const result = await chain.encode('title', source, W, H, resolveAuthorEffects([{ id: 'color_grade', params: { curve_master_2: 80 } }]), context, {}, 'pixels', { radius: 0, lens: false }, texture => author.mipmaps(texture, W, H))
      author.draw(target, W, H, { texture: result.picture, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
      author.finish(); chain.commit()
      expect(pixel(await read(target), W / 2, H / 2)[0]).toBeGreaterThan(pixel(await read(source), W / 2, H / 2)[0])
    } finally { chain.dispose(); await author.dispose(); source.destroy(); target.destroy() }
  })
  it('旧 API 和未产光的 API 7 输出仍钳制 RGB≤alpha；带光画面经两层嵌套与运动模糊保留且逐帧复位', async () => {
    const d = device as unknown as GpuDevice
    const source = input(), target = output(), nested = output(), parent = output()
    const canvas = { width: W, height: H, getContext: () => ({ configure() {} }) } as unknown as OffscreenCanvas
    const compositor = new VideoEditGpuCompositor(canvas, { ready: Promise.resolve(), device: d, canvasFormat: 'rgba8unorm', assertDevice() {} } as unknown as VideoEditGpuCompositor)
    const clip: VideoEditClip = { id: 'a', itemId: 'a', name: 'a', kind: 'image', track: 1, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
    const document: VideoEditComposition = { ...createVideoEditSequence(), width: W, height: H, fps: 30, clips: [clip], media: [], items: [], revision: 0 }
    const picture = new VideoEditCodePicture(source, W, H, d), child = new VideoEditCodePicture(nested, W, H, d), outer = new VideoEditCodePicture(parent, W, H, d), destination = new VideoEditCodePicture(target, W, H, d)
    const raw = new Uint8Array(W * H * 4)
    for (let at = 0; at < raw.length; at += 4) raw.set([180, 120, 60, at < raw.length / 2 ? 64 : 0], at)
    const draw = async (input: VideoEditCodePicture, output: VideoEditCodePicture, placed = clip) => {
      await (await compositor.draw(document, [placed], [input], () => true, undefined, output)).completion
    }
    try {
      for (const apiVersion of [4, 5, 6, 7]) {
        const runtime = new VideoEditAuthorRuntime(d, { name: '加色输出', createWebGPU: () => ({ draw: texture => device.queue.writeTexture({ texture: texture as never }, raw, { bytesPerRow: W * 4 }, [W, H]) }) }, undefined, true, apiVersion)
        try {
          await runtime.render(source, W, H, {}, {}, { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 1 } })
          picture.carriesLight = runtime.carriesLight
          expect(picture.carriesLight).toBe(false)
          await draw(picture, destination)
          const pixels = await read(target)
          expect(pixel(pixels, 32, 8)).toEqual([64, 64, 60, 64])
          expect(pixel(pixels, 32, 28)).toEqual([0, 0, 0, 0])
        } finally { await runtime.dispose() }
      }
      picture.carriesLight = true
      await draw(picture, child); await draw(child, outer); await draw(outer, destination)
      expect(child.carriesLight).toBe(true); expect(outer.carriesLight).toBe(true)
      expect(await read(target)).toEqual(raw)
      const moving = { ...clip, motionSamples: [{ x: 0, y: 0, scale: 1, rotation: 0 }, { x: 0, y: 0, scale: 1, rotation: 0 }] }
      await draw(outer, destination, moving)
      expect(await read(target)).toEqual(raw)
      picture.carriesLight = false
      await draw(picture, child); await draw(child, outer)
      expect(child.carriesLight).toBe(false); expect(outer.carriesLight).toBe(false)
      await draw(outer, destination)
      expect(pixel(await read(target), 32, 28)).toEqual([0, 0, 0, 0])
    } finally { await compositor.dispose(); for (const texture of [source, target, nested, parent]) texture.destroy() }
  })
  it('内部背景与独立下方图片片段一致，光晕只提亮；源透明和层透明语义分开', async () => {
    const d = device as unknown as GpuDevice
    const author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator())
    const source = input(), background = input(), title = output(), internal = output(), external = output()
    const pixels = new Uint8Array(W * H * 4)
    for (let y = 14; y < 22; y++) for (let x = 28; x < 36; x++) pixels.set(x < 30 ? [255, 0, 0, 255] : x > 33 ? [0, 0, 255, 255] : [128, 128, 128, 128], (y * W + x) * 4)
    device.queue.writeTexture({ texture: source as never }, pixels, { bytesPerRow: W * 4 }, [W, H])
    const canvas = { width: W, height: H, getContext: () => ({ configure() {} }) } as unknown as OffscreenCanvas
    const shared = { ready: Promise.resolve(), device: d, canvasFormat: 'rgba8unorm', assertDevice() {} } as unknown as VideoEditGpuCompositor
    const compositor = new VideoEditGpuCompositor(canvas, shared)
    const clip = (id: string, track: number): VideoEditClip => ({ id, itemId: id, name: id, kind: 'image', track, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' })
    const clips = [clip('background', 1), clip('title', 2)]
    const document: VideoEditComposition = { ...createVideoEditSequence(), width: W, height: H, fps: 30, clips, media: [], items: [], revision: 0 }
    const reference = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'interactive' as const }
    let transformed = false
    const draw = (target: GpuTexture, texture: GpuTexture, opacity = 1): void => {
      const moving = transformed && texture !== background
      author.draw(target, W, H, { texture, x: 0, y: 0, width: W, height: H }, moving
        ? [{ offset: { numerator: -1, denominator: 4 }, weight: .25, pose: { matrix: [.8, .15, -.25, 1.1, 10, -5], opacity } }, { offset: { numerator: 1, denominator: 4 }, weight: .75, pose: { matrix: [.8, .15, -.25, 1.1, 12, -5], opacity } }]
        : [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity } }], moving ? [15, 5, 52, 29] : undefined)
    }
    const render = async (bg: number[], strength = 45, sourceOpacity = 100, layerOpacity = 1): Promise<{ inside: Uint8Array; outside: Uint8Array }> => {
      const data = new Uint8Array(W * H * 4); for (let at = 0; at < data.length; at += 4) data.set([...bg, 255], at)
      device.queue.writeTexture({ texture: background as never }, data, { bytesPerRow: W * 4 }, [W, H])
      await author.begin(title); chain.begin(author.commandEncoder())
      const result = await chain.encode('title', source, W, H, resolveAuthorEffects([{ id: 'glow', params: { strength, radius: 35, dither: 0, source_opacity: sourceOpacity, threshold: 10 } }]), reference, {}, 'fixed', { radius: 0, lens: false }, texture => author.mipmaps(texture, W, H))
      draw(title, result.picture, layerOpacity)
      author.finish(); chain.commit()
      await author.begin(internal); draw(internal, background)
      draw(internal, result.picture, layerOpacity)
      author.finish()
      const pictures = [background, title].map(texture => new VideoEditCodePicture(texture, W, H, d))
      pictures[1].carriesLight = result.carriesLight
      const composed = await compositor.draw(document, clips, pictures, () => true, undefined, new VideoEditCodePicture(external, W, H, d))
      await composed.completion
      return { inside: await read(internal), outside: await read(external) }
    }
    try {
      for (const bg of [[0, 0, 0], [30, 30, 30], [180, 180, 180], [20, 90, 130]]) {
        const lit = await render(bg)
        expect(Math.max(...lit.outside.map((value, index) => Math.abs(value - lit.inside[index])))).toBeLessThanOrEqual(1)
        const halo = pixel(lit.outside, 26, 18)
        expect(halo.slice(0, 3).every((channel, index) => channel >= bg[index])).toBe(true)
        expect(halo.slice(0, 3).some((channel, index) => channel > bg[index])).toBe(true)
        expect(pixel(lit.outside, 0, 0)).toEqual([...bg, 255])
        expect((await render(bg)).outside).toEqual(lit.outside)
        expect(pixel((await render(bg, 0)).outside, 26, 18)).toEqual([...bg, 255])
        expect(pixel((await render(bg, 45, 0)).outside, 26, 18)).toEqual(halo)
        const hidden = (await render(bg, 45, 100, 0)).outside
        expect(pixel(hidden, 32, 18)).toEqual([...bg, 255])
        expect(pixel(hidden, 26, 18)).toEqual([...bg, 255])
      }
      const bg = [20, 50, 80]
      const full = pixel((await render(bg)).outside, 26, 18), half = pixel((await render(bg, 45, 100, .5)).outside, 26, 18)
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(half[channel] - (bg[channel] + (full[channel] - bg[channel]) * .5))).toBeLessThanOrEqual(1)
      transformed = true
      const moved = await render(bg)
      expect(Math.max(...moved.outside.map((value, index) => Math.abs(value - moved.inside[index])))).toBeLessThanOrEqual(1)
      expect(pixel(moved.outside, 10, 18)).toEqual([...bg, 255])
      expect(pixel(moved.outside, 54, 18)).toEqual([...bg, 255])
      // 上层不透明区域覆盖已有光，覆盖区域外仍保留当前片段。
      await author.begin(internal); draw(internal, title)
      author.draw(internal, W, H, { texture: background, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }], [25, 12, 40, 25])
      author.finish()
      expect(pixel(await read(internal), 32, 18)).toEqual([...bg, 255])
    } finally { chain.dispose(); await author.dispose(); await compositor.dispose(); for (const texture of [source, background, title, internal, external]) texture.destroy() }
  })
  it('同一批次不同参数与顺序生效；缓存只在提交后发布，弃帧和删层不复用附件', async () => {
    const d = device as unknown as GpuDevice, chain = new VideoEditAuthorEffects(d, allocator()), author = new VideoEditAuthorGpu(d)
    const source = input(), target = output()
    const context = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'interactive' as const }
    const encode = (slot: string, amount: number) => chain.encode(slot, source, W, H, resolveAuthorEffects([{ id: 'black_white' }, { id: 'sharpen', params: { amount } }]), context, {}, 'constant', { radius: 0, lens: false }, texture => author.mipmaps(texture, W, H))
    try {
      await author.begin(target); chain.begin(author.commandEncoder())
      const first = await encode('a', 0), second = await encode('b', 100)
      expect(first.picture).not.toBe(second.picture)
      author.draw(target, W, H, { texture: second.picture, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
      author.finish(); chain.commit()
      const processed = await read(target); expect(pixel(processed, 0, 0)[0]).toBe(pixel(processed, 0, 0)[1])
      await author.begin(target); chain.begin(author.commandEncoder()); expect((await encode('a', 0)).picture).toBe(first.picture)
      const changed = await encode('b', 25); expect(changed.picture).toBe(second.picture)
      author.abandon(); chain.abandon()
      await author.begin(target); chain.begin(author.commandEncoder()); expect((await encode('b', 100)).picture).toBe(second.picture)
      author.finish(); chain.commit()
      await author.begin(target); chain.begin(author.commandEncoder()); await encode('a', 0)
      author.finish(); chain.commit()
    } finally { chain.dispose(); await author.dispose(); source.destroy(); target.destroy() }
  })
})

it('图层发光采样网格跨外扩档稳定，局部公开高斯与镜头虚化两档质量可执行', async () => {
  const d = device as unknown as GpuDevice, author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator()), target = output()
  const render = async (pad: number, descriptors: unknown[], quality: 'interactive' | 'final' = 'interactive', defocus = 0): Promise<Uint8Array> => {
    const width = 9 + pad * 2, height = 7 + pad * 2
    const source = device.createTexture({ size: [width, height], mipLevelCount: 1 + Math.floor(Math.log2(Math.max(width, height))), format: 'rgba8unorm', usage: 4 | 16 | 2 })
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) data.set([200, 110, 20, 210], ((y + pad) * width + x + pad) * 4)
    device.queue.writeTexture({ texture: source }, data, { bytesPerRow: width * 4 }, [width, height])
    try {
      await author.begin(target); chain.begin(author.commandEncoder()); author.mipmaps(source as unknown as GpuTexture, width, height)
      const result = await chain.encode('padded', source as unknown as GpuTexture, width, height, resolveAuthorEffects(descriptors), { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: 9, height: 7 }, rasterScale: 1, rasterOrigin: [pad, pad], quality }, {}, undefined, { radius: defocus, lens: false }, texture => author.mipmaps(texture, width, height))
      author.draw(target, W, H, { texture: result.picture, x: 0, y: 0, width, height }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 28 - pad, 14 - pad], opacity: 1 } }])
      author.finish(); chain.commit(); return await read(target)
    } finally { source.destroy() }
  }
  try {
    const descriptor = [{ id: 'glow', params: { strength: 20, radius: 25, resolution: 37, dither: 50 } }]
    const a = await render(32, descriptor), b = await render(64, descriptor)
    expect(Math.max(...a.map((value, index) => Math.abs(value - b[index])))).toBeLessThanOrEqual(1)
    const plain = await render(32, [])
    expect(await render(32, [], 'interactive', 3)).toEqual(await render(32, [], 'final', 3))
    for (const quality of ['interactive', 'final'] as const) {
      expect(await render(32, [{ id: 'blur', params: { amount: 79.67 } }], quality)).not.toEqual(plain)
      expect(await render(32, [], quality, 3)).not.toEqual(plain)
    }
    for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(value => value.space === 'layer')) expect((await render(32, [{ id: definition.id }])).length).toBe(W * H * 4)
  } finally { chain.dispose(); await author.dispose(); target.destroy() }
})

it('光核使用正式 shoulder/screen 公式，保留小幅线性光与强光压缩', async () => {
  const source = input(), base = input(), target = output()
  const fill = (texture: GpuTexture, value: number[]) => {
    const bytes = new Uint8Array(W * H * 4)
    for (let at = 0; at < bytes.length; at += 4) bytes.set(value, at)
    device.queue.writeTexture({ texture: texture as never }, bytes, { bytesPerRow: W * 4 }, [W, H])
  }
  const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  const encoded = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055
  const shoulder = (value: number) => value <= .75 ? value : .75 + .25 * (1 - Math.exp(-(value - .75) / .25))
  try {
    fill(source, [51, 51, 51, 255]); fill(base, [26, 51, 77, 128])
    for (const gain of [.1, 6]) for (const screen of [false, true]) {
      const encoder = device.createCommandEncoder()
      await effects.encodePlan({ width: W, height: H, scratch: [], passes: [{ entry: 'glow_layer_image', source: 'input', original: 'second', target: 'output', uniforms: new Float32Array([W, H, W, H, 0, .001, 1, 0, 0, 0, 0, Number(screen), gain, 0, 0, 0]) }] }, 'rgba8unorm', source, target, base, undefined, { encoder: encoder as never, uniformIndex: 0, taken: new Set() })
      device.queue.submit([encoder.finish()])
      const result = pixel(await read(target), 32, 18)
      for (const [channel, before] of [26, 51, 77].entries()) {
        const b = linear(before / 128), light = .2 * gain, room = 1 - b
        const lit = screen ? 1 - room * Math.exp(-light) : b + room * shoulder(light / room)
        expect(Math.abs(result[channel] - encoded(lit) * 128)).toBeLessThanOrEqual(1)
      }
      expect(result[3]).toBe(128)
    }
  } finally { source.destroy(); base.destroy(); target.destroy() }
})

it('主链顺序与 underlay 保留语义，最终虚化同时作用全部输出', async () => {
  const d = device as unknown as GpuDevice, author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator()), source = input(), target = output()
  const context = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
  const light = { id: 'glow', params: { strength: 30, dither: 0 } }, blur = { id: 'blur', params: { amount: 79.67 } }
  const render = async (descriptors: Array<{ id: string; params: Record<string, number> }>, defocus = 0) => {
    const capture = async (onlyLight: boolean): Promise<Uint8Array> => {
    await author.begin(target); chain.begin(author.commandEncoder())
    const result = await chain.encode('chain', source, W, H, resolveAuthorEffects(descriptors.map(effect => onlyLight && effect.id === 'glow' ? { ...effect, params: { ...effect.params, source_opacity: 0 } } : effect)), context, {}, undefined, { radius: defocus, lens: false }, texture => author.mipmaps(texture, W, H))
    author.draw(target, W, H, { texture: result.picture, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
    author.finish(); chain.commit(); return read(target)
    }
    return { image: await capture(false), light: await capture(true) }
  }
  try {
    const original = await render([light]), suffix = await render([light, blur]), prefix = await render([blur, light]), defocused = await render([light], 2)
    expect(suffix.light).toEqual(original.light); expect(suffix.image).not.toEqual(original.image)
    expect(prefix.light).not.toEqual(original.light)
    expect(defocused.light).not.toEqual(original.light); expect(defocused.image).not.toEqual(original.image)
  } finally { chain.dispose(); await author.dispose(); source.destroy(); target.destroy() }
})

it('发光层高斯 pose.blur 保持光能量，亚像素阈值两侧连续', async () => {
  const d = device as unknown as GpuDevice, author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator())
  const source = input(), target = output(), pixels = new Uint8Array(W * H * 4)
  for (let y = 15; y < 21; y++) for (let x = 28; x < 36; x++) pixels.set([255, 255, 255, 255], (y * W + x) * 4)
  device.queue.writeTexture({ texture: source as never }, pixels, { bytesPerRow: W * 4 }, [W, H])
  const context = { referenceSize: { width: W, height: H }, contentBounds: { x: 28, y: 15, width: 8, height: 6 }, rasterScale: 1, rasterOrigin: [28, 15] as const, quality: 'final' as const }
  const descriptors = resolveAuthorEffects([{ id: 'glow', params: { strength: 30, radius: 20, dither: 0, source_opacity: 0 } }])
  const render = async (blur: number): Promise<Uint8Array> => {
    await author.begin(target); chain.begin(author.commandEncoder())
    const { radius } = authorLayerBlur({ blur }, 1, undefined)
    const result = await chain.encode('light', source, W, H, descriptors, context, {}, undefined, { radius, lens: false }, texture => author.mipmaps(texture, W, H))
    author.draw(target, W, H, { texture: result.picture, x: 0, y: 0, width: W, height: H }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
    author.finish(); chain.commit(); return read(target)
  }
  const energy = (values: Uint8Array): number => values.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0)
  try {
    const original = await render(0), below = await render(.249), above = await render(.251), blurred = await render(2)
    const baseline = energy(original)
    expect(baseline).toBeGreaterThan(0)
    for (const result of [below, above, blurred]) {
      expect(Math.abs(energy(result) / baseline - 1)).toBeLessThan(.05)
      expect(result.filter((_, index) => index % 4 === 3).every(alpha => alpha === 0)).toBe(true)
    }
    const jump = above.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : Math.abs(value - below[index])), 0)
    expect(jump / baseline).toBeLessThan(.01)
    expect(blurred).not.toEqual(original)
  } finally { chain.dispose(); await author.dispose(); source.destroy(); target.destroy() }
})
