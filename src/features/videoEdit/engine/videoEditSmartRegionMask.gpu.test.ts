import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import type { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { readVideoEditPreciseRow, videoEditHalfToFloat, videoEditLayerShader } from './videoEditGpuShaders'

// 任务 4.7d 真实设备专项：智能区域蒙版上传与“只在区域内混入效果”的着色器在 Dawn 上编译并逐像素核对。npm run test:gpu 无条件执行。
const W = 8; const H = 4
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
let gpu: Gpu
let runtime: VideoEditCodeGpu
beforeAll(async () => {
  gpu = await init()
  // 读回结果需要 COPY_SRC：测试里给运行时创建的每张纹理补上这一用途，其余行为不变。
  const device = gpu.gpu
  const readable = new Proxy(device, { get: (target, key) => key === 'createTexture'
    ? (descriptor: { usage: number }) => target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 } as never)
    : (Reflect.get(target, key) as unknown) instanceof Function ? (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target) : Reflect.get(target, key) })
  runtime = new VideoEditCodeGpu(readable as unknown as GpuDevice)
})
afterAll(async () => { await runtime?.dispose(); gpu?.dispose() })

async function read(texture: GpuTexture): Promise<Uint8Array> {
  const device = gpu.gpu
  const bytesPerRow = 256
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
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]

