import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { resolveAuthorEffects } from '@/core/videoEdit/authorEffects'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import { VideoEditAuthorPrograms } from './videoEditAuthorPrograms'
import { testAuthorBundle, testAuthorProgram } from './videoEditAuthorTestFixtures'
import type { AuthorModule } from './videoEditAuthorModule'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditAuthorEffects } from './videoEditAuthorEffects'
import { VideoEditCodeGpu, VideoEditCodePicture, setVideoEditCodeGpuErrorObserver } from './videoEditCodeGpu'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import { readVideoEditPreciseRow, videoEditHalfToFloat } from './videoEditGpuShaders'
import { float32ToFloat16 } from '../../imageEdit/v3/gpu/imageEditorGpuTileAtlasV3'

let gpu: Gpu, device: GpuDevice
const W = 64, H = 4
const clip: VideoEditClip = { id: 'c', itemId: 'c', name: '画面', kind: 'image', track: 0, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
const document: VideoEditComposition = { ...createVideoEditSequence(), width: W, height: H, fps: 30, clips: [clip], media: [], items: [], revision: 0 }
beforeAll(async () => { gpu = await init(); device = gpu.gpu as unknown as GpuDevice })
afterAll(() => gpu?.dispose())
function compositor(): VideoEditGpuCompositor {
  const canvas = { width: W, height: H, getContext: () => ({ configure() {} }) } as unknown as OffscreenCanvas
  return new VideoEditGpuCompositor(canvas, { ready: Promise.resolve(), device, canvasFormat: 'rgba8unorm', assertDevice() {} } as unknown as VideoEditGpuCompositor)
}
async function row(texture: GpuTexture): Promise<number[]> {
  return [...await readVideoEditPreciseRow(gpu.gpu, texture as never, W, 1)].map(videoEditHalfToFloat)
}
function fill(texture: GpuTexture, value: number[]): void {
  const data = new Uint16Array(W * H * 4)
  for (let i = 0; i < data.length; i++) data[i] = float32ToFloat16(value[i % 4])
  gpu.gpu.queue.writeTexture({ texture: texture as never }, data, { bytesPerRow: W * 8 }, [W, H])
}

it('正式作者层栈累加零 alpha 光，嵌套与 opacity 交接保持超白；素材输入仍钳制', async () => {
  const host = new VideoEditCodeGpu(device), author = new VideoEditAuthorGpu(device), comp = compositor()
  device.pushErrorScope('validation')
  try {
    const source = await host.target('source', W, H, 'rgba16float')
    const stack = await host.target('stack', W, H, 'rgba16float')
    fill(source.texture, [.75, .75, .75, 0])
    await author.begin()
    await author.prepareFormat(stack.textureFormat)
    author.clear(stack.texture)
    const samples: CodeMotionSample[] = [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }]
    for (let i = 0; i < 2; i++) author.draw(stack.texture, W, H, { texture: source.texture, x: 0, y: 0, width: W, height: H }, samples)
    author.finish(); stack.carriesLight = true
    expect((await row(stack.texture))[0]).toBeCloseTo(1.5, 3)
    const child = await host.target('child', W, H, 'rgba16float'), parent = await host.target('parent', W, H, 'rgba16float')
    await comp.draw(document, [clip], [stack], () => true, undefined, child)
    await comp.draw(document, [{ ...clip, opacity: .25 }], [child], () => true, undefined, parent)
    expect((await row(parent.texture))[0]).toBeCloseTo(.375, 3)
    expect((await row(parent.texture))[3]).toBe(0)
    const moving = { ...clip, motionSamples: [{ ...clip, x: 0 }, { ...clip, x: 0 }] }
    await comp.draw(document, [moving], [stack], () => true, undefined, parent)
    expect((await row(parent.texture))[0]).toBeCloseTo(1.5, 3)
    fill(source.texture, [1.5, 1.5, 1.5, 1])
    const media = new VideoEditGpuFrame({ timestamp: 0, duration: 1, displayWidth: W, displayHeight: H, rotation: 0, flip: false }, source.texture, undefined, W * H * 8, () => {}, undefined, true)
    await comp.draw(document, [clip], [media], () => true, undefined, parent)
    expect((await row(parent.texture))[0]).toBe(1)
    expect(await device.popErrorScope()).toBeNull()
  } finally { await comp.dispose(); await author.dispose(); await host.dispose() }
})

