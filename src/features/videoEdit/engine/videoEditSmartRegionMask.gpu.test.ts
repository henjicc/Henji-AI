import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import { resolveObjectURL } from 'node:buffer'
import { testAuthorBundle, testAuthorProgram, testAuthorModule } from './videoEditAuthorTestFixtures'
vi.mock('./videoEditAuthorModule', async importOriginal => {
  const actual = await importOriginal<typeof import('./videoEditAuthorModule')>()
  return { ...actual, loadAuthorModule: async (url: string) => {
    const source = await resolveObjectURL(url)!.text()
    return testAuthorModule(source)
  } }
})
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
  it('整链一次提交与逐次提交逐字节相同，重复目标上的强度、区域和末尾不透明度互不覆盖', async () => {
    const source = await runtime.target('batch-source', W, H)
    const data = Uint8Array.from({ length: W * H * 4 }, (_, index) => [31, 53, 79, 153][index % 4])
    gpu.gpu.queue.writeTexture({ texture: source.texture as never }, data, { bytesPerRow: W * 4 }, [W, H])
    const left = await runtime.uploadMask('batch-left', W, H, Uint8Array.from({ length: W * H }, (_, index) => index % W < W / 2 ? 255 : 0))
    const right = await runtime.uploadMask('batch-right', W, H, Uint8Array.from({ length: W * H }, (_, index) => index % W >= W / 2 ? 255 : 0))
    const render = async (batched: boolean): Promise<Uint8Array> => {
      const submitted = vi.spyOn(gpu.gpu.queue, 'submit')
      try {
        const batch = batched ? await runtime.beginBuiltinBatch() : undefined
        let result = source
        for (let index = 0; index < 6; index++) {
          const filtered = await runtime.builtin('batch-a', { id: index % 2 ? 'black_white' : 'invert', params: {} }, result, 0, 1, [], 'interactive', undefined, 1 / 30, undefined, batch)
          result = await runtime.maskedMix('batch-b', result, filtered, index % 2 ? right : left, .17 + index * .11, batch)
          result = await runtime.mix('batch-c', source, result, .91 - index * .07, undefined, batch)
        }
        result = await runtime.mix('batch-a', 'transparent', result, .43, undefined, batch)
        if (batch) runtime.finishBuiltinBatch(batch)
        expect(submitted).toHaveBeenCalledTimes(batched ? 1 : 19)
        submitted.mockRestore()
        return read(result.texture)
      } finally { submitted.mockRestore() }
    }
    const expected = await render(false)
    expect(await render(true)).toEqual(expected)
    expect(await render(true)).toEqual(expected)
  }, 30_000)
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
      const program = testAuthorProgram(testAuthorBundle("export default { name: '旋转通道', kind: 'filter', createWebGPU(device) {\n const module = device.createShaderModule({code: `@group(0) @binding(0) var source: texture_2d<f32>;\n @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }\n @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f { let c=textureLoad(source,vec2i(p.xy),0); return c.gbra; }`});\n const pipelines = new Map();\n return {draw(target,t,p,w,h,assets,info,inputs) {\n let pipeline=pipelines.get(target.format); if(!pipeline){pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:target.format}]}});pipelines.set(target.format,pipeline);}\n const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:inputs.current.createView()}]});\n const encoder=device.createCommandEncoder(); const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);\n }};\n}}"))
      plans.push({ effect: { id: `code-${index}`, name: '旋转通道', enabled: true, amount: 1, code: { definitionId: 'rotate', versionId: `v${index}`, parameters: {} } }, version: `v${index}`, program, parameters: {}, context, instanceKey: `code-${index}`, info: { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 4 } }, transitionHandles: false })
      if (index % 2 === 0) {
        const masked = index % 4 === 0
        plans.push({ effect: { id: `invert-${index}`, name: '反相', enabled: true, amount: .25, builtin: { id: 'invert', params: {} }, ...(masked ? { mask: { regionId: 'shapes', shapes: [{ id: 'left', kind: 'rect', points: [[0,0,0,0,0,0],[.5,0,0,0,0,0],[.5,1,0,0,0,0],[0,1,0,0,0,0]] }] } } : {}) }, builtin: { id: 'invert', params: {} }, ...(masked ? { mask: { width: W, height: H, data: mask } } : {}) })
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
  it('主体抠像经合成场景取到人物蒙版：人物蒙版按片段画到画面上，人物外变透明；共用画面之外多留一张延续后的人物蒙版', async () => {
    const raw = gpu.gpu
    const device = new Proxy(raw, { get: (target, key) => key === 'createTexture'
      ? (descriptor: { usage: number }) => target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 } as never)
      : (Reflect.get(target, key) as unknown) instanceof Function ? (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target) : Reflect.get(target, key) })
    const chain = new VideoEditCodeGpu(device as unknown as GpuDevice)
    const sequence = createVideoEditSequence()
    const effect = { id: 'key', name: '主体抠像', enabled: true, amount: 1, builtin: { id: 'subject_key', params: {} } }
    const clip: VideoEditClip = { id: 'person', itemId: 'person', name: '采访', kind: 'image', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '', effects: [effect] }
    const document: VideoEditComposition = { ...sequence, width: W, height: H, fps: 30, revision: 0, media: [], items: [], clips: [clip] }
    const nodes = buildVideoEditCompositePlan(document.clips)
    const shapes = { ...clip, effects: [{ ...effect, builtin: { id: 'invert', params: {} }, mask: { regionId: 'shapes' as const, shapes: [{ id: 'all', kind: 'rect' as const, points: [[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]] as [number, number, number, number, number, number][] }] } }] }
    const subjectKeys = videoEditCompositeSurfaceKeys(nodes), shapeKeys = videoEditCompositeSurfaceKeys(buildVideoEditCompositePlan([shapes]))
    expect([...subjectKeys].some(key => key.startsWith('composite:mask:subject:'))).toBe(true)
    expect([...shapeKeys].some(key => key.startsWith('composite:mask:document:'))).toBe(true)
    const source = await chain.target('source', W, H, 'rgba8unorm')
    raw.queue.writeTexture({ texture: source.texture as never }, Uint8Array.from({ length: W * H * 4 }, (_, index) => [40, 60, 160, 255][index % 4]), { bytesPerRow: W * 4 }, [W, H])
    const final = await chain.target('final', W, H, 'rgba8unorm')
    const module = raw.createShaderModule({ code: videoEditLayerShader(false, true) })
    const pipeline = raw.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } })
    const sampler = raw.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const uniforms = raw.createBuffer({ size: 96, usage: 0x08 | 0x40 })
    raw.queue.writeBuffer(uniforms, 0, new Float32Array([1, 1, 1, 0, 0, 0, 1, 0, H / W, W / H, 0, 0, ...new Array<number>(12).fill(0)]))
    // 只替换画布边界：片段整幅铺满画面；蒙版上传、放置与效果链都是正式实现。
    const compositor: Pick<VideoEditGpuCompositor, 'code' | 'draw'> = {
      code: async () => chain,
      draw: async (_document, _clips, pictures, _shouldPresent, _deadline, target = final) => {
        const encoder = raw.createCommandEncoder()
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.texture.createView() as never, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
        for (const picture of pictures) {
          if (!(picture instanceof VideoEditCodePicture)) throw new Error('GPU fixture requires an owned picture')
          pass.setPipeline(pipeline)
          pass.setBindGroup(0, raw.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: picture.texture.createView() as never }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: uniforms } }] }))
          pass.draw(6)
        }
        pass.end(); raw.queue.submit([encoder.finish()])
        return { presented: true, completion: raw.queue.onSubmittedWorkDone() }
      },
    }
    const matte = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) matte[y * W + x] = 255
    const plans: PreparedVideoEditEffect[] = [{ effect, builtin: effect.builtin, subject: { width: W, height: H, data: matte } }]
    try {
      const rendered = await renderVideoEditCompositeScene(document, nodes, new Map([[clip.id, source]]), new Map([[clip.id, plans]]), compositor, 0, () => true)
      await rendered.completion
      const pixels = await read(final.texture)
      expect(pixel(pixels, 1, 1)).toEqual([40, 60, 160, 255])
      expect(pixel(pixels, W - 1, 1)).toEqual([0, 0, 0, 0])
    } finally { await chain.dispose(); uniforms.destroy() }
  }, 30_000)

  it('画中画：人物在片段边上被裁断时，片段外的取样不算数——主体描边、主体发光不沿裁切线画边、不画到片段外，收缩不从裁切线吃进人物', async () => {
    const PW = 64, PH = 48, CLIP = 40
    const raw = gpu.gpu
    const device = new Proxy(raw, { get: (target, key) => key === 'createTexture'
      ? (descriptor: { usage: number }) => target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 } as never)
      : (Reflect.get(target, key) as unknown) instanceof Function ? (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target) : Reflect.get(target, key) })
    const host = device as unknown as GpuDevice
    const chain = new VideoEditCodeGpu(host)
    const picture = (data: (x: number, y: number) => number[]): VideoEditCodePicture => {
      const texture = raw.createTexture({ size: [PW, PH], format: 'rgba8unorm', usage: 0x04 | 0x02 | 0x01 })
      raw.queue.writeTexture({ texture }, Uint8Array.from({ length: PW * PH * 4 }, (_, index) => data((index >> 2) % PW, Math.floor((index >> 2) / PW))[index % 4]), { bytesPerRow: PW * 4 }, [PW, PH])
      return new VideoEditCodePicture(texture as unknown as GpuTexture, PW, PH, host)
    }
    /** 读回为 0–255；发光输出是 rgba16float，按半精度换算。 */
    const readBack = async (picture: VideoEditCodePicture): Promise<Uint8Array> => {
      const bpp = picture.highPrecision ? 8 : 4, bytesPerRow = Math.ceil(PW * bpp / 256) * 256
      const buffer = raw.createBuffer({ size: bytesPerRow * PH, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
      const encoder = raw.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture: picture.texture as never }, { buffer, bytesPerRow }, { width: PW, height: PH, depthOrArrayLayers: 1 })
      raw.queue.submit([encoder.finish()]); await buffer.mapAsync(BUFFER_MAP_READ)
      const mapped = buffer.getMappedRange(), pixels = new Uint8Array(PW * PH * 4)
      for (let y = 0; y < PH; y++) {
        if (picture.highPrecision) { const row = new Uint16Array(mapped, y * bytesPerRow, PW * 4); for (let x = 0; x < row.length; x++) pixels[y * PW * 4 + x] = Math.round(Math.min(1, Math.max(0, videoEditHalfToFloat(row[x]))) * 255) }
        else pixels.set(new Uint8Array(mapped, y * bytesPerRow, PW * 4), y * PW * 4)
      }
      buffer.unmap(); buffer.destroy(); return pixels
    }
    const at = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * PW + x) * 4, (y * PW + x) * 4 + 4)]
    // 片段只占左边 40 列（右边透明）；人物从第 20 列一直到片段右边，被片段边裁断。放好的蒙版：r = 人物 × 片段覆盖，a = 片段覆盖。
    const inClip = (x: number): boolean => x < CLIP, person = (x: number, y: number): boolean => x >= 20 && y >= 10
    const placed = picture((x, y) => inClip(x) ? [person(x, y) ? 255 : 0, 0, 0, 255] : [0, 0, 0, 0])
    const input = picture((x, y) => inClip(x) ? (person(x, y) ? [40, 60, 160, 255] : [20, 20, 24, 255]) : [0, 0, 0, 0])
    try {
      const subject = await chain.subjectMatte('subject', placed)
      const matte = await readBack(subject)
      expect(at(matte, 50, 30)).toEqual([0, 0, 0, 0]); expect(at(matte, 10, 30)).toEqual([255, 255, 255, 0]); expect(at(matte, 30, 30)).toEqual([255, 255, 255, 255])
      for (const [id, params] of [['stroke', { width: 110, color: WHITE_HEX, position: 'center', contour: 'subject' }], ['glow', { mode: 'shape', strength: 80, radius: 40, contour: 'subject' }]] as const) {
        const output = await readBack(await chain.builtin(`out-${id}`, { id, params }, input, 0, 1, [], 'final', undefined, undefined, subject))
        for (let y = 0; y < PH; y++) for (let x = CLIP; x < PW; x++) expect(at(output, x, y)[3], `${id} ${x},${y}`).toBe(0)
        // 裁切线内侧（人物贴着片段右边）原样；人物左边的轮廓照常描边、发光。
        expect(at(output, CLIP - 1, 30).map((value, c) => Math.abs(value - [40, 60, 160, 255][c])).every(diff => diff <= 1), id).toBe(true)
        expect(at(output, 19, 30)[0], id).toBeGreaterThan(60)
      }
      // H = 48 时收缩 −100 约 0.48 像素：人物左边被收进，贴着裁切线的那一列不受影响。
      const keyed = await readBack(await chain.builtin('out-key', { id: 'subject_key', params: { choke: -100 } }, input, 0, 1, [], 'final', undefined, undefined, subject))
      expect(at(keyed, CLIP - 1, 30)[3]).toBe(255); expect(at(keyed, 20, 30)[3]).toBeLessThan(160); expect(at(keyed, CLIP, 30)[3]).toBe(0)
    } finally { await chain.dispose(); placed.texture.destroy(); input.texture.destroy() }
  }, 30_000)
})
