import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Gpu } from 'vgpu/node'
import { initShaderGraphTestGpu } from './shaderEngines/shaderGraphGpu.testing'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { layoutCodeText } from '@/core/videoEdit/codeMaterial/textLayout'
import { VideoEditCodeGpuV3 } from './videoEditCodeGpuV3'
import { rasterFixture } from './videoEditCodeRaster.testing'
import { createCanvasOracle } from './videoEditCodeCanvas.testing'
import type { CodeDrawCommand } from '@/core/videoEdit/codeMaterial/contract'

let gpu: Gpu
let device: Gpu['gpu']
let wrapped: GpuDevice
beforeAll(async () => {
  gpu = await initShaderGraphTestGpu(); device = gpu.gpu
  const queue = new Proxy(device.queue, { get(target, key) {
    if (key === 'copyExternalImageToTexture') return (from: { source: { pixels: Uint8Array; width: number; height: number } }, to: { texture: Parameters<typeof device.queue.writeTexture>[0]['texture'] }) => target.writeTexture(to, from.source.pixels, { bytesPerRow: from.source.width * 4 }, [from.source.width, from.source.height])
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } })
  wrapped = new Proxy(device, { get(target, key) {
    if (key === 'queue') return queue
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } }) as unknown as GpuDevice
})
afterAll(() => gpu?.dispose())
function texture(width: number, height: number): GpuTexture {
  return device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 }) as unknown as GpuTexture
}
async function read(target: GpuTexture, width: number, height: number): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: 0x01 | 0x08 })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: target as never }, { buffer, bytesPerRow }, [width, height])
  device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
  const mapped = new Uint8Array(buffer.getMappedRange()); const result = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) result.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
  buffer.unmap(); buffer.destroy(); return result
}
const measureText: Parameters<typeof evaluateCodeMaterial>[3] = { measureText: request => layoutCodeText(request, (text, font) => Array.from(text).length * Number(font.match(/([\d.]+)px/)![1]) * .6) }
const summary = (values: number[]): { medianMs: number; p95Ms: number } => {
  values.sort((a, b) => a - b)
  return { medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * .95) - 1] }
}

