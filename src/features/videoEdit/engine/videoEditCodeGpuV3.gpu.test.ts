import { rasterFixture, rasterColor as color } from './videoEditCodeRaster.testing'
import { CODE_BLEND_NAMES, type CodeColor } from '@/core/videoEdit/codeMaterial/contract'
import { codeCompositePixel, codeMaskCoverage } from '@/core/videoEdit/codeMaterial/compositing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { initShaderGraphTestGpu } from './shaderEngines/shaderGraphGpu.testing'
import type { Gpu } from 'vgpu/node'
import sharp from 'sharp'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { layoutCodeText } from '@/core/videoEdit/codeMaterial/textLayout'

import type { CodeDrawCommand, CodeTextMeasurer } from '@/core/videoEdit/codeMaterial/contract'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpuV3 } from './videoEditCodeGpuV3'

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fontFaces from '@/platform/fontFaces'

import { ContactSheetBitmap, ContactSheetCanvas } from '@/tests/videoEditContactSheetCanvas'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { codeMultiply, codeTextBaseBounds, codeTransform } from '@/core/videoEdit/codeMaterial/geometry'
import { createCanvasOracle } from './videoEditCodeCanvas.testing'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import { CodeMotionSamplingBudget, sampleCodeMotion } from '@/core/videoEdit/codeMaterial/motionSampling'


import { codeMaterialMotionClock } from '@/core/videoEdit/codeMaterialTiming'
import { codeLensPlan } from './videoEditCodeLens'

let gpu: Gpu; let device: Gpu['gpu']; let wrapped: GpuDevice; let runtime: VideoEditCodeGpuV3
let queueSubmissions = 0
let canvasOracle: Awaited<ReturnType<typeof createCanvasOracle>> | undefined
const W = 64; const H = 64
const source = (body: string, kind = 'generator', shaders = ''): string => `export default {apiVersion:1,languageVersion:3,name:"GPU v3",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{},${shaders ? `shaders:${shaders},` : ''}render(ctx){${body}}}`
const context = { time: .4, localTime: .4, sequenceTime: .4, width: W, height: H, frame: 24, fps: 60 }
const testMeasure: CodeTextMeasurer = request => layoutCodeText(request, (text, font) => Array.from(text).length * Number(font.match(/([\d.]+)px/)![1]) * .6)
beforeAll(async () => {
  gpu = await initShaderGraphTestGpu(); device = gpu.gpu
  const queue = new Proxy(device.queue, { get(target, key) {
    if (key === 'submit') return (commands: Parameters<typeof device.queue.submit>[0]) => { queueSubmissions++; target.submit(commands) }
    if (key === 'copyExternalImageToTexture') return (from: { source: { pixels: Uint8Array; width: number; height: number } }, to: { texture: Parameters<typeof device.queue.writeTexture>[0]['texture'] }) => target.writeTexture(to, from.source.pixels, { bytesPerRow: from.source.width * 4 }, [from.source.width, from.source.height])
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } })
  wrapped = new Proxy(device, { get(target, key) {
    if (key === 'queue') return queue
    if (key === 'createTexture') return (descriptor: Parameters<typeof device.createTexture>[0]) => target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 })
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } }) as unknown as GpuDevice
  runtime = new VideoEditCodeGpuV3(wrapped, { allocate: (width, height) => texture(width, height), release: texture => texture.destroy() }, rasterFixture)
  if (process.env.HENJI_T108_CANVAS === '1') canvasOracle = await createCanvasOracle()
})
afterAll(async () => { await canvasOracle?.dispose(); await runtime?.dispose(); gpu?.dispose() })
function texture(width = W, height = H): GpuTexture { return device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 }) as unknown as GpuTexture }
async function read(texture: GpuTexture, width = W, height = H): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256; const buffer = device.createBuffer({ size: bytesPerRow * height, usage: 0x01 | 0x08 }); const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, { width, height, depthOrArrayLayers: 1 }); device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
  buffer.unmap(); buffer.destroy(); return pixels
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.slice((y * W + x) * 4, (y * W + x) * 4 + 4)]

const motionSample = (x: number, y: number, weight: number, opacity = 1): CodeMotionSample => ({ offset: { numerator: 0, denominator: 1 }, pose: { matrix: [1, 0, 0, 1, x, y], opacity }, weight })
const motionGroup = (samples: CodeMotionSample[]): Extract<CodeDrawCommand, { kind: 'group' }> => ({ kind: 'group', x: 0, y: 0, motionSamples: samples, children: [{ kind: 'rect', x: 0, y: 0, width: 8, height: 8, radius: 0, fill: [1, 0, 0, 128 / 255] }] })