it('作者效果→层栈→片段→amount/mask→转场保持浮点，强度归零后回到原格式', async () => {
  const host = new VideoEditCodeGpu(device), author = new VideoEditAuthorGpu(device), chain = new VideoEditAuthorEffects(device, host.effectAllocator)
  device.pushErrorScope('validation')
  try {
    const source = await host.target('source', W, H)
    gpu.gpu.queue.writeTexture({ texture: source.texture as never }, new Uint8Array(W * H * 4).fill(200), { bytesPerRow: W * 4 }, [W, H])
    const reference = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
    let first: number[] | undefined
    for (const strength of [0, 30, 0, 30, 0]) {
      const target = await host.target('stack', W, H, strength ? 'rgba16float' : 'rgba8unorm')
      await author.begin(target.texture); chain.begin(author.commandEncoder())
      const rendered = await chain.encode('layer', source.texture, W, H, resolveAuthorEffects([{ id: 'glow', params: { strength, dither: 0 } }]), reference, {}, 'fixed', { radius: 0, lens: false }, texture => author.mipmaps(texture, W, H))
      expect(rendered.picture.format).toBe(target.textureFormat)
      author.copy(rendered.picture, target.texture, W, H); author.finish(); chain.commit()
      if (!strength) continue
      const filtered = await host.builtin('filter', { id: 'brightness_contrast', params: { brightness: 2 } }, target, 0)
      const mixed = await host.mix('mixed', target, filtered, .25)
      const mask = await host.uploadMask('mask', W, H, new Uint8Array(W * H).fill(128))
      const masked = await host.maskedMix('masked', target, mixed, mask, .5)
      const transitioned = await host.mix('transition', masked, target, .5)
      for (const picture of [filtered, mixed, masked, transitioned]) expect(picture.textureFormat).toBe('rgba16float')
      const values = await row(transitioned.texture)
      if (first) expect(values).toEqual(first)
      first = values
      expect(await host.spillGeneratorTarget('stack')).toBeUndefined()
    }
    expect(await device.popErrorScope()).toBeNull()
  } finally { chain.dispose(); await author.dispose(); await host.dispose() }
  expect(host.diagnostics().residentBytes).toBe(0)
})

it('10 位素材与普通嵌套帧经浮点变体仍逐字节相同', async () => {
  const host = new VideoEditCodeGpu(device), comp = compositor()
  device.pushErrorScope('validation')
  try {
    const source = await host.target('source', W, H, 'rgba16float'), direct = await host.target('direct', W, H, 'rgba16float'), nested = await host.target('nested', W, H, 'rgba16float')
    const data = new Uint16Array(W * H * 4)
    for (let i = 0; i < data.length; i++) data[i] = float32ToFloat16(i % 4 === 3 ? 1 : Math.floor(i / 4) / (W * H - 1))
    gpu.gpu.queue.writeTexture({ texture: source.texture as never }, data, { bytesPerRow: W * 8 }, [W, H])
    const media = new VideoEditGpuFrame({ timestamp: 0, duration: 1, displayWidth: W, displayHeight: H, rotation: 0, flip: false }, source.texture, undefined, W * H * 8, () => {}, undefined, true)
    await comp.draw(document, [clip], [media], () => true, undefined, direct)
    await comp.draw(document, [clip], [new VideoEditCodePicture(source.texture, W, H, device, 'rgba16float')], () => true, undefined, nested)
    expect(await readVideoEditPreciseRow(gpu.gpu, nested.texture as never, W, 1)).toEqual(await readVideoEditPreciseRow(gpu.gpu, direct.texture as never, W, 1))
    expect(await device.popErrorScope()).toBeNull()
  } finally { await comp.dispose(); await host.dispose() }
})