const source = (body: string): string => `export default {apiVersion:1,languageVersion:3,name:"vectors",kind:"generator",mode:"dynamic",width:128,height:128,durationSeconds:1,seed:42,parameters:{},render(ctx){return [${body}];}}`
const context = { width: 128, height: 128, fps: 30, frame: 0, time: 0, localTime: 0, sequenceTime: 0 }
function difference(a: Uint8Array, b: Uint8Array): { mean: number; max: number } {
  let sum = 0; let max = 0; let channels = 0
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3] && !b[i + 3]) continue
    for (let c = 0; c < 4; c++) { const error = Math.abs(a[i + c] - b[i + c]); sum += error; max = Math.max(max, error); channels++ }
  }
  return { mean: sum / Math.max(1, channels), max }
}
// The Canvas oracle needs Playwright Chromium; opt in alongside the explicit performance suite.
// Normal GPU CI only installs Dawn, and still runs the existing pixel suite + batching/budget test.
it.runIf(process.env.HENJI_T108_CANVAS === '1')('t108 Canvas2D 对照：线帽/虚线/trim/连接/圆角/渐变/效果/寻帧', async () => {
  const oracle = await createCanvasOracle()
  const legacy = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy() }, oracle.raster, undefined, false)
  const native = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy() }, oracle.raster)
  const target = texture(128, 128); const reference = texture(128, 128)
  const gradient = 'linearGradient({x1:16,y1:0,x2:112,y2:0,stops:[[0,[1,.1,0,.8]],[.4,[.2,1,.5,.4]],[1,[0,.2,1,1]]]})'
  const cases: [string, string][] = []
  for (const cap of ['butt', 'round', 'square']) for (const width of [.7, 6]) cases.push([`cap-${cap}-${width}`, `line({x1:19.3,y1:24.2,x2:108.7,y2:94.6,width:${width},lineCap:"${cap}",color:[.8,.4,.2,.7]})`])
  for (const cap of ['butt', 'round', 'square']) cases.push([`dash-trim-${cap}`, `line({x1:16,y1:24,x2:112,y2:88,width:7,lineCap:"${cap}",dash:[12,5,3],trimStart:.13,trimEnd:.87,stroke:${gradient}})`])
  for (const join of ['miter', 'round', 'bevel']) cases.push([`join-${join}`, `path({d:"M18 90 L50 24 L62 84 L108 40",fill:[0,0,0,0],stroke:${gradient},strokeWidth:9,lineJoin:"${join}",lineCap:"round"})`])
  cases.push(['path-dash-trim', `path({d:"M18 90 L50 24 L62 84 L108 40",fill:[0,0,0,0],stroke:[1,.2,.4,.65],strokeWidth:5,lineJoin:"round",lineCap:"round",dash:[8,3],trimStart:.12,trimEnd:.91})`])
  cases.push(['winding-hole', 'path({d:"M16 16H112V112H16Z M40 40V88H88V40Z",fill:[.2,.8,.4,.8]})'])
  cases.push(['winding-overlap', 'path({d:"M16 16H88V88H16Z M40 40H112V112H40Z",fill:[.2,.8,.4,.8]})'])
  cases.push(['self-cross', 'path({d:"M16 16L112 112L16 112L112 16Z",fill:[.2,.8,.4,.8]})'])
  cases.push(['rounded-stroke', `rect({x:20.3,y:20.6,width:84,height:64,radii:[4,24,12,30],fill:${gradient},stroke:[.1,.7,1,.7],strokeWidth:8})`])
  cases.push(['dominant-corner', `rect({x:20,y:20,width:88,height:88,radii:[70,5,5,5],fill:${gradient},stroke:[.1,.7,1,.7],strokeWidth:8})`])
  cases.push(['ellipse-stroke', `ellipse({x:16,y:48,width:96,height:24,fill:${gradient},stroke:[.1,.7,1,.7],strokeWidth:7})`])
  cases.push(['radial', 'ellipse({x:16,y:16,width:96,height:96,fill:radialGradient({cx:50,cy:60,r:60,stops:[[0,[1,0,0,.8]],[1,[0,.5,1,.4]]]})})'])
  cases.push(['conic', 'rect({x:16,y:16,width:96,height:96,radius:12,fill:conicGradient({cx:64,cy:64,angle:35,stops:[[0,[1,0,0,.8]],[.5,[0,1,0,.5]],[1,[0,0,1,.8]]]})})'])
  cases.push(['effects', `line({x1:26,y1:40,x2:96,y2:80,width:6,lineCap:"round",stroke:${gradient},shadow:{x:4,y:3,blur:2,color:[0,0,1,.7]},glow:{radius:3,intensity:1,color:[0,1,0,.8]},blur:1})`])
  cases.push(['scaled-rotated', `group({x:14,y:10,rotation:13,scaleX:1.7,scaleY:1.2},[line({x1:10,y1:10,x2:48,y2:45,width:2.4,lineCap:"round",stroke:${gradient}}),path({d:"M12 40L35 8L54 50Z",fill:[0,.5,1,.5]})])`])
  cases.push(['path-own-transform', 'path({d:"M16 14L10 70L65 70Z",rotation:20,scaleX:1.3,scaleY:1.1,fill:[1,.5,0,1]})'])
  cases.push(['rect-dash', 'rect({x:24,y:24,width:80,height:70,radius:14,fill:[.2,.6,.8,.5],stroke:[1,.2,.4,.8],strokeWidth:6,lineCap:"round",dash:[13,7]})'])
  cases.push(['ellipse-dash', 'ellipse({x:24,y:30,width:80,height:60,fill:[.2,.6,.8,.5],stroke:[1,.2,.4,.8],strokeWidth:6,lineCap:"round",dash:[13,7]})'])
  cases.push(['zero-line-width', 'line({x1:20,y1:20,x2:106,y2:92,width:0,color:[1,.3,.2,1]})'])
  for (const join of ['miter', 'round', 'bevel']) cases.push([`square-stroke-${join}`, `rect({x:24,y:24,width:70,height:60,fill:[.2,.4,.8,.5],stroke:[1,.5,.2,.8],strokeWidth:12,lineJoin:"${join}"})`])
  cases.push(['closed-stroke', 'path({d:"M22 24L100 46L42 108Z",fill:[.2,.5,1,.5],stroke:[1,.5,.2,.8],strokeWidth:10,lineJoin:"miter",lineCap:"butt"})'])
  cases.push(['thin-path', 'path({d:"M20 20L75 66L108 34",fill:[0,0,0,0],stroke:[1,.3,.2,1],strokeWidth:.7,lineJoin:"round",lineCap:"round"})'])
  for (const join of ['miter', 'round', 'bevel']) cases.push([`thin-join-${join}`, `path({d:"M20 100L64 20L68 100",fill:[0,0,0,0],stroke:[1,.3,.2,1],strokeWidth:.7,lineJoin:"${join}"})`])
  const reports: unknown[] = []
  try {
    device.pushErrorScope('validation')
    for (const [name, body] of cases) {
      const commands = evaluateCodeMaterial(compileCodeMaterial(source(body)), context, {}, measureText)
      await legacy.render(reference, 128, 128, commands)
      const expected = await read(reference, 128, 128)
      await native.render(target, 128, 128, commands)
      const actual = await read(target, 128, 128)
      const error = difference(actual, expected); reports.push({ name, ...error })
      if (error.mean > 4 || error.max > 64) {
        const sharp = (await import('sharp')).default; const fs = await import('node:fs/promises')
        await fs.mkdir('node_modules/.cache/t108', { recursive: true })
        await sharp(Buffer.from(actual), { raw: { width: 128, height: 128, channels: 4 } }).png().toFile(`node_modules/.cache/t108/${name}-native.png`)
        await sharp(Buffer.from(expected), { raw: { width: 128, height: 128, channels: 4 } }).png().toFile(`node_modules/.cache/t108/${name}-canvas.png`)
        const samples = Array.from({ length: 128 * 128 }, (_, i) => ({ x: i % 128, y: Math.floor(i / 128), a: actual[i * 4 + 3], b: expected[i * 4 + 3] })).sort((a, b) => Math.abs(b.a - b.b) - Math.abs(a.a - a.b)).slice(0, 4)
        process.stdout.write(`T108_DIFF ${JSON.stringify({ name, ...error, samples })}\n`)
      }
      // 8-bit premultiplied channels; mean over the union of painted pixels, not blank padding.
      expect.soft(error.mean, name).toBeLessThanOrEqual(4)
      expect.soft(error.max, name).toBeLessThanOrEqual(64)
      await native.render(target, 128, 128, [])
      await native.render(target, 128, 128, commands)
      expect.soft(await read(target, 128, 128), `${name} random seek`).toEqual(actual)
    }
    expect(await device.popErrorScope()).toBeNull()
    expect(native.counts.uploads).toBe(2) // Curved dashes deliberately retain exact Canvas conic measurement.
    process.stdout.write(`T108_CANVAS_PIXELS ${JSON.stringify(reports)}\n`)
  } finally { target.destroy(); reference.destroy(); await native.dispose(); await legacy.dispose(); await oracle.dispose() }
}, 120_000)