describe('剪辑智能区域混合（真实设备）', () => {
  it('蒙版上传为预乘白色；区域内按强度混入效果画面，区域外保持原画面', async () => {
    const base = await runtime.uploadMask('base', W, H, new Uint8Array(W * H).fill(255))
    const effected = await runtime.uploadMask('effected', W, H, new Uint8Array(W * H))
    const mask = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 255
    const region = await runtime.uploadMask('region', W, H, mask)
    expect(pixel(await read(region.texture), 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(await read(region.texture), W - 1, 0)).toEqual([0, 0, 0, 0])
    const full = await read((await runtime.maskedMix('out', base, effected, region, 1)).texture)
    expect(pixel(full, 0, 1)).toEqual([0, 0, 0, 0])
    expect(pixel(full, W - 1, 1)).toEqual([255, 255, 255, 255])
    const half = await read((await runtime.maskedMix('out', base, effected, region, 0.5)).texture)
    expect(pixel(half, 0, 1)[0]).toBeGreaterThanOrEqual(127); expect(pixel(half, 0, 1)[0]).toBeLessThanOrEqual(128)
    expect(pixel(half, W - 1, 1)).toEqual([255, 255, 255, 255])
  }, 30_000)
  it.each([
    { adjustment: false, divisor: 1, format: 'rgba8unorm' as const },
    { adjustment: true, divisor: 2, format: 'rgba16float' as const },
  ])('60项代码/内置/区域效果顺序像素正确且复用固定目标：$format，调整层=$adjustment，缩放=$divisor', async ({ adjustment, divisor, format }) => {
    // Only the canvas boundary is replaced: scene ordering, target allocation, code/builtin
    // passes and masked/fractional mixes are the production implementations on a real device.
    let allocations = 0; let compiles = 0
    const raw = gpu.gpu
    const device = new Proxy(raw, { get: (target, key) => {
      if (key === 'createTexture') return (descriptor: { usage: number }) => { allocations++; return target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 } as never) }
      if (key === 'createRenderPipeline') return (descriptor: Parameters<typeof raw.createRenderPipeline>[0]) => { compiles++; return target.createRenderPipeline(descriptor) }
      const value = Reflect.get(target, key) as unknown
      return value instanceof Function ? value.bind(target) : value
    } })
    const host = device as unknown as GpuDevice
    const chain = new VideoEditCodeGpu(host)
    const sequence = createVideoEditSequence()
    const base: VideoEditClip = { id: 'base', itemId: 'base', name: '画面', kind: 'image', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
    const owner = adjustment ? { ...base, id: 'adjustment', kind: 'adjustment' as const, track: 2, adjustment: { fromTrack: 1 }, opacity: .25 } : base
    const plans: PreparedVideoEditEffect[] = []
    const context = { width: W * divisor, height: H * divisor, time: 0, localTime: 0, sequenceTime: 0, fps: 30, frame: 0 }
    const mask = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 255
    for (let index = 0; index < 40; index++) {
      const program = compileCodeMaterial(`export default {apiVersion:1,name:"旋转通道${index}",kind:"filter",mode:"static",width:16,height:8,durationSeconds:4,seed:0,parameters:{},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.g,c.b,c.r,c.a);}}`)
      plans.push({ effect: { id: `code-${index}`, name: '旋转通道', enabled: true, amount: 1, code: { definitionId: 'rotate', versionId: `v${index}`, parameters: {} } }, version: `v${index}`, program, parameters: {}, context, transitionHandles: false })
      if (index % 2 === 0) {
        const masked = index % 4 === 0
        plans.push({ effect: { id: `invert-${index}`, name: '反相', enabled: true, amount: .25, builtin: { id: 'invert', params: {} }, ...(masked ? { mask: { regionId: 'shapes', shapes: [{ id: 'left', kind: 'rect', box: [0, 0, .5, 1] }] } } : {}) }, builtin: { id: 'invert', params: {} }, ...(masked ? { mask: { width: W, height: H, data: mask } } : {}) })
      }
    }
    // Disabled and zero-strength effects must not alter either pixels or resource count.
    plans.push({ ...plans[0], effect: { ...plans[0].effect, id: 'disabled', enabled: false } }, { ...plans[0], effect: { ...plans[0].effect, id: 'zero', amount: 0 } })
    owner.effects = plans.map(plan => plan.effect)
    const document: VideoEditComposition = { ...sequence, width: W, height: H, fps: 30, revision: 0, media: [], items: [], clips: adjustment ? [base, owner] : [owner] }
    const nodes = buildVideoEditCompositePlan(document.clips); const keys = videoEditCompositeSurfaceKeys(nodes)
    const source = await chain.target('source', W, H, format)
    // Exact dyadic initial channels; the source texture is owned throughout both frames.
    const data = Array.from({ length: W * H }, () => [.125, .25, .5, 1]).flat()
    const half = (value: number): number => { const bits = new Uint32Array(new Float32Array([value]).buffer)[0]; return value === 0 ? 0 : (((bits >>> 23) & 255) - 127 + 15) << 10 | (bits >>> 13 & 1023) }
    raw.queue.writeTexture({ texture: source.texture as never }, format === 'rgba8unorm' ? Uint8Array.from(data, value => Math.round(value * 255)) : Uint16Array.from(data, half), { bytesPerRow: W * (format === 'rgba8unorm' ? 4 : 8) }, [W, H])
    const final = await chain.target('final', W, H, format)
    const module = raw.createShaderModule({ code: videoEditLayerShader(false, true) })
    const pipelines = new Map<string, ReturnType<typeof raw.createRenderPipeline>>()
    const pipelineFor = (format: 'rgba8unorm' | 'rgba16float'): ReturnType<typeof raw.createRenderPipeline> => {
      let pipeline = pipelines.get(format)
      if (!pipeline) { pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } }); pipelines.set(format, pipeline) }
      return pipeline
    }
    const sampler = raw.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const buffers = new Map<string, ReturnType<typeof raw.createBuffer>>()
    const compositor: Pick<VideoEditGpuCompositor, 'code' | 'draw'> = {
      code: async () => chain,
      draw: async (_document, clips, pictures, shouldPresent, _deadline, target = final) => {
        if (!shouldPresent()) return { presented: false, completion: Promise.resolve() }
        const encoder = raw.createCommandEncoder()
        const pipeline = pipelineFor(target.textureFormat)
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.texture.createView() as never, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
        clips.forEach((clip, index) => {
          const picture = pictures[index]
          if (!(picture instanceof VideoEditCodePicture)) throw new Error('GPU fixture requires an owned picture')
          expect(picture.texture).not.toBe(target.texture)
          let buffer = buffers.get(clip.id)
          if (!buffer) { buffer = raw.createBuffer({ size: 96, usage: 0x08 | 0x40 }); buffers.set(clip.id, buffer) }
          raw.queue.writeBuffer(buffer, 0, new Float32Array([1, 1, 1, 0, 0, 0, clip.opacity, 0, H / W, W / H, 0, 0, ...new Array<number>(12).fill(0)]))
          pass.setPipeline(pipeline)
          pass.setBindGroup(0, raw.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: picture.texture.createView() as never }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer } }] }))
          pass.draw(6)
        })
        pass.end(); raw.queue.submit([encoder.finish()])
        return { presented: true, completion: raw.queue.onSubmittedWorkDone() }
      },
    }
    const quantize = (value: number): number => format === 'rgba8unorm' ? Math.round(value * 255) / 255 : value
    const original = [.125, .25, .5].map(quantize)
    const reference = (inside: boolean): number[] => {
      let value = [...original]
      for (let index = 0; index < 40; index++) {
        value = [value[1], value[2], value[0]]
        if (index % 2 === 0 && (index % 4 !== 0 || inside)) value = value.map(channel => quantize(channel * .75 + (1 - channel) * .25))
      }
      return adjustment ? value.map((channel, index) => original[index] * .75 + channel * .25) : value
    }
    try {
      let warm: { allocations: number; compiles: number; surfaces: number } | undefined
      for (const frame of [0, 1]) {
        chain.releaseUnused(new Set([...keys, 'source', 'final']))
        const rendered = await renderVideoEditCompositeScene(document, nodes, new Map([[base.id, source]]), new Map([[owner.id, plans]]), compositor, frame, () => true, undefined, { width: W * divisor, height: H * divisor })
        await rendered.completion
        const row = format === 'rgba8unorm' ? Array.from(await read(final.texture), value => value / 255).slice(0, W * 4) : Array.from(await readVideoEditPreciseRow(host, final.texture, W, 0), videoEditHalfToFloat)
        for (let x = 0; x < W; x++) { reference(x < W / 2).forEach((value, channel) => expect(Math.abs(row[x * 4 + channel] - value)).toBeLessThan(format === 'rgba8unorm' ? 1.1 / 255 : .002)); expect(row[x * 4 + 3]).toBe(1) }
        const count = { allocations, compiles, surfaces: chain.diagnostics().surfaces }
        expect(count.surfaces).toBe(adjustment ? 8 : 7) // source + final + 3/4 chain targets + 2 shared masks
        if (warm) expect(count).toEqual(warm)
        else warm = count
      }
      expect(chain.diagnostics().filterFrames).toBe(80)
      expect(chain.diagnostics().builtinFrames).toBe(40)
    } finally { await chain.dispose(); for (const buffer of buffers.values()) buffer.destroy() }
  }, 60_000)
})