it('八位视频与文字覆盖率纹理经透明叠加、变换和转场，浮点往返前后逐字节一致', async () => {
  const host = new VideoEditCodeGpu(device), comp = compositor()
  const bytes = async (texture: GpuTexture): Promise<Uint8Array> => {
    const buffer = gpu.gpu.createBuffer({ size: W * H * 4, usage: 0x01 | 0x08 }), encoder = gpu.gpu.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow: W * 4 }, [W, H])
    gpu.gpu.queue.submit([encoder.finish()]); await buffer.mapAsync(0x01)
    const result = new Uint8Array(buffer.getMappedRange().slice(0)); buffer.unmap(); buffer.destroy(); return result
  }
  device.pushErrorScope('validation')
  try {
    const source = await host.target('coverage', W, H), target = await host.target('eight', W, H)
    const data = new Uint8Array(W * H * 4)
    for (let i = 0; i < data.length; i += 4) data.set([i % 127, i % 127, i % 127, i % 127], i)
    gpu.gpu.queue.writeTexture({ texture: source.texture as never }, data, { bytesPerRow: W * 4 }, [W, H])
    const video = new VideoEditGpuFrame({ timestamp: 0, duration: 1, displayWidth: W, displayHeight: H, rotation: 0, flip: false }, source.texture, undefined, W * H * 4, () => {})
    const render = async (): Promise<Uint8Array> => {
      await comp.draw(document, [clip, { ...clip, id: 'title', scale: .8, rotation: 12, opacity: .6, x: .1 }], [video, source], () => true, undefined, target)
      const transition = await host.mix('transition8', source, target, .37)
      expect(transition.highPrecision).toBe(false)
      return bytes(transition.texture)
    }
    const before = await render()
    const precise = await host.target('precise', W, H, 'rgba16float')
    fill(precise.texture, [1.5, .5, .5, 0]); precise.carriesLight = true
    const temporary = await host.target('temporary', W, H, 'rgba16float')
    await comp.draw(document, [clip], [precise], () => true, undefined, temporary)
    expect(await render()).toEqual(before)
    expect(await device.popErrorScope()).toBeNull()
  } finally { await comp.dispose(); await host.dispose() }
})

it('浮点目标对非产光代码画面保持 [0,a]，产光只放开上限；运动累积遵循同一边界', async () => {
  const host = new VideoEditCodeGpu(device), comp = compositor()
  device.pushErrorScope('validation')
  try {
    const source = await host.target('source', W, H, 'rgba16float'), target = await host.target('target', W, H, 'rgba16float')
    fill(source.texture, [-.5, 1.5, .4, .25])
    for (const moving of [false, true]) for (const light of [false, true]) {
      source.carriesLight = light
      const placed = moving ? { ...clip, motionSamples: [{ ...clip }, { ...clip }] } : clip
      await comp.draw(document, [placed], [source], () => true, undefined, target)
      const values = await row(target.texture)
      expect(values[0]).toBe(0)
      expect(values[1]).toBeCloseTo(light ? 1.5 : .25, 3)
      expect(values[2]).toBeCloseTo(light ? .4 : .25, 3)
      expect(values[3]).toBe(.25)
    }
    expect(await device.popErrorScope()).toBeNull()
  } finally { await comp.dispose(); await host.dispose() }
})