it('t108 混排顺序、实例缓冲复用与 4096 绘制预算保持不变', async () => {
  let buffers = 0; let draws = 0
  const tracked = new Proxy(wrapped, { get(target, key) {
    if (key === 'createBuffer') return (descriptor: unknown) => { buffers++; return target.createBuffer(descriptor) }
    if (key === 'createCommandEncoder') return () => {
      const encoder = target.createCommandEncoder()
      return new Proxy(encoder, { get(target, key) {
        if (key === 'beginRenderPass') return (descriptor: unknown) => {
          const pass = target.beginRenderPass(descriptor)
          return new Proxy(pass, { get(target, key) {
            if (key === 'draw') return (...args: number[]) => { draws++; return (target.draw as (...args: number[]) => void)(...args) }
            const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
          } })
        }
        const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
      } })
    }
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } })
  const runtime = new VideoEditCodeGpuV3(tracked, { allocate: texture, release: t => t.destroy() }, () => { throw new Error('native vectors must not rasterize') })
  const target = texture(128, 128)
  const commands = evaluateCodeMaterial(compileCodeMaterial(source('rect({x:0,y:0,width:128,height:128,fill:[1,0,0,1]}),line({x1:0,y1:64,x2:128,y2:64,width:32,color:[0,1,0,1]}),rect({x:48,y:48,width:32,height:32,fill:[0,0,1,1]})')), context)
  try {
    await runtime.render(target, 128, 128, commands)
    const pixels = await read(target, 128, 128)
    expect([...pixels.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4)]).toEqual([0, 0, 255, 255])
    expect(draws).toBe(1)
    const allocated = buffers
    await runtime.render(target, 128, 128, commands)
    expect(buffers).toBe(allocated); expect(draws).toBe(1); expect(runtime.reuse.frameHits).toBe(1)
    runtime.invalidate(target)
    await runtime.render(target, 128, 128, commands)
    expect(buffers).toBe(allocated); expect(draws).toBe(2)
    const mixed: CodeDrawCommand[] = [commands[0], { kind: 'path', points: [[[0, 48], [128, 48], [128, 80], [0, 80]]], closed: true, fill: [0, 1, 0, 1] }, commands[2]]
    await runtime.render(target, 128, 128, mixed)
    expect(await read(target, 128, 128)).toEqual(pixels); expect(draws).toBe(5)
    const mixedBuffers = buffers
    await runtime.render(target, 128, 128, mixed)
    expect(buffers).toBe(mixedBuffers)
    const many: CodeDrawCommand[] = Array.from({ length: 4096 }, () => ({ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1, width: 1, color: [1, 1, 1, .1] }))
    await runtime.render(target, 128, 128, many)
    await expect(runtime.render(target, 128, 128, [...many, many[0]])).rejects.toMatchObject({ code: 'BUDGET' })
    const points: [number, number][] = Array.from({ length: 512 }, (_, i) => [1000 + i, 1000 + i % 2])
    const complex: CodeDrawCommand[] = Array.from({ length: 140 }, () => ({ kind: 'path', points: [points], closed: true, fill: [1, 0, 0, 1] }))
    device.pushErrorScope('validation')
    await runtime.render(target, 128, 128, complex); await device.queue.onSubmittedWorkDone()
    const grown = buffers
    await runtime.render(target, 128, 128, complex); await device.queue.onSubmittedWorkDone()
    expect(buffers).toBe(grown); expect(await device.popErrorScope()).toBeNull()
    await runtime.render(target, 128, 128, commands)
    expect(await read(target, 128, 128)).toEqual(pixels)
    expect(runtime.counts.uploads).toBe(0)
  } finally { await runtime.dispose(); target.destroy() }
})