it('作者运动蒙版在中心透明、快门内显现时仍输出曝光像素', async () => {
  const program = compileCodeMaterial(source('return [group({mask:{shape:group({opacity:max(0,min(1,(ctx.time-1)*240)),motionBlur:{}},[rect({x:0,y:0,width:8,height:8,fill:[1,1,1,1]})])}},[rect({x:0,y:0,width:8,height:8,fill:[1,0,0,1]})])];').replace('apiVersion:1', 'apiVersion:2').replace('width:3840,height:2160', 'width:64,height:64'))
  const at = { ...context, time: 1, localTime: 1, sequenceTime: 1, frame: 60 }
  const motion = codeMaterialMotionClock({ start: 0, duration: 480, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }, 60, { numerator: 60, denominator: 1 }, program, () => ({}), at)
  const commands = evaluateCodeMaterial(program, at, {}, { motion, cullInvisible: true })
  const output = texture()
  device.pushErrorScope('validation')
  try {
    await runtime.render(output, W, H, commands)
    const rgba = pixel(await read(output), 4, 4)
    expect(rgba[0]).toBeGreaterThanOrEqual(62)
    expect(rgba[0]).toBeLessThanOrEqual(66)
    expect(rgba).toEqual([rgba[0], 0, 0, rgba[0]])
  } finally { output.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('层级镜头散焦保留圆盘轮廓和预乘透明边缘，切换普通柔化不复用错误缓存', async () => {
  const output = texture()
  const commands = (shape: string, radius = 8) => evaluateCodeMaterial(compileCodeMaterial(source(`return [group({blurShape:"${shape}",blur:${radius}},[rect({x:24,y:24,width:16,height:16,fill:[1,0,0,1]})])];`).replace('apiVersion:1', 'apiVersion:3')), context)
  // Independent dense-area integration of a circular aperture and bilinear
  // reconstruction of the source rectangle; no golden-angle sampler reuse.
  const diskOracle = (x: number, y: number): number => {
    let sum = 0, count = 0
    const coverage = (v: number) => Math.min(1, Math.max(0, v - 23.5)) * Math.min(1, Math.max(0, 40.5 - v))
    for (let dy = -8; dy <= 8; dy += .125) for (let dx = -8; dx <= 8; dx += .125) if (dx * dx + dy * dy <= 64) { sum += coverage(x + .5 + dx) * coverage(y + .5 + dy); count++ }
    return sum / count * 255
  }
  device.pushErrorScope('validation')
  try {
    await runtime.render(output, W, H, commands('lens'))
    const lens = await read(output)
    for (const [x, y] of [[16, 32], [20, 32], [24, 32], [28, 32], [32, 32], [24, 24], [18, 18]]) expect(Math.abs(pixel(lens, x, y)[0] - diskOracle(x, y))).toBeLessThanOrEqual(18)
    let energy = 0
    for (let i = 0; i < lens.length; i += 4) { expect([...lens.slice(i, i + 4)]).toEqual([lens[i], 0, 0, lens[i]]); energy += lens[i] }
    expect(Math.abs(energy / (16 * 16 * 255) - 1)).toBeLessThan(.02)
    await runtime.render(output, W, H, commands('lens'))
    await runtime.render(output, W, H, commands('gaussian'))
    const gaussian = await read(output)
    expect(pixel(lens, 32, 32)[0]).toBeGreaterThan(pixel(gaussian, 32, 32)[0] + 40)
    await runtime.render(output, W, H, commands('lens'))
    expect(await read(output)).toEqual(lens)
    await runtime.render(output, W, H, commands('lens', 0))
    expect(pixel(await read(output), 24, 24)).toEqual([255, 0, 0, 255])
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') await sharp(Buffer.from(lens), { raw: { width: W, height: H, channels: 4 } }).png().toFile('.tmp/lens-disk.png')
  } finally { output.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('镜头散焦焦点与尺寸连续切换使用有界层资源，释放后不遗留纹理', async () => {
  const textures = new Set<GpuTexture>()
  const renderer = new VideoEditCodeGpuV3(wrapped, { allocate: (width, height) => { const image = texture(width, height); textures.add(image); return image }, release: image => { expect(textures.delete(image)).toBe(true); image.destroy() } }, rasterFixture)
  device.pushErrorScope('validation')
  try {
    for (const size of [64, 96, 65, 128, 64]) {
      const output = texture(size, size)
      try {
        for (const radius of [0, 8, 24, 64, 8]) {
          await renderer.render(output, size, size, [{ kind: 'group', x: 0, y: 0, blur: radius, blurShape: 'lens', children: [{ kind: 'rect', x: 16, y: 16, width: size / 2, height: size / 2, radius: 0, fill: [1, 0, 0, .5] }] }])
          expect(renderer.diagnostics().layers).toBeLessThanOrEqual(10)
          const result = await read(output, size, size)
          expect(result.some(value => value > 0)).toBe(true)
        }
      } finally { output.destroy() }
    }
    const plan = codeLensPlan(3840, 2160, 128)
    expect(plan.pixelSamples).toBeLessThan(3840 * 2160 * 4)
    expect(() => codeLensPlan(3840, 2160, 128, plan.pixelSamples - 1)).toThrow('预算')
  } finally { await renderer.dispose() }
  expect(textures.size).toBe(0)
  expect(await device.popErrorScope()).toBeNull()
})

it('运动曝光由正式有界采样器驱动，形成可预测拖影并支持乱序重放', async () => {
  const output = texture()
  const samples = (center: number) => sampleCodeMotion({ bounds: { x: 0, y: 0, width: 8, height: 8 }, shutter: { start: { numerator: -1, denominator: 4 }, end: { numerator: 1, denominator: 4 } }, available: { start: { numerator: -10, denominator: 1 }, end: { numerator: 10, denominator: 1 } }, maxSamples: 64, budget: new CodeMotionSamplingBudget(), poseAt: offset => ({ matrix: [1, 0, 0, 1, center + offset.numerator / offset.denominator * 32, 16], opacity: 1 }) })
  device.pushErrorScope('validation')
  try {
    const exposure = samples(16)
    expect(exposure).toHaveLength(16)
    await runtime.render(output, W, H, [motionGroup(exposure)])
    const first = await read(output)
    expect(pixel(first, 10, 20)).toEqual([20, 0, 0, 20])
    expect(pixel(first, 16, 20)).toEqual([64, 0, 0, 64])
    expect(pixel(first, 28, 20)).toEqual([28, 0, 0, 28])
    expect(pixel(first, 33, 20)).toEqual([0, 0, 0, 0])
    await runtime.render(output, W, H, [motionGroup(samples(32))])
    await runtime.render(output, W, H, [motionGroup(samples(16))])
    expect(await read(output)).toEqual(first)
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') await sharp(Buffer.from(first), { raw: { width: W, height: H, channels: 4 } }).png().toFile('.tmp/motion-gpu-exposure.png')
  } finally { output.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('运动曝光平均预乘透明色，重叠不会重复source-over；64样本不逐次量化', async () => {
  const output = texture()
  device.pushErrorScope('validation')
  try {
    await runtime.render(output, W, H, [motionGroup([motionSample(8, 16, .5), motionSample(12, 16, .5)])])
    const result = await read(output)
    expect(pixel(result, 10, 20)).toEqual([64, 0, 0, 64])
    expect(pixel(result, 14, 20)).toEqual([128, 0, 0, 128])
    expect(pixel(result, 18, 20)).toEqual([64, 0, 0, 64])
    expect(pixel(result, 21, 20)).toEqual([0, 0, 0, 0])
    const many = Array.from({ length: 64 }, () => motionSample(8, 16, 1 / 64))
    await runtime.render(output, W, H, [motionGroup(many)])
    expect(pixel(await read(output), 10, 20)).toEqual([128, 0, 0, 128])
    const transparent: CodeMotionSample = { offset: { numerator: 0, denominator: 1 }, pose: null, weight: .5 }
    await runtime.render(output, W, H, [motionGroup([motionSample(8, 16, .5), transparent])])
    expect(pixel(await read(output), 10, 20)).toEqual([64, 0, 0, 64])
  } finally { output.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('运动曝光在分组缓存命中后仍更新位姿，正确叠背景与混合模式', async () => {
  const output = texture()
  const background: CodeDrawCommand = { kind: 'rect', x: 0, y: 0, width: W, height: H, radius: 0, fill: [.2, .4, .6, 1] }
  device.pushErrorScope('validation')
  try {
    for (const x of [8, 12, 16, 20]) {
      const moving = motionGroup([motionSample(x, 16, 1)])
      moving.elementPath = ['motion-cache']; moving.blend = 'multiply'
      await runtime.render(output, W, H, [background, moving])
      const result = await read(output)
      const expected = codeCompositePixel([.2, .4, .6, 1], [128 / 255, 0, 0, 128 / 255], 'multiply')
      pixel(result, x + 2, 20).forEach((channel, index) => expect(channel).toBeCloseTo(Math.round(expected[index] * 255), 0))
      expect(pixel(result, 2, 20)).toEqual([51, 102, 153, 255])
    }
    expect(runtime.reuse.subtreeHits).toBeGreaterThan(0)
    // The frame signature contains exposure placements; returning out of order
    // must reconstruct the earlier pixels rather than reuse the latest frame.
    const earlier = motionGroup([motionSample(8, 16, 1)]); earlier.blend = 'multiply'
    await runtime.render(output, W, H, [background, earlier])
    expect(pixel(await read(output), 22, 20)).toEqual([51, 102, 153, 255])
  } finally { output.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('运动曝光不会按中心零透明度剔除，嵌套分组包含拖影范围并遵守局部裁剪', async () => {
  const output = texture()
  device.pushErrorScope('validation')
  try {
    const inner = motionGroup([motionSample(28, 16, 1)])
    inner.opacity = 0
    const outer: CodeDrawCommand = { kind: 'group', x: 4, y: 0, clip: { x: 20, y: 0, width: 12, height: H }, children: [inner] }
    await runtime.render(output, W, H, [outer])
    const result = await read(output)
    expect(pixel(result, 33, 20)).toEqual([128, 0, 0, 128])
    expect(pixel(result, 37, 20)).toEqual([0, 0, 0, 0])
  } finally { output.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('运动曝光单个位姿与普通分组合成逐像素一致，旋转与镜像不裁掉运动范围', async () => {
  const output = texture(), expected = texture()
  device.pushErrorScope('validation')
  try {
    const moving = motionGroup([motionSample(8, 16, 1)])
    const normal = { ...moving, x: 8, y: 16, motionSamples: undefined }
    await runtime.render(output, W, H, [moving])
    await runtime.render(expected, W, H, [normal])
    expect(await read(output)).toEqual(await read(expected))
    for (const matrix of [[0, 1, -1, 0, 20, 16], [-1, 0, 0, 1, 20, 16]] as const) {
      const rotated = motionGroup([{ ...motionSample(0, 0, 1), pose: { matrix: [...matrix], opacity: 1 } }])
      await runtime.render(output, W, H, [rotated])
      const result = await read(output)
      expect(pixel(result, 14, 20)).toEqual([128, 0, 0, 128])
      expect(pixel(result, 21, 20)).toEqual([0, 0, 0, 0])
    }
  } finally { output.destroy(); expected.destroy() }
  expect(await device.popErrorScope()).toBeNull()
})

it('运动曝光沿同一内容纹理采样局部遮罩与裁剪，资源随尺寸变化和释放收回', async () => {
  const output = texture(), smaller = texture(48, H)
  const owned = new Set<GpuTexture>()
  const host = new VideoEditCodeGpuV3(wrapped, { allocate: (w, h) => { const image = texture(w, h); owned.add(image); return image }, release: image => { owned.delete(image); image.destroy() } }, rasterFixture)
  device.pushErrorScope('validation')
  try {
    const moving = motionGroup([motionSample(8, 16, 1)])
    moving.mask = { shape: { kind: 'rect', x: 0, y: 0, width: 4, height: 8, radius: 0, fill: [1, 1, 1, 1] }, mode: 'alpha', invert: false }
    for (const width of [64, 48, 64]) {
      const target = width === 64 ? output : smaller
      await host.render(target, width, H, [moving])
      const result = await read(target, width, H)
      expect([...result.slice((20 * width + 10) * 4, (20 * width + 10) * 4 + 4)]).toEqual([128, 0, 0, 128])
      expect([...result.slice((20 * width + 14) * 4, (20 * width + 14) * 4 + 4)]).toEqual([0, 0, 0, 0])
    }
    expect(owned.size).toBeGreaterThan(0)
    await host.render(output, W, H, [])
    expect(pixel(await read(output), 10, 20)).toEqual([0, 0, 0, 0])
  } finally { output.destroy(); smaller.destroy(); await host.dispose() }
  expect(owned.size).toBe(0)
  expect(await device.popErrorScope()).toBeNull()
})

// Independent oracle: expand perChar into the original individual text draws.
// This bypasses text batching/source reuse, retaining the same raster and filters.
function individualCharacters(commands: readonly CodeDrawCommand[]): CodeDrawCommand[] {
  return commands.flatMap((command): CodeDrawCommand[] => {
    if (command.kind === 'group') return [{ ...command, children: individualCharacters(command.children) }]
    if (command.kind !== 'text' || !command.perChar || !command.layout) return [command]
    const layout = command.layout; const box = codeTextBaseBounds(command)
    return layout.glyphs.flatMap((glyph, i): CodeDrawCommand[] => {
      const style = command.perChar![i]
      if (!style.opacity) return []
      const row = Math.round(glyph.y / (layout.fontSize * (command.lineHeight ?? 1.2)))
      const width = layout.lineWidths?.[row] ?? layout.width
      return [{ ...command,
        x: box.x + glyph.x + (command.align === 'center' ? (box.width - width) / 2 : command.align === 'right' ? box.width - width : 0), y: box.y + glyph.y,
        text: glyph.text, align: 'left', baseline: 'top', perChar: undefined,
        layout: { ...layout, width: glyph.width, height: layout.fontSize * (command.lineHeight ?? 1.2), lines: [glyph.text], lineWidths: [glyph.width], glyphs: [{ ...glyph, x: 0, y: 0 }] },
        opacity: (command.opacity ?? 1) * style.opacity, rotation: style.rotation, skewX: style.skewX, skewY: 0,
        paint: style.fill ?? command.paint, blur: style.blur ?? command.blur, glow: style.glow ?? command.glow,
        scaleX: style.scale, scaleY: style.scale, anchorX: 0, anchorY: 0,
        elementTransform: codeMultiply(codeTransform(command), [1, 0, 0, 1, style.x, style.y]), elementPath: [...(command.elementPath ?? []), `char:${i}`],
      }]
    })
  })
}

it.each([
  ['blur', 'blur:(i+ctx.time)*1.4', ''],
  ['glow', 'glow:{radius:2+i+ctx.time,intensity:.8,color:[.2,.6,1,.7]}', ''],
  ['mixed', 'x:i*.3,y:sin(i+ctx.time)*5,scale:.8+i*.05,rotation:i*2,skewX:i*3,opacity:.3+i*.1,fill:rgba(i/6,.7,1-i/6,.8),blur:i+ctx.time,glow:{radius:3+i,intensity:.7,color:[1,.2,.4,.6]}', ',stroke:[.1,.8,.5,.7],strokeWidth:1.2,shadow:{x:2,y:-1,blur:2,color:[.1,.2,.3,.5]},blend:"screen"'],
  ['gradient', 'y:i*2,blur:i+ctx.time', ',fill:linearGradient({x1:50,y1:0,x2:320,y2:150,stops:[[0,[1,.2,.3,.7]],[1,[.2,.8,1,.8]]]})'],
])('t111 逐字%s对照原单字路径，通道容差1/255，变化不超过0.1%%', async (name, style, extra) => {
  const width = 512; const height = 256
  const text = JSON.stringify(name === 'mixed' ? 'Ae\u0301你\nD中F' : 'ABCDEF')
  const program = compileCodeMaterial(source(`return [group({x:3.25,y:5,scaleX:1.2,scaleY:.9,rotation:2,opacity:.8,clip:{x:0,y:0,width:450,height:240}},[text({x:210,y:90,text:${text},fontStyle:"italic",fontSize:32,align:"center",baseline:"middle",letterSpacing:2+ctx.time,perChar:(i,n)=>({${style}})${extra}})])];`))
  const raster = canvasOracle?.raster ?? rasterFixture
  const batch = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy() }, raster)
  const reference = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy() }, raster)
  const actual = texture(width, height); const expected = texture(width, height)
  device.pushErrorScope('validation')
  try {
    for (const time of [0, .1, .6, .1]) {
      const commands = evaluateCodeMaterial(program, { ...context, width, height, time }, {}, { measureText: testMeasure })
      const before = batch.counts.submissions; const refBefore = reference.counts.submissions
      await batch.render(actual, width, height, commands)
      await reference.render(expected, width, height, individualCharacters(commands))
      const a = await read(actual, width, height); const b = await read(expected, width, height)
      expect(a.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
      let max = 0; let changed = 0
      for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); max = Math.max(max, delta); if (delta) changed++ }
      expect(max, `${name} time=${time}`).toBeLessThanOrEqual(1)
      expect(changed / a.length, `${name} time=${time}`).toBeLessThanOrEqual(.001)
      if (time === 0) expect(batch.counts.submissions - before).toBeLessThan(reference.counts.submissions - refBefore)
    }
  } finally { actual.destroy(); expected.destroy(); await batch.dispose(); await reference.dispose() }
  expect(await device.popErrorScope()).toBeNull()
})

it('t111 字形缓存不随字距/半径重画，字体/分辨率失效，失败重试及绘制预算保持', async () => {
  const raster = vi.fn(rasterFixture)
  let resident = 0
  const sizes = new Map<GpuTexture, number>()
  const batch = new VideoEditCodeGpuV3(wrapped, {
    allocate: (w, h) => { const t = texture(w, h); sizes.set(t, w * h * 4); resident += w * h * 4; return t },
    release: t => { resident -= sizes.get(t)!; sizes.delete(t); t.destroy() },
  }, raster)
  const output = texture(256, 128)
  const program = compileCodeMaterial(source('return [text({x:20,y:50,text:"AAA",fontSize:24,letterSpacing:ctx.time,perChar:(i,n)=>({blur:3+ctx.time,glow:{radius:8,intensity:1,color:[1,0,0,1]}})})];'))
  const commands = (time: number) => evaluateCodeMaterial(program, { ...context, width: 256, height: 128, time }, {}, { measureText: testMeasure })
  try {
    await batch.render(output, 256, 128, commands(0)); const initial = raster.mock.calls.length
    await batch.render(output, 256, 128, commands(.1)); const warm = raster.mock.calls.length
    await batch.render(output, 256, 128, commands(.2))
    expect(raster.mock.calls.length).toBe(warm); expect(warm).toBeLessThanOrEqual(initial + 1)
    const scaled = commands(.3); scaled[0].scaleX = 2
    await batch.render(output, 256, 128, scaled); expect(raster.mock.calls.length).toBeGreaterThan(warm)
    const revision = vi.spyOn(fontFaces, 'documentFontRevision').mockReturnValue(56789)
    try {
      const calls = raster.mock.calls.length
      raster.mockRejectedValueOnce(new Error('fixture upload failure'))
      await expect(batch.render(output, 256, 128, commands(.4))).rejects.toThrow('fixture upload failure')
      await batch.render(output, 256, 128, commands(.4)); expect(raster.mock.calls.length).toBeGreaterThan(calls)
    } finally { revision.mockRestore() }
    const outside: CodeDrawCommand = { kind: 'rect', x: 500, y: 500, width: 1, height: 1, radius: 0, fill: [1, 1, 1, 1] }
    await expect(batch.render(output, 256, 128, [...Array.from({ length: 4095 }, () => outside), ...commands(.5)])).rejects.toMatchObject({ code: 'BUDGET' })
    await batch.render(output, 256, 128, commands(.5))
    expect(batch.reuse.frameHits).toBe(0)
  } finally { output.destroy(); await batch.dispose() }
  expect(resident).toBe(0)
})

it('t111 可选字形缓存无余量时回到原栅格尺寸，匿名文字互不覆盖', async () => {
  const output = texture(256, 128); const expected = texture(256, 128)
  const limited = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy(), canRetain: () => false }, rasterFixture)
  const reference = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy() }, rasterFixture)
  const program = compileCodeMaterial(source('return [text({x:20,y:50,text:"AB",fontSize:24,perChar:(i,n)=>({blur:2+ctx.time})}),text({x:60,y:60,text:"CD",fontSize:24,color:[1,0,0,1],perChar:(i,n)=>({blur:3+ctx.time})})];'))
  device.pushErrorScope('validation')
  try {
    for (const time of [0, .5, 0]) {
      const commands = evaluateCodeMaterial(program, { ...context, width: 256, height: 128, time }, {}, { measureText: testMeasure })
      for (const command of commands) { delete command.elementPath; delete command.elementId }
      await limited.render(output, 256, 128, commands)
      await reference.render(expected, 256, 128, individualCharacters(commands))
      expect(await read(output, 256, 128)).toEqual(await read(expected, 256, 128))
    }
  } finally { output.destroy(); expected.destroy(); await limited.dispose(); await reference.dispose() }
  expect(await device.popErrorScope()).toBeNull()
})

it('t109 整帧复用、微小变化、外部写入、尺寸与目标隔离', async () => {
  const output = texture(); const other = texture()
  const commands = evaluateCodeMaterial(compileCodeMaterial(source('return [rect({x:4,y:4,width:20,height:20,fill:[1,0,0,1]})];')), context)
  try {
    await runtime.render(output, W, H, commands)
    const pixels = await read(output); const submissions = runtime.counts.submissions
    await runtime.render(output, W, H, structuredClone(commands))
    expect(runtime.reuse.frameHits).toBe(1); expect(runtime.counts.submissions).toBe(submissions)
    expect(await read(output)).toEqual(pixels)
    await runtime.render(other, W, H, commands); expect(runtime.reuse.frameHits).toBe(0)
    const changed = structuredClone(commands); (changed[0] as Extract<CodeDrawCommand, { kind: 'rect' }>).x += 1e-12
    await runtime.render(output, W, H, changed); expect(runtime.reuse.frameHits).toBe(0)
    runtime.invalidate(output)
    await runtime.render(output, W, H, changed); expect(runtime.reuse.frameHits).toBe(0)
    const revision = vi.spyOn(fontFaces, 'documentFontRevision').mockReturnValue(9876)
    try { await runtime.render(output, W, H, changed); expect(runtime.reuse.frameHits).toBe(0) }
    finally { revision.mockRestore() }
  } finally { output.destroy(); other.destroy() }
})



it('性能归因不拆散矢量批次，开启与关闭采样像素完全一致', async () => {
  const program = compileCodeMaterial(source('return repeat(180,i=>rect({x:i%8*7,y:floor(i/8)%8*7,width:6,height:6,fill:[.2,.6,1,.3]}));'))
  const commands = evaluateCodeMaterial(program, context)
  const a = texture(); const b = texture()
  const plain = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: value => value.destroy() }, rasterFixture)
  const measured = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: value => value.destroy() }, rasterFixture)
  try {
    await plain.render(a, W, H, commands)
    await measured.render(b, W, H, commands, undefined, true)
    expect(measured.counts.submissions).toBe(plain.counts.submissions)
    expect(measured.counts.passes).toBe(plain.counts.passes)
    expect(measured.drawCosts.length).toBeGreaterThan(0)
    expect(await read(a)).toEqual(await read(b))
  } finally { a.destroy(); b.destroy(); await plain.dispose(); await measured.dispose() }
})

it('t109 静态子树只合成、内容变化失效，复用像素容差 0，预算不足不留缓存', async () => {
  const output = texture()
  const program = compileCodeMaterial(source('return [group({id:"stable",opacity:0.7,clip:{x:2,y:2,width:34,height:34},blur:2},[rect({x:4,y:4,width:20,height:20,fill:[1,0,0,1]})]),rect({x:45+ctx.time,y:4,width:4,height:4,fill:[0,1,0,1]})];'))
  const local = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: value => value.destroy() }, rasterFixture)
  const commands = (time: number) => evaluateCodeMaterial(program, { ...context, time })
  try {
    await local.render(output, W, H, commands(0))
    await local.render(output, W, H, commands(1)); const before = await read(output)
    await local.render(output, W, H, commands(2))
    expect(local.reuse).toMatchObject({ frameHits: 0, subtreeHits: 1 })
    const after = await read(output)
    for (let y = 0; y < H; y++) expect(after.slice(y * W * 4, (y * W + 40) * 4)).toEqual(before.slice(y * W * 4, (y * W + 40) * 4))
    const changed = commands(3); const group = changed[0] as Extract<CodeDrawCommand, { kind: 'group' }>
    ;(group.children[0] as Extract<CodeDrawCommand, { kind: 'rect' }>).width += 1e-12
    await local.render(output, W, H, changed); expect(local.reuse.subtreeHits).toBe(0)
    expect(local.diagnostics().cachedBytes).toBeLessThanOrEqual(48 * 1024 ** 2)
    const cachedBytes = local.diagnostics().cachedBytes
    local.evictUnused(1); expect(local.diagnostics().cachedBytes).toBeLessThan(cachedBytes)
  } finally { output.destroy(); await local.dispose() }
  let resident = 0
  const limited = new VideoEditCodeGpuV3(wrapped, { allocate: (w, h) => { resident++; return texture(w, h) }, release: value => { resident--; value.destroy() }, canRetain: () => false }, rasterFixture)
  const target = texture()
  try {
    for (let time = 0; time < 4; time++) await limited.render(target, W, H, commands(time))
    expect(limited.reuse.subtreeHits).toBe(0)
  } finally { target.destroy(); await limited.dispose() }
  expect(resident).toBe(0)
})

it('t109 画外剔除与效果/父变换正反例像素，媒体纹理原地变化不复用', async () => {
  const output = texture(); const media = texture()
  try {
    const commands = evaluateCodeMaterial(compileCodeMaterial(source('return [rect({x:100,y:0,width:10,height:10,fill:[1,0,0,1]}),group({x:-100},[rect({x:110,y:10,width:10,height:10,fill:[0,1,0,1]})]),rect({x:70,y:30,width:10,height:10,fill:[0,0,1,1],shadow:{x:-30,y:0,blur:0,color:[1,0,0,1]}})];')), context)
    await runtime.render(output, W, H, commands)
    expect(runtime.reuse.culledDraws).toBe(1)
    const pixels = await read(output); expect(pixel(pixels, 15, 15)).toEqual([0, 255, 0, 255]); expect(pixel(pixels, 45, 35)).toEqual([255, 0, 0, 255])
    const image: CodeDrawCommand = { kind: 'image', source: { kind: 'image', mediaId: 'live' }, x: 0, y: 0, width: W, height: H, opacity: 1 }
    const inputs = new Map([['live', { texture: media, width: W, height: H, owner: wrapped, premultiplied: true }]])
    for (const channel of [0, 1]) {
      const bytes = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) { bytes[i * 4 + channel] = 255; bytes[i * 4 + 3] = 255 }
      device.queue.writeTexture({ texture: media as never }, bytes, { bytesPerRow: W * 4 }, [W, H])
      await runtime.render(output, W, H, [image], inputs)
      expect(runtime.reuse.frameHits).toBe(0); expect(pixel(await read(output), 10, 10)[channel]).toBe(255)
    }
  } finally { output.destroy(); media.destroy() }
})

it.runIf(!!process.env.HENJI_T109_BENCH)('t109 分段基准与改前像素（每通道容差 1，变化通道不超过 0.01%）', async () => {
  const report: unknown[] = []
  for (const name of ['complex-to-simple', 'variety-title', 'tech-title']) {
    const program = compileCodeMaterial(readFileSync(`src/tests/fixtures/videoEdit/performance/${name}.ts.txt`, 'utf8'))
    const output = texture(1920, 1080)
    try {
      for (const start of [30, 96, 166]) {
        const cpu: number[] = []; const gpuTimes: number[] = []; const totals: number[] = []; const submissions: number[] = []
        let frameHits = 0; let subtreeHits = 0; let changedChannels = 0; let maxDelta = 0
        for (let i = -5; i < 12; i++) {
          const frame = start + Math.max(0, i); const time = frame / 30
          const before = performance.now()
          const commands = evaluateCodeMaterial(program, { ...context, width: 1920, height: 1080, fps: 30, frame, time, localTime: time, sequenceTime: time }, {}, { measureText: testMeasure, cullInvisible: true })
          const evaluated = performance.now()
          const countsBefore = { ...runtime.counts }
          const submissionsBefore = queueSubmissions
          await runtime.render(output, 1920, 1080, commands)
          const submitted = performance.now()
          await device.queue.onSubmittedWorkDone()
          if (process.env.HENJI_T111_PROFILE && name === 'complex-to-simple' && start === 96 && i >= 0) process.stdout.write(`T111_FRAME ${JSON.stringify({ frame, submit: submitted - evaluated, completed: performance.now() - evaluated, counts: Object.fromEntries(Object.entries(runtime.counts).map(([key, value]) => [key, value - countsBefore[key as keyof typeof countsBefore]])) })}\n`)
          if (i >= 0) { const completed = performance.now(); cpu.push(evaluated - before); gpuTimes.push(completed - evaluated); totals.push(completed - before); submissions.push(queueSubmissions - submissionsBefore); frameHits += runtime.reuse.frameHits; subtreeHits += runtime.reuse.subtreeHits }
        }
        const pixels = await read(output, 1920, 1080)
        const path = join(tmpdir(), `henji-t109-${name}-${start}.rgba`)
        if (process.env.HENJI_T109_BENCH === 'before') writeFileSync(path, pixels)
        else {
          const original = readFileSync(path); let changed = 0; let max = 0
          expect(pixels.length).toBe(original.length)
          for (let i = 0; i < pixels.length; i++) { const delta = Math.abs(pixels[i] - original[i]); if (delta) changed++; max = Math.max(max, delta) }
          expect(max).toBeLessThanOrEqual(1); expect(changed / pixels.length).toBeLessThanOrEqual(.0001)
          changedChannels = changed; maxDelta = max
        }
        cpu.sort((a, b) => a - b); gpuTimes.sort((a, b) => a - b)
        totals.sort((a, b) => a - b); submissions.sort((a, b) => a - b)
        report.push({ name, start, cpuMedian: cpu[6], cpuP95: cpu[11], gpuMedian: gpuTimes[6], gpuP95: gpuTimes[11], totalMedian: totals[6], totalP95: totals[11], submissionsMedian: submissions[6], frameHits, subtreeHits, changedChannels, maxDelta })
      }
    } finally { output.destroy() }
  }
  process.stdout.write(`T109_${process.env.HENJI_T109_BENCH} ${JSON.stringify(report)}\n`)
}, 120_000)

it('t109 真静止结尾对照命中复用，原素材持续呼吸不误判为静止', async () => {
  const original = readFileSync('src/tests/fixtures/videoEdit/performance/complex-to-simple.ts.txt', 'utf8')
  const frozen = compileCodeMaterial(original.replace('sin(t * 1.6)', 'sin(5.5 * 1.6)'))
  const live = compileCodeMaterial(original)
  const output = texture(1920, 1080); let hits = 0
  try {
    for (let frame = 167; frame < 180; frame++) {
      const time = frame / 30; const ctx = { ...context, width: 1920, height: 1080, fps: 30, frame, time, localTime: time, sequenceTime: time }
      const commands = evaluateCodeMaterial(frozen, ctx, {}, { measureText: testMeasure, cullInvisible: true })
      await runtime.render(output, 1920, 1080, commands); hits += runtime.reuse.frameHits
    }
    expect(hits).toBe(12)
    for (let frame = 166; frame < 169; frame++) {
      const time = frame / 30
      await runtime.render(output, 1920, 1080, evaluateCodeMaterial(live, { ...context, width: 1920, height: 1080, frame, time, localTime: time, sequenceTime: time }, {}, { measureText: testMeasure, cullInvisible: true }))
      expect(runtime.reuse.frameHits).toBe(0)
    }
    process.stdout.write(`T109_STATIC_CONTROL ${JSON.stringify({ frames: 13, warmFrames: 1, frameHits: hits })}\n`)
  } finally { output.destroy() }
})
async function run(body: string): Promise<Uint8Array> {
  const target = texture(); device.pushErrorScope('validation')
  try {
    await runtime.render(target, W, H, evaluateCodeMaterial(compileCodeMaterial(source(body)), context, {}, { measureText: testMeasure }))
    const result = await read(target); expect(await device.popErrorScope()).toBeNull(); return result
  } finally { target.destroy() }
}
describe('v3 真实 GPU 像素与工作预算', () => {


  it('4K180帧文字加形状动画复用局部字形，分辨率分档提升且预览/导出像素一致', async () => {
    const calls: Array<{ width: number; height: number; ms: number }> = []
    const host = new VideoEditCodeGpuV3(wrapped, { allocate: (width, height) => texture(width, height), release: texture => texture.destroy() }, async (command, image) => {
      const start = performance.now(); const result = await rasterFixture(command, image)
      calls.push({ width: result.width, height: result.height, ms: performance.now() - start }); return result
    })
    const program = compileCodeMaterial(source('return [rect({x:900,y:500,width:800,height:600,fill:[.2,.3,.4,1]}),text({x:1200+ctx.frame*2,y:1000,text:"Motion",fontSize:144,rotation:ctx.frame/2,opacity:.3+ctx.frame/300,scale:.5+ctx.frame/360})];'))
    const target = texture(3840, 2160); const exportTarget = texture(3840, 2160); const frames: number[] = []
    device.pushErrorScope('validation')
    try {
      let commands: CodeDrawCommand[] = []
      for (let frame = 0; frame < 180; frame++) {
        const start = performance.now(); commands = evaluateCodeMaterial(program, { ...context, width: 3840, height: 2160, frame, time: frame / 60 }, {}, { measureText: testMeasure })
        await host.render(target, 3840, 2160, commands); await device.queue.onSubmittedWorkDone(); frames.push(performance.now() - start)
      }
      expect(calls).toHaveLength(1); expect(host.counts.uploads).toBe(1); expect(calls[0].width * calls[0].height).toBeLessThan(3840 * 2160 / 10)
      await host.render(exportTarget, 3840, 2160, commands)
      expect(Buffer.from(await read(exportTarget, 3840, 2160)).equals(Buffer.from(await read(target, 3840, 2160)))).toBe(true)
      const sorted = [...frames].sort((a, b) => a - b)
      let fullFrameReference: { rasterCalls: number; uploadedPixels: number; rasterMs: number; totalMs: number; p95Ms: number } | undefined
      if (process.env.HENJI_TYPOGRAPHY_GPU_COMPARE) {
        // Workload reference for the removed full-frame Canvas path. Native libvips replaces Chromium Canvas;
        // this measures the cost of repeated full-frame raster/upload, not Electron drag throughput.
        const input = texture(3840, 2160); const referenceFrames: number[] = []; let rasterMs = 0
        try {
          for (let frame = 0; frame < 180; frame++) {
            const start = performance.now(); const x = 1200 + frame * 2; const scale = .5 + frame / 360
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"><rect x="900" y="500" width="800" height="600" fill="${color([.2,.3,.4,1])}"/><g opacity="${.3 + frame / 300}" transform="translate(${x},1000) rotate(${frame / 2}) scale(${scale})"><text x="0" y="43.2" font-size="144" font-family="sans-serif" fill="${color([1,1,1,1])}">Motion</text></g></svg>`
            const data = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer(); rasterMs += performance.now() - start
            // The reference writes unpremultiplied pixels, matching the removed compositor bitmap upload.
            device.queue.writeTexture({ texture: input as never }, data, { bytesPerRow: 3840 * 4 }, [3840,2160])
            await host.render(exportTarget,3840,2160,[{ kind:'image',source:{kind:'image',mediaId:'reference'},x:0,y:0,width:3840,height:2160,opacity:1 }],new Map([['reference',{texture:input,width:3840,height:2160,owner:wrapped,premultiplied:false}]]))
            await device.queue.onSubmittedWorkDone(); referenceFrames.push(performance.now()-start)
          }
          const ordered = [...referenceFrames].sort((a,b)=>a-b)
          fullFrameReference = { rasterCalls:180, uploadedPixels:3840*2160*180, rasterMs, totalMs:referenceFrames.reduce((sum,ms)=>sum+ms,0),p95Ms:ordered[171] }
        } finally { input.destroy() }
      }
      if (process.env.HENJI_TYPOGRAPHY_GPU_OUT) writeFileSync(process.env.HENJI_TYPOGRAPHY_GPU_OUT, JSON.stringify({ frames: 180, rasterCalls: calls.length, rasterMs: calls[0].ms, uploads: host.counts.uploads, canvas: calls[0], frameP95Ms: sorted[171], totalMs: frames.reduce((sum, ms) => sum + ms, 0), fullFrameReference }, null, 2))
      const text = commands[1] as Extract<CodeDrawCommand, { kind: 'text' }>
      await host.render(target, 3840, 2160, [{ ...text, scaleX: 1.1, scaleY: 1.1 }]); expect(calls).toHaveLength(2)
      await host.render(target, 3840, 2160, [{ ...text, scaleX: 1.8, scaleY: 1.8, rotation: 15, opacity: .5, elementTransform: [1, 0, 0, 1, 300, 200] }]); expect(calls).toHaveLength(2)
      expect(calls[1].width).toBe(calls[0].width * 2); expect(await device.popErrorScope()).toBeNull()
    } finally { target.destroy(); exportTarget.destroy(); await host.dispose() }
  }, 60_000)
  it('分组旋转、不透明度与 multiply/screen/overlay/add/lighten/darken 有实际像素', async () => {
    const modes = ['normal', 'multiply', 'screen', 'overlay', 'add', 'lighten', 'darken']
    const expected = [.8, .8 * .2, .8 + .2 - .8 * .2, 2 * .8 * .2, 1, .8, .2]
    for (let i = 0; i < modes.length; i++) {
      const pixels = await run(`return [rect({x:0,y:0,width:64,height:64,fill:[.2,.2,.2,1]}),group({x:32,y:32,rotation:90,blend:"${modes[i]}"},[rect({x:0,y:0,width:16,height:16,fill:[.8,.8,.8,1]})])];`)
      expect(pixel(pixels, 24, 40)[0], modes[i]).toBeCloseTo(Math.round(expected[i] * 255), -1)
    }
    const pixels = await run('return [group({opacity:.5},[rect({x:0,y:0,width:40,height:40,fill:[1,0,0,1]}),rect({x:10,y:0,width:40,height:40,fill:[0,1,0,1]})])];')
    expect(pixel(pixels, 20, 20)[3]).toBeCloseTo(128, -1)
  })
  it('渐变与贝塞尔路径缓存上传；阴影发光与模糊由 GPU 散射出界', async () => {
    const gradient = await run('return [path({d:"M 8 8 L 56 8 Q 56 56 8 56 Z",fill:linearGradient({x1:8,y1:0,x2:56,y2:0,stops:[[0,[1,0,0,1]],[1,[0,0,1,1]]]})})];')
    expect(pixel(gradient, 14, 15)[0]).toBeGreaterThan(pixel(gradient, 14, 15)[2]); expect(pixel(gradient, 47, 15)[2]).toBeGreaterThan(pixel(gradient, 47, 15)[0]); expect(pixel(gradient, 60, 60)[3]).toBe(0)
    const body = 'return [rect({x:24,y:24,width:16,height:16,fill:[1,1,1,1],shadow:{x:10,y:0,blur:2,color:[1,0,0,1]},glow:{radius:4,intensity:2,color:[0,1,0,1]}})];'
    const glow = await run(body); expect(pixel(glow, 43, 32)[3]).toBeGreaterThan(0); expect(pixel(glow, 43, 32)[0] + pixel(glow, 43, 32)[1]).toBeGreaterThan(0)
    const grouped = await run(`return [group({},[rect({x:24,y:24,width:16,height:16,fill:[1,1,1,1],glow:{radius:4,intensity:2,color:[0,1,0,1]}})])];`)
    expect(pixel(grouped, 43, 32)[3]).toBeGreaterThan(0)
    const before = runtime.counts.uploads; await run(body); expect(runtime.counts.uploads).toBe(before)
    const blur = await run('return [rect({x:24,y:24,width:16,height:16,fill:[1,1,1,1],blur:4})];'); expect(pixel(blur, 22, 32)[3]).toBeGreaterThan(0)
  })




})


describe('作者语言着色器GPU接线（shaders 框架）', () => {



  it('五种类别至少一个真实像素输出',async()=>{
    for(const name of ['LinearGradient','Aurora','Beam','Plasma','StudioBackground']) {
      const pixels=await run(`return [shader({name:"${name}",x:0,y:0,width:64,height:64})];`)
      expect(pixels.some((v,i)=>i%4!==3 && v>20),name).toBe(true)
    }
    // Style and optical categories are covered above by FilmGrain/ChromaticAberration and FlutedGlass.
  },30000)

})

describe('t101 CPU/GPU 像素契约', () => {
  it.each(CODE_BLEND_NAMES)('%s 混合的半透明像素与CPU内核一致', async mode => {
    const b: CodeColor = [.24,.56,.16,.8]; const a: CodeColor = [.54,.12,.36,.6]
    const pixels = await run(`return [rect({x:0,y:0,width:64,height:64,fill:[.3,.7,.2,.8]}),rect({x:0,y:0,width:64,height:64,fill:[.9,.2,.6,.6],blend:"${mode}"})];`)
    const expected = codeCompositePixel(b, a, mode)
    pixel(pixels,32,32).forEach((channel,i)=>expect(Math.abs(channel-expected[i]*255)).toBeLessThanOrEqual(2))
  })
  it('alpha/luma/invert 组合对任意遮罩图层与CPU逐像素结果一致，动画可寻帧', async () => {
    const shapes = [
      'rect({x:ctx.frame,y:8,width:30,height:35,fill:[.2,.8,.4,.5]})',
      'path({d:"M8 8L52 8L32 52Z",fill:[.2,.8,.4,.5]})',
      'text({x:10,y:32,text:"AI",fontSize:24,fill:[.2,.8,.4,.5]})',
      'shader({name:"LinearGradient",params:{colorA:[.2,.8,.4,.5],colorB:[.8,.2,.4,.8]},x:8,y:8,width:40,height:40})',
    ]
    for (const shape of shapes) {
      const mask = await run(`return [${shape}];`)
      for (const mode of ['alpha','luma'] as const) for (const invert of [false,true]) {
        const actual = await run(`return [group({mask:{shape:${shape},mode:"${mode}",invert:${invert}}},[rect({x:0,y:0,width:64,height:64,fill:[1,0,0,1]})])];`)
        for (let i=0;i<actual.length;i+=4) {
          const expected = codeMaskCoverage(Array.from(mask.slice(i,i+4),v=>v/255) as CodeColor,mode,invert)*255
          expect(Math.abs(actual[i]-expected),`${shape} ${mode} ${invert} pixel ${i/4}`).toBeLessThanOrEqual(2)
          expect(actual[i+3]).toBe(actual[i]); expect(actual[i+1]+actual[i+2]).toBe(0)
        }
      }
    }
    const animated = compileCodeMaterial(source('return [group({clip:{x:8,y:8,width:48,height:48},mask:{shape:rect({x:ctx.frame,y:0,width:16,height:64,fill:[1,1,1,1]}),mode:"alpha"}},[rect({x:0,y:0,width:64,height:64,fill:[1,0,0,1]})])];'))
    const target=texture(); try {
      const render=async(frame:number)=>{await runtime.render(target,W,H,evaluateCodeMaterial(animated,{...context,frame}));return read(target)}
      const a=await render(8); const b=await render(32); expect(a).not.toEqual(b);expect(await render(8)).toEqual(a)
      expect(pixel(a,12,4)[3]).toBe(0);expect(pixel(a,12,12)[3]).toBe(255)
    } finally {target.destroy()}
  },30000)
  it('借用图片作luma遮罩不改变图片资源',async()=>{
    const input=texture(); const target=texture();const data=new Uint8Array(W*H*4)
    for(let i=0;i<data.length;i+=4)data.set([0,128,0,128],i)
    device.queue.writeTexture({texture:input as never},data,{bytesPerRow:W*4},[W,H])
    const program=compileCodeMaterial(source('return [group({mask:{shape:image({source:ctx.params.pic,x:0,y:0,width:64,height:64}),mode:"luma"}},[rect({x:0,y:0,width:64,height:64,fill:[1,0,0,1]})])];').replace('parameters:{}','parameters:{pic:{type:"image",title:"图片",default:null}}'))
    try {
      await runtime.render(target,W,H,evaluateCodeMaterial(program,context,{pic:{kind:'image',mediaId:'mask'}}),new Map([['mask',{texture:input,width:W,height:H,owner:wrapped,premultiplied:true}]]))
      expect(pixel(await read(target),32,32)).toEqual([92,0,0,92]);expect(await read(input)).toEqual(data)
    } finally {input.destroy();target.destroy()}
  })
  it('32色标锥形渐变CPU栅格与GPU呈现逐像素一致',async()=>{
    const stops=Array.from({length:32},(_,i)=>[i/31,[i/31,1-i/31,.5,.8]])
    const code=source(`return [rect({x:0,y:0,width:64,height:64,fill:conicGradient({cx:32,cy:32,angle:45,stops:${JSON.stringify(stops)}})})];`)
    const commands=evaluateCodeMaterial(compileCodeMaterial(code),context)
    const reference=await rasterFixture(commands[0],{x:0,y:0,width:W,height:H}) as unknown as {pixels:Uint8Array}
    const target=texture();try {
      await runtime.render(target,W,H,commands)
      const actual=await read(target)
      // 0°/360° 接缝两侧颜色从首色标跳到末色标，软件与硬件 GPU 的浮点误差会让紧贴接缝的像素落到另一侧；只豁免离接缝 1 像素内的像素。
      const seam=(index:number):boolean=>{const p=index>>2;const dx=p%W+.5-32;const dy=Math.floor(p/W)+.5-32;const a=((Math.atan2(dy,dx)/(Math.PI*2)-45/360)%1+1)%1;return Math.min(a,1-a)*Math.PI*2*Math.hypot(dx,dy)<1}
      actual.forEach((value,i)=>{if(!seam(i))expect(Math.abs(value-reference.pixels[i])).toBeLessThanOrEqual(1)})
    }finally{target.destroy()}
  })

  it('8/32色标求值与GPU完成性能实测',async()=>{
    const target=texture();const report:unknown[]=[]
    try {for(const count of [8,32]) {
      const program=compileCodeMaterial(source(`return [rect({x:0,y:0,width:64,height:64,fill:conicGradient({cx:32,cy:32,stops:${JSON.stringify(Array.from({length:count},(_,i)=>[i/(count-1),[i/(count-1),0,1,1]]))}})})];`))
      const cpu:number[]=[];const completed:number[]=[]
      for(let frame=0;frame<25;frame++) {const start=performance.now();const commands=evaluateCodeMaterial(program,context);const after=performance.now();await runtime.render(target,W,H,commands);await device.queue.onSubmittedWorkDone();if(frame>=5){cpu.push(after-start);completed.push(performance.now()-after)}}
      report.push({stops:count,frames:20,cpuMeanMs:cpu.reduce((a,b)=>a+b)/20,gpuCompletedMeanMs:completed.reduce((a,b)=>a+b)/20})
    }}finally{target.destroy()}
    process.stdout.write(`T101_GRADIENT_BENCH ${JSON.stringify(report)}\n`)
  })
})


it('逐字颜色、倾斜、模糊与发光在组内保留，缺省字继承父级填充',async()=>{
  const pixels=await run('return [group({x:4,y:4,skewY:5},[text({x:8,y:16,text:"AB",fontSize:24,fill:[0,1,0,1],perChar:(i,n)=>({fill:i===0?rgba(1,0,0,1):rgba(0,1,0,1),blur:i,skewX:i*15,glow:{radius:3,intensity:1,color:[0,0,1,1]}})})])];')
  expect(pixels.some((v,i)=>i%4===0&&v>100)).toBe(true)
  expect(pixels.some((v,i)=>i%4===1&&v>100)).toBe(true)
  expect(pixels.some((v,i)=>i%4===2&&v>10)).toBe(true)
})

it('codeB 九帧联系表每格保留 GPU 画面和左上角时间码，位图逐帧独立释放', async () => {
  const program = compileCodeMaterial(readFileSync(new URL('../../../tests/fixtures/videoEdit/contactSheet/variety-title.ts.txt', import.meta.url), 'utf8'))
  const document = createVideoEditTestDocument('综艺花字片头')
  document.items.push({ id: 'code-b', name: '综艺花字片头', kind: 'code', code: { definitionId: 'code-b', versionId: 'v1', parameters: {} } })
  const sequence = document.sequences[0]
  sequence.width = 1920; sequence.height = 1080
  sequence.clips.push({ ...makeVideoEditItemClip(document, 'code-b', sequence.id, { frame: 0 }, () => program), duration: 120 })
  const composition = videoEditComposition(document, sequence.id)
  const bitmaps: ContactSheetBitmap[] = []; const requested: number[] = []
  // Keep the real trial queue and contact-sheet painter; replace only the browser Worker
  // boundary with native Dawn rendering + explicit owned CPU pixels (no canvas expiry in Node).
  vi.doMock('./videoEditRenderSession', () => ({ VideoEditRenderSession: class {
    async present(frame: number) {
      requested.push(frame)
      const target = texture(1920, 1080)
      try {
        device.pushErrorScope('validation')
        const time = frame / composition.fps
        const commands = evaluateCodeMaterial(program, { ...context, width: 1920, height: 1080, fps: composition.fps, frame, time, localTime: time, sequenceTime: time }, {}, { measureText: testMeasure })
        await runtime.render(target, 1920, 1080, commands)
        const pixels = await read(target, 1920, 1080)
        expect(await device.popErrorScope()).toBeNull()
        const bitmap = new ContactSheetBitmap(pixels, 1920, 1080); bitmaps.push(bitmap)
        return { presented: true, bitmap }
      } finally { target.destroy() }
    }
    async updateDocument() {}
    async dispose() {}
  } }))
  vi.stubGlobal('OffscreenCanvas', ContactSheetCanvas)
  try {
    const { renderVideoEditContactSheet } = await import('../application/videoEditContactSheet')
    const sheet = await renderVideoEditContactSheet(composition, { startFrame: 0, endFrame: 119, frameCount: 9 }, 1920, new AbortController().signal)
    expect(requested).toEqual([0, 15, 30, 45, 60, 74, 89, 104, 119])
    const pixels = await sharp(sheet.bytes).ensureAlpha().raw().toBuffer()
    for (let index = 0; index < 9; index++) {
      const left = index % sheet.columns * sheet.cellWidth; const top = Math.floor(index / sheet.columns) * sheet.cellHeight
      let picturePixels = 0; let labelPixels = 0
      for (let y = 0; y < sheet.cellHeight; y++) for (let x = 0; x < sheet.cellWidth; x++) {
        const at = ((top + y) * sheet.width + left + x) * 4
        if (y >= 40 && pixels[at] + pixels[at + 1] + pixels[at + 2] > 30) picturePixels++
        if (x < 140 && y < 36 && pixels[at] > 200 && pixels[at + 1] > 200 && pixels[at + 2] > 200) labelPixels++
      }
      expect(picturePixels, `帧 ${requested[index]} 的画面`).toBeGreaterThan(sheet.cellWidth * (sheet.cellHeight - 40) * .9)
      expect(labelPixels, `帧 ${requested[index]} 的时间码`).toBeGreaterThan(100)
      expect(bitmaps[index].closes).toBe(1)
    }
  } finally { vi.doUnmock('./videoEditRenderSession'); vi.unstubAllGlobals() }
}, 120_000)


it('t113 仅预热管线与字形不绘制画面，随后输出与冷会话逐通道一致', async () => {
  const make = (): VideoEditCodeGpuV3 => new VideoEditCodeGpuV3(wrapped, { allocate: (width, height) => texture(width, height), release: value => value.destroy() }, rasterFixture)
  const cold = make(); const warm = make(); const a = texture(); const b = texture()
  try {
    const program = compileCodeMaterial(source('return [text({x:5,y:20,text:"AI",fontSize:18,color:[1,.6,.2,1],perChar:(i,n)=>({x:i*.4,y:i,opacity:1,scale:1,blur:2})})];'))
    const draws = evaluateCodeMaterial(program, context, {}, { measureText: testMeasure })
    const submissions = queueSubmissions
    await warm.prepareContent(draws, () => true)
    expect(queueSubmissions).toBe(submissions)
    expect(warm.counts.uploads).toBeGreaterThan(0)
    await cold.render(a, W, H, draws); await warm.render(b, W, H, draws)
    expect(await read(b)).toEqual(await read(a))
    await expect(warm.prepareContent(draws, () => false)).rejects.toMatchObject({ name: 'AbortError' })
  } finally { a.destroy(); b.destroy(); await cold.dispose(); await warm.dispose() }
})