/** 固定已栅格化的输入像素，只测正式作者缓存调度、效果与 GPU 合成，不替代浏览器 Canvas 验收。 */
function historyRasterDevice(): GpuDevice {
  class Bitmap { width = W; height = H; close(): void {} }
  class Canvas {
    constructor(public width: number, public height: number) {}
    readonly context = {
      globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: 'black', filter: 'none',
      reset() {}, save() {}, restore() {}, setTransform() {}, scale() {}, translate() {},
      beginPath() {}, rect() {}, clip() {}, fillRect() {}, clearRect() {}, drawImage() {},
      getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.width * this.height * 4) }),
      measureText: () => ({ width: 1 }),
    }
    getContext(): typeof this.context { return this.context }
  }
  vi.stubGlobal('OffscreenCanvas', Canvas); vi.stubGlobal('ImageBitmap', Bitmap)
  vi.stubGlobal('createImageBitmap', async () => new Bitmap())
  const queue = new Proxy(device.queue, { get(target, key) {
    if (key === 'copyExternalImageToTexture') return (_source: { source: Canvas }, destination: { texture: GpuTexture }, size: number[]) => {
      const [width, height] = size, pixels = new Uint8Array(width * height * 4)
      for (let i = 0; i < pixels.length; i += 4) pixels.set([51, 51, 51, 255], i)
      gpu.gpu.queue.writeTexture({ texture: destination.texture as never }, pixels, { bytesPerRow: width * 4 }, [width, height])
    }
    const value: unknown = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return new Proxy(device, { get(target, key) {
    if (key === 'queue') return queue
    const value: unknown = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

it.each(['still', 'direct', 'live'] as const)('触发帧独立实例与有历史实例格式、GPU 像素相同（%s）', async history => {
  const d = historyRasterDevice(), host = new VideoEditCodeGpu(d)
  const module: AuthorModule = { name: '历史精度', layers: (_params, _width, _height, assets) => [
    { id: 'base', draw(ctx) { ctx.fillRect(0, 0, W, H) } },
    { id: 'changing', draw(ctx, time) { ctx.fillRect(time, 0, W, H) } },
    { id: 'effect', bounds: [0, 0, W / 4, H / 4], pose: () => ({ scale: 4 }),
      effects: time => [{ id: 'glow', params: { strength: time >= 1 ? 30 : 0, dither: 0 } }],
      draw(ctx, time) {
        if (history === 'direct' && time === 0) ctx.getImageData(0, 0, 1, 1)
        if (history === 'live') ctx.drawImage(assets.frame, 0, 0)
        else ctx.fillRect(0, 0, W / 4, H / 4)
      } },
  ] }
  const warm = new VideoEditAuthorRuntime(d, module, undefined, true, 7, undefined, host.effectAllocator)
  const fresh = new VideoEditAuthorRuntime(d, module, undefined, true, 7, undefined, host.effectAllocator)
  const render = async (runtime: VideoEditAuthorRuntime, key: string, time: number) => {
    const eight = await host.target(key, W, H), precise = await host.target(`${key}:float`, W, H, 'rgba16float')
    const stats = await runtime.render(eight.texture, W, H, {}, history === 'live' ? { frame: new ImageBitmap() } : {}, { time, frameDuration: 1 / 60, clip: { time, duration: 3 } }, undefined, undefined, false, undefined, {}, 'final', () => {}, () => precise.texture)
    return { stats, texture: runtime.outputTexture! }
  }
  device.pushErrorScope('validation')
  try {
    for (let i = 0; i < 4; i++) await render(warm, 'warm', i / 60)
    const hot = await render(warm, 'warm', 1), cold = await render(fresh, 'fresh', 1)
    expect(hot.texture.format).toBe('rgba16float')
    expect(cold.texture.format).toBe('rgba16float')
    if (history === 'direct') { expect(hot.stats!.direct).toBeGreaterThan(0); expect(cold.stats!.direct).toBe(0) }
    if (history === 'live') { expect(hot.stats!.video).toBeGreaterThan(0); expect(cold.stats!.video).toBe(0) }
    if (history === 'still') expect(hot.stats!.reused).toBeGreaterThan(0)
    const hotPixels = await row(hot.texture), coldPixels = await row(cold.texture)
    expect(hotPixels.some((value, i) => i % 4 < 3 && value > .1)).toBe(true)
    expect(hotPixels).toEqual(coldPixels)
    expect(await device.popErrorScope()).toBeNull()
  } finally { await warm.dispose(); await fresh.dispose(); await host.dispose(); vi.unstubAllGlobals() }
})

it('背景层加发光标题连续热帧零纹理分配，键离开后两档完整释放', async () => {
  const d = historyRasterDevice(), host = new VideoEditCodeGpu(d)
  const module: AuthorModule = { name: '热帧', layers: () => [
    { id: 'background', draw(ctx) { ctx.fillRect(0, 0, W, H) } },
    { id: 'title', effects: () => [{ id: 'glow', params: { strength: 30, dither: 0 } }], draw(ctx) { ctx.fillRect(0, 0, W / 2, H) } },
  ] }
  const author = new VideoEditAuthorRuntime(d, module, undefined, true, 7, undefined, host.effectAllocator)
  const instance = vi.spyOn(VideoEditAuthorPrograms.prototype, 'instance').mockResolvedValue(author)
  const program = { ...testAuthorProgram(testAuthorBundle('export default { name: "热帧", draw() {} }')), apiVersion: 7 as const }
  let warmAllocations = 0
  try {
    for (let frame = 0; frame < 8; frame++) {
      host.releaseUnused(new Set(['frame']))
      const picture = await host.authorGenerator('frame', 'clip', program, { width: W, height: H }, {}, {}, { time: frame / 60, frameDuration: 1 / 60, clip: { time: frame / 60, duration: 3 } }, undefined, false)
      expect(picture.textureFormat).toBe('rgba16float')
      await device.queue.onSubmittedWorkDone()
      if (frame === 2) warmAllocations = host.diagnostics().textureAllocations
      if (frame > 2) expect(host.diagnostics().textureAllocations).toBe(warmAllocations)
    }
    const bytes = host.diagnostics().residentBytes
    host.releaseUnused(new Set())
    expect(bytes - host.diagnostics().residentBytes).toBe(W * H * 12)
  } finally { instance.mockRestore(); await author.dispose(); await host.dispose(); vi.unstubAllGlobals() }
  expect(host.diagnostics().residentBytes).toBe(0)
})

it('原生滤镜格式不匹配只写设备日志，按 target.format 修正后恢复（待显卡恢复验证）', async () => {
  const host = new VideoEditCodeGpu(device), report = vi.fn()
  const stopObserving = setVideoEditCodeGpuErrorObserver(report)
  let correct = false
  const module: AuthorModule = { name: '格式错误', kind: 'filter', createWebGPU: () => ({ draw(target) {
    const shader = gpu.gpu.createShaderModule({ code: '@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); } @fragment fn fs()->@location(0) vec4f { return vec4f(1.5,0,0,1); }' })
    const format = correct ? target.format as 'rgba8unorm' | 'rgba16float' : 'rgba8unorm'
    const pipeline = gpu.gpu.createRenderPipeline({ layout: 'auto', vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format }] } })
    const encoder = gpu.gpu.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView() as never, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] })
    pass.setPipeline(pipeline); pass.draw(3); pass.end(); gpu.gpu.queue.submit([encoder.finish()])
  } }) }
  const author = new VideoEditAuthorRuntime(device, module)
  const instance = vi.spyOn(VideoEditAuthorPrograms.prototype, 'instance').mockResolvedValue(author)
  const program = testAuthorProgram(testAuthorBundle('export default { name: "格式错误", kind: "filter", draw() {} }'))
  const info = { time: 0, frameDuration: 1 / 60, clip: { time: 0, duration: 3 } }
  try {
    const input = await host.target('input', W, H, 'rgba16float')
    await host.authorFilter('filter', 'filter', program, {}, input, info)
    await vi.waitFor(() => expect(report).toHaveBeenCalled())
    expect(report.mock.calls[0][0]).toMatch(/rgba16float/i)
    correct = true
    const calls = report.mock.calls.length
    const output = await host.authorFilter('filter', 'filter', program, {}, input, info)
    expect((await row(output.texture))[0]).toBeCloseTo(1.5, 3)
    expect(report).toHaveBeenCalledTimes(calls)
  } finally { instance.mockRestore(); await author.dispose(); await host.dispose(); stopObserving() }
})