it.runIf(['1', 'native'].includes(process.env.HENJI_T108_BENCH ?? ''))('t108 1080p 三份素材逐帧求值/队列完成基准与关键帧', async () => {
  const nativeOnly = process.env.HENJI_T108_BENCH === 'native'
  process.stdout.write(`T108_ADAPTER ${JSON.stringify(gpu.device.adapterInfo)}\n`)
  const width = 1920; const height = 1080
  for (const name of ['complex-to-simple', 'variety-title', 'tech-title']) {
    const program = compileCodeMaterial(readFileSync(new URL(`../../../tests/fixtures/videoEdit/performance/${name}.ts.txt`, import.meta.url), 'utf8'))
    const referenceKeys = new Map<number, Uint8Array>()
    let before = 0
    for (const nativeVectors of (nativeOnly ? [true] : [false, true])) {
      const runtime = new VideoEditCodeGpuV3(wrapped, { allocate: texture, release: t => t.destroy() }, rasterFixture, undefined, nativeVectors)
      const target = texture(width, height)
      const cpu: number[] = []; const draw: number[] = []; const submitted: number[] = []; const buckets: number[][] = []; const keys = new Map<number, Uint8Array>()
      const frames = Math.ceil(program.durationSeconds * 30)
      try {
        for (let frame = -3; frame < frames; frame++) {
          const at = Math.max(0, frame); const time = at / 30
          const start = performance.now()
          const commands = evaluateCodeMaterial(program, { width, height, fps: 30, frame: at, time, localTime: time, sequenceTime: time }, {}, measureText)
          const evaluated = performance.now()
          await runtime.render(target, width, height, commands); const afterSubmit = performance.now(); await device.queue.onSubmittedWorkDone()
          if (frame >= 0) { const elapsed = performance.now() - evaluated; cpu.push(evaluated - start); draw.push(elapsed); submitted.push(afterSubmit - evaluated); (buckets[Math.floor(frame / 30)] ??= []).push(elapsed) }
          if ([0, 30, 60, frames - 1].includes(frame)) {
            const pixels = await read(target, width, height); keys.set(frame, pixels)
            if (!nativeVectors) referenceKeys.set(frame, pixels)
            else if (!nativeOnly) { const error = difference(pixels, referenceKeys.get(frame)!); process.stdout.write(`T108_KEY_PIXELS ${JSON.stringify({ name, frame, ...error })}\n`); expect.soft(error.mean, `${name} ${frame}`).toBeLessThanOrEqual(4); expect.soft(error.max, `${name} ${frame}`).toBeLessThanOrEqual(64) }
          }
        }
        expect(keys.size).toBe(4)
        process.stdout.write(`T108_BENCH ${JSON.stringify({ name, nativeVectors, frames, width, height, raster: 'native libvips SVG (same reference as existing GPU suite; includes line/trim)', evaluate: summary(cpu), drawCompleted: summary(draw), submit: summary(submitted), seconds: buckets.map(summary), counts: runtime.counts })}\n`)
        if (!nativeVectors) before = summary(draw).medianMs
        else if (!nativeOnly || name === 'complex-to-simple') { expect.soft(summary(draw).medianMs, name).toBeLessThan(name === 'complex-to-simple' ? 6 : before * 1.15) }
      } finally { await runtime.dispose(); target.destroy() }
    }
  }
}, 600_000)
