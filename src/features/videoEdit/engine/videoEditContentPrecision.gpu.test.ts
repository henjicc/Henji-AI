import { VIDEO_EDIT_DARK_GRADIENT_TEST_COLORS } from '@/core/theme/colorTokens'
import { build } from 'esbuild-wasm'
import fs from 'node:fs'
import { PERSISTENCE_FORMATS } from '@/core/persistence/formats'
import { upgradePersistenceContent } from '@/core/persistence/migrations'
import { videoEditStyleSchema } from '@/core/videoEdit/styles/styleSchemas'
import { resolvePreviewAuthor } from '@/core/videoEdit/codeMaterial/authorVersion'
import { bundleAuthorFiles } from './videoEditAuthorBundle'
import generatedFactories from '../authorLibraries/effects.generated.ts?raw'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'
import { deterministicAuthorModule } from './videoEditAuthorDeterminism'
import * as authorModules from './videoEditAuthorModule'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
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
import { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import { setVideoEditGpuFaultObserver } from './videoEditGpuErrorScope'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import { readVideoEditPreciseRow, videoEditHalfToFloat } from './videoEditGpuShaders'
import { float32ToFloat16 } from '../../imageEdit/v3/gpu/imageEditorGpuTileAtlasV3'
import { CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, CODE_AUTHOR_FILL_MIN_API_VERSION, CODE_AUTHOR_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'

let gpu: Gpu, device: GpuDevice
const W = 64, H = 4
const clip: VideoEditClip = { id: 'c', itemId: 'c', name: '画面', kind: 'image', track: 0, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
const document: VideoEditComposition = { ...createVideoEditSequence(), width: W, height: H, fps: 30, clips: [clip], media: [], items: [], revision: 0 }
beforeAll(async () => { gpu = await init(); device = gpu.gpu as unknown as GpuDevice })
afterAll(() => gpu?.dispose())

it.each(['grain', 'animated-layer-effect', 'still', 'glitch-layer', 'glitch-still', 'glitch-static', 'wave-layer', 'wave-still'] as const)('恒定 settled 声明或 static 模块的 %s 输出复用与逐帧直出像素一致', async kind => {
  // 故障、波动要横向有明暗变化的画面才看得出错位。static 模块不写 frameKey，随帧效果按第 0 帧，与先渲染哪一帧无关。
  // 波动的速度按宿主帧号换成的秒数走：速度为 0 时与帧号无关，照常复用。
  const glitch = kind.startsWith('glitch'), wave = kind.startsWith('wave'), staticModule = kind === 'glitch-static', still = kind === 'still' || kind === 'glitch-still' || kind === 'wave-still' || staticModule
  const d = historyRasterDevice(glitch || wave ? (width, height) => Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % width) * 37 % 256) : undefined)
  const effect = deterministicAuthorModule({ name: '效果复用', ...(staticModule ? { mode: 'static' as const } : { frameKey: () => 'settled' }), layers: () => [
    { id: 'base', bounds: [0, 0, W, H] as [number, number, number, number],
      ...(kind === 'animated-layer-effect' ? { effects: (time: number) => [{ id: 'color_grade', params: { exposure: (time - 1) * 3 } }] } : {}),
      ...(glitch ? { effects: () => [{ id: 'glitch' as const, params: { amount: 100, block_size: 100, rhythm: kind === 'glitch-still' ? 0 : 100 } }] } : {}),
      ...(wave ? { effects: () => [{ id: 'wave' as const, params: { amount: 400, wavelength: 100, direction: 90, speed: kind === 'wave-still' ? 0 : 400 } }] } : {}),
      draw(ctx: OffscreenCanvasRenderingContext2D) { ctx.fillRect(0, 0, W, H) } },
    ...(kind === 'grain' || staticModule ? [{ id: 'grain', adjust: () => [{ id: 'film_grain' as const, params: { amount: 70 } }] }] : []),
  ] }, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
  const loader = vi.spyOn(authorModules, 'loadAuthorModule').mockResolvedValue(effect)
  const code = { definitionId: 'definition', versionId: 'v', parameters: {} }
  const doc: VideoEditComposition = { ...document, clips: [{ ...clip, kind: 'code', code, duration: 90 }],
    codeMaterials: [{ id: 'definition', name: '效果复用', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, languageVersion: 4, ...testCodeManifest(`export default { name: "效果复用", ${staticModule ? 'mode: "static", ' : ''}draw() {} }`, {}) }] }] }
  const compiler = { bundle: async (files: CodeMaterialFiles) => testAuthorBundle(files), dispose() {} }
  const run = async (reuse: boolean, quality: 'interactive' | 'final' = 'final') => {
    const host = new VideoEditCodeGpu(d), sources = new VideoEditCodeSources(doc, async () => host, compiler, undefined, reuse)
    const results: Array<{ pixels: Uint8Array; hits: number }> = []
    try {
      for (const frame of [30, 31, 32]) {
        const prepared = await sources.prepare(doc, doc.clips, frame, () => true, undefined, { quality })
        const picture = prepared.pictures.get('c') as VideoEditCodePicture
        const bytesPerRow = W * (picture.highPrecision ? 8 : 4)
        const buffer = gpu.gpu.createBuffer({ size: bytesPerRow * H, usage: 0x01 | 0x08 }), encoder = gpu.gpu.createCommandEncoder()
        encoder.copyTextureToBuffer({ texture: picture.texture as never }, { buffer, bytesPerRow }, [W, H])
        gpu.gpu.queue.submit([encoder.finish()]); await buffer.mapAsync(0x01)
        results.push({ pixels: new Uint8Array(buffer.getMappedRange().slice(0)), hits: prepared.cacheHits })
        buffer.unmap(); buffer.destroy()
      }
      expect(host.diagnostics().generatorFrames).toBe(reuse && still ? 1 : 3)
      return results
    } finally { await sources.dispose(); await host.dispose() }
  }
  device.pushErrorScope('validation')
  try {
    const direct = await run(false), reused = await run(true)
    expect(reused.map(frame => frame.hits)).toEqual(still ? [0, 1, 1] : [0, 0, 0])
    expect(reused.map(frame => frame.pixels)).toEqual(direct.map(frame => frame.pixels))
    if (still) expect(reused[0].pixels).toEqual(reused[1].pixels)
    else expect(reused[0].pixels).not.toEqual(reused[1].pixels)
    // 预览走复用与交互质量，导出逐帧直出与最终质量：同一帧逐像素相同。
    if (glitch || wave) expect((await run(true, 'interactive')).map(frame => frame.pixels)).toEqual(direct.map(frame => frame.pixels))
    expect(await device.popErrorScope()).toBeNull()
  } finally { loader.mockRestore(); vi.unstubAllGlobals() }
})
it.each(['调整层漏光', '图层波动'] as const)('0.5 倍慢放的代码图层：%s按小数帧位置逐个输出帧变化，预览复用与导出直出逐像素相同', async kind => {
  // 源时间每个输出帧只走半帧；帧位置若取整，第 31、32 帧会落在同一帧上，光和波一顿一顿。波动要横向有明暗变化的画面才看得出平移。
  const wave = kind === '图层波动'
  const d = historyRasterDevice(wave ? (width, height) => Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % width) * 37 % 256) : undefined)
  const effect = deterministicAuthorModule({ name: '慢放漏光', frameKey: () => 'settled', layers: () => [
    { id: 'base', bounds: [0, 0, W, H] as [number, number, number, number], draw(ctx: OffscreenCanvasRenderingContext2D) { ctx.fillRect(0, 0, W, H) },
      ...(wave ? { effects: () => [{ id: 'wave' as const, params: { amount: 400, wavelength: 100, direction: 90, speed: 400 } }] } : {}) },
    ...(wave ? [] : [{ id: 'leak', adjust: () => [{ id: 'light_leak' as const, params: { amount: 100, speed: 100, flicker: 100 } }] }]),
  ] }, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
  const loader = vi.spyOn(authorModules, 'loadAuthorModule').mockResolvedValue(effect)
  const code = { definitionId: 'definition', versionId: 'v', parameters: {} }
  const doc: VideoEditComposition = { ...document, clips: [{ ...clip, kind: 'code', code, duration: 90, speed: { numerator: 1, denominator: 2 } }],
    codeMaterials: [{ id: 'definition', name: '慢放漏光', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, languageVersion: 4, ...testCodeManifest('export default { name: "慢放漏光", draw() {} }', {}) }] }] }
  const compiler = { bundle: async (files: CodeMaterialFiles) => testAuthorBundle(files), dispose() {} }
  const run = async (reuse: boolean, quality: 'interactive' | 'final') => {
    const host = new VideoEditCodeGpu(d), sources = new VideoEditCodeSources(doc, async () => host, compiler, undefined, reuse)
    const results: Array<{ pixels: Uint8Array; hits: number }> = []
    try {
      for (const frame of [30, 31, 32]) {
        const prepared = await sources.prepare(doc, doc.clips, frame, () => true, undefined, { quality })
        const picture = prepared.pictures.get('c') as VideoEditCodePicture
        const bytesPerRow = W * (picture.highPrecision ? 8 : 4)
        const buffer = gpu.gpu.createBuffer({ size: bytesPerRow * H, usage: 0x01 | 0x08 }), encoder = gpu.gpu.createCommandEncoder()
        encoder.copyTextureToBuffer({ texture: picture.texture as never }, { buffer, bytesPerRow }, [W, H])
        gpu.gpu.queue.submit([encoder.finish()]); await buffer.mapAsync(0x01)
        results.push({ pixels: new Uint8Array(buffer.getMappedRange().slice(0)), hits: prepared.cacheHits })
        buffer.unmap(); buffer.destroy()
      }
      return results
    } finally { await sources.dispose(); await host.dispose() }
  }
  device.pushErrorScope('validation')
  try {
    const exported = await run(false, 'final'), previewed = await run(true, 'interactive')
    expect(previewed.map(frame => frame.hits)).toEqual([0, 0, 0])
    expect(previewed.map(frame => frame.pixels)).toEqual(exported.map(frame => frame.pixels))
    expect(exported[0].pixels).not.toEqual(exported[1].pixels)
    expect(exported[1].pixels).not.toEqual(exported[2].pixels)
    expect(await device.popErrorScope()).toBeNull()
  } finally { loader.mockRestore(); vi.unstubAllGlobals() }
})
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

it('网页同尺寸占位跨合成器共享，作者尺寸与透明像素正确，单个宿主关闭不销毁共享输入', async () => {
  const first = compositor(), second = compositor(), host = new VideoEditCodeGpu(device)
  device.pushErrorScope('validation')
  try {
    const web = { time: 0, width: W, height: H, region: [0, 0, W, H] as [number, number, number, number], scale: 1, duration: null, boxes: {} }
    const a = await first.blankWebPicture(web), b = await second.blankWebPicture(web)
    expect(a.texture).toBe(b.texture)
    expect([a.width, a.height]).toEqual([W, H])
    const prepared = await second.prepareImages(new Map([['page', b]]), () => true)
    expect([prepared.get('page')!.width, prepared.get('page')!.height]).toEqual([W, H])
    await first.dispose()
    const output = await host.target('blank', W, H, 'rgba16float')
    await second.draw(document, [clip], [b], () => true, undefined, output)
    expect(await row(output.texture)).toEqual(Array(W * 4).fill(0))
    expect(await device.popErrorScope()).toBeNull()
  } finally { await first.dispose(); await second.dispose(); await host.dispose() }
})

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
      const rendered = await chain.encode('layer', source.texture, W, H, resolveAuthorEffects([{ id: 'glow', params: { strength, dither: 0 } }]), reference, {}, 'fixed', { radius: 0, lens: false }, texture => author.mipmaps(texture, W, H), 0)
      expect(rendered.picture.format).toBe(target.textureFormat)
      author.copy(rendered.picture, target.texture, W, H); author.finish(); chain.commit()
      if (!strength) continue
      const filtered = await host.builtin('filter', { id: 'invert', params: {} }, target, 0)
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
function historyRasterDevice(raster?: (width: number, height: number) => Uint8Array): GpuDevice {
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
      gpu.gpu.queue.writeTexture({ texture: destination.texture as never }, raster?.(width, height) ?? pixels, { bytesPerRow: width * 4 }, [width, height])
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
  const stopObserving = setVideoEditGpuFaultObserver(report)
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
    // 校验原文在 encoder.finish() 时报出（未捕获），提交无效命令缓冲再由台账记一条。
    await vi.waitFor(() => expect(report.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['video_edit.gpu.uncaptured_error', 'video_edit.gpu.submit.failed'])))
    expect(report.mock.calls.some(call => /rgba16float/i.test(call[1]))).toBe(true)
    correct = true
    const calls = report.mock.calls.length
    const output = await host.authorFilter('filter', 'filter', program, {}, input, info)
    expect((await row(output.texture))[0]).toBeCloseTo(1.5, 3)
    expect(report).toHaveBeenCalledTimes(calls)
  } finally { instance.mockRestore(); await author.dispose(); await host.dispose(); stopObserving() }
})


it.each(['native', 'layers'] as const)('代码输出热命中与固定前序帧直接渲染原始像素一致（%s）', async kind => {
  const d = kind === 'layers' ? historyRasterDevice() : device
  const effect: AuthorModule = {
    name: '输出复用', mode: 'dynamic', width: W, height: H,
    frameKey: (_params, _width, _height, info) => Math.floor(info.time),
    ...(kind === 'layers' ? {
      layers: () => [{ id: 'base', opacity: .5, draw(ctx: OffscreenCanvasRenderingContext2D) { ctx.fillRect(0, 0, W / 2, H) } }, { id: 'light', effects: (time: number) => [{ id: 'glow' as const, params: { strength: time >= 1 && time < 2 ? 30 : 0, dither: 0 } }], draw(ctx: OffscreenCanvasRenderingContext2D) { ctx.fillRect(0, 0, W, H) } }],
    } : {
      createWebGPU: () => ({ draw(target: GpuTexture) {
        const encoder = device.createCommandEncoder()
        encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [.2, .1, .05, .5] }] }).end()
        device.queue.submit([encoder.finish()])
      } }),
    }),
  }
  const loader = vi.spyOn(authorModules, 'loadAuthorModule').mockResolvedValue(effect)
  const code = { definitionId: 'definition', versionId: 'v', parameters: {} }
  const doc: VideoEditComposition = { ...document, clips: [{ ...clip, kind: 'code', code, duration: 90 }], codeMaterials: [{ id: 'definition', name: '输出复用', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: 7, languageVersion: 4, ...testCodeManifest('export default { name: "输出复用", draw() {} }', {}) }] }] }
  const compiler = { bundle: async (files: CodeMaterialFiles) => testAuthorBundle(files), dispose() {} }
  const read = async (picture: VideoEditCodePicture): Promise<Uint8Array> => {
    const bytesPerRow = W * (picture.highPrecision ? 8 : 4)
    const buffer = gpu.gpu.createBuffer({ size: bytesPerRow * H, usage: 0x01 | 0x08 }), encoder = gpu.gpu.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: picture.texture as never }, { buffer, bytesPerRow }, [W, H])
    gpu.gpu.queue.submit([encoder.finish()]); await buffer.mapAsync(0x01)
    const result = new Uint8Array(buffer.getMappedRange().slice(0)); buffer.unmap(); buffer.destroy(); return result
  }
  const run = async (reuse: boolean) => {
    const host = new VideoEditCodeGpu(d), sources = new VideoEditCodeSources(doc, async () => host, compiler, undefined, reuse)
    const results: Array<{ pixels: Uint8Array; format: string; carriesLight: boolean; hits: number }> = []
    try {
      // 两条路径都先跑 0、30；比较 31 时，作者层栈历史和精度提升历史相同。
      for (const frame of [0, 30, 31, 60]) {
        const result = await sources.prepare(doc, doc.clips, frame, () => true, undefined, { quality: 'final' })
        const picture = result.pictures.get('c') as VideoEditCodePicture
        results.push({ pixels: await read(picture), format: picture.textureFormat, carriesLight: picture.carriesLight, hits: result.cacheHits })
      }
      expect(host.diagnostics().generatorFrames).toBe(reuse ? 3 : 4)
      return results
    } finally { await sources.dispose(); await host.dispose(); expect(host.diagnostics().residentBytes).toBe(0) }
  }
  device.pushErrorScope('validation')
  try {
    const direct = await run(false), cached = await run(true)
    expect(cached.map(frame => frame.hits)).toEqual([0, 0, 1, 0])
    expect(cached.map(({ hits: _hits, ...frame }) => frame)).toEqual(direct.map(({ hits: _hits, ...frame }) => frame))
    if (kind === 'layers') expect(cached.map(frame => frame.format)).toEqual(['rgba8unorm', 'rgba16float', 'rgba16float', 'rgba8unorm'])
    expect(await device.popErrorScope()).toBeNull()
  } finally { loader.mockRestore(); vi.unstubAllGlobals() }
})

it.each([['document.video_edit', 52], ['document.screen_recording', 55]] as const)('main API 9 调整层样片经 %s 迁移后可执行且逐像素不变', async (id, version) => {
  const format = PERSISTENCE_FORMATS.find(format => format.id === id)!
  const original = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8')) as { content: unknown }
  const migrated = upgradePersistenceContent(format, original.content, version)
  const sample = (value: unknown): ReturnType<typeof videoEditStyleSchema.parse>['sample'] => {
    if (id === 'document.video_edit') return videoEditStyleSchema.parse((value as { styles: unknown[] }).styles[0]).sample
    const recording = value as { scriptCapture: { baselines: Array<{ content: unknown }> } }
    const video = recording.scriptCapture.baselines.find(baseline => (baseline.content as { format?: string }).format === 'henji-video-project')!.content as { styles: unknown[] }
    return videoEditStyleSchema.parse(video.styles[0]).sample
  }
  const before = sample(original.content), after = sample(migrated)
  expect(after.code).toEqual(before.code)
  expect(before.code.files[before.code.entry]).toContain('golden-adjust')
  expect(after.apiVersion).toBe(9)
  const d = historyRasterDevice(), host = new VideoEditCodeGpu(d)
  const render = async (sample: typeof after, apiVersion: 9): Promise<number[]> => {
    const bundle = await bundleAuthorFiles({ ...sample.code, ...resolvePreviewAuthor(sample), apiVersion }, build)
    const loaded = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(bundle.code).toString('base64')) as { default: AuthorModule }
    const runtime = new VideoEditAuthorRuntime(d, deterministicAuthorModule(loaded.default, bundle.apiVersion), bundle.locations, true, bundle.apiVersion, undefined, host.effectAllocator)
    try {
      const target = await host.target('migration', W, H), precise = await host.target('migration-float', W, H, 'rgba16float')
      await runtime.render(target.texture, W, H, {}, {}, { time: .5, frameDuration: 1 / 60, clip: { time: .5, duration: 4 } }, undefined, undefined, false, undefined, {}, 'final', () => {}, () => precise.texture)
      expect(runtime.observeElements().find(element => element.id === 'golden-adjust')).toMatchObject({ kind: 'adjust', effects: [{ id: 'vignette' }] })
      return row(runtime.outputTexture!)
    } finally { await runtime.dispose() }
  }
  device.pushErrorScope('validation')
  try {
    const baseline = await render(before, 9), result = await render(after, after.apiVersion as 9)
    expect(result).toEqual(baseline)
    expect(result.some((value, index) => index % 4 < 3 && value > 0)).toBe(true)
    expect(await device.popErrorScope()).toBeNull()
  } finally { await host.dispose(); vi.unstubAllGlobals() }
})

it('真实作者打包/加载/调整层的暗角、颗粒和整体调色与片段同参数逐像素一致，opacity 混合所有通道且 clip 外不变', async () => {
  const width = 640, height = 360
  const raster = (w: number, h: number): Uint8Array => {
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const alpha = x < w / 4 ? 0 : x < w / 2 ? 128 : 255
      data.set([Math.round((.1 + .6 * x / w) * alpha), Math.round((.1 + .5 * y / h) * alpha), Math.round(.35 * alpha), alpha], (y * w + x) * 4)
    }
    return data
  }
  const d = historyRasterDevice(raster), host = new VideoEditCodeGpu(d)
  const builtin = new VideoEditBuiltinEffectsGpu(d, d.createSampler({ minFilter: 'linear', magFilter: 'linear' }), host.effectAllocator)
  const read = async (texture: GpuTexture, w: number, h: number): Promise<Float32Array> => {
    const bpp = texture.format === 'rgba16float' ? 8 : 4, bytesPerRow = Math.ceil(w * bpp / 256) * 256
    const buffer = gpu.gpu.createBuffer({ size: bytesPerRow * h, usage: 0x01 | 0x08 }), encoder = gpu.gpu.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, [w, h])
    gpu.gpu.queue.submit([encoder.finish()]); await buffer.mapAsync(0x01)
    const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Float32Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) pixels[y * w * 4 + x] = bpp === 8 ? videoEditHalfToFloat(new Uint16Array(mapped.buffer, y * bytesPerRow, w * 4)[x]) : mapped[y * bytesPerRow + x] / 255
    buffer.unmap(); buffer.destroy(); return pixels
  }
  device.pushErrorScope('validation')
  try {
    for (const [id, factory, params] of [['vignette', 'vignette', { amount: 45, midpoint: 35, feather: 65 }], ['film_grain', 'grain', { amount: 65, size: 45, monochrome: false }], ['color_grade', null, { exposure: .7 }]] as const) {
      const descriptor = factory ? `${factory}(${JSON.stringify(params)})` : JSON.stringify({ id, params })
      const bundle = await bundleAuthorFiles({ apiVersion: CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, entry: 'main.ts', files: {
        'main.ts': `import { grain, vignette } from './effects.ts'; export default { name:'调整层验收', params:[{key:'opacity',type:'number',default:1,min:0,max:1,step:.01}], layers:(p,w,h)=>[{id:'base',draw(ctx){ctx.fillRect(0,0,w,h)}},{id:'adjust',adjust:()=>[${descriptor}],clip:p.opacity===1?undefined:[80,40,w-80,h-40],pose:()=>({opacity:p.opacity,x:900,blur:100})}] }`,
        'effects.ts': generatedFactories,
      } }, build)
      const loaded = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(bundle.code).toString('base64')) as { default: AuthorModule }
      const module = deterministicAuthorModule(loaded.default, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
      const runtime = new VideoEditAuthorRuntime(d, module, bundle.locations, true, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, undefined, host.effectAllocator)
      try {
        for (const divisor of [1, 2]) {
          const w = width / divisor, h = height / divisor, source = await host.target('adjust-source', w, h)
          const data = raster(w, h)
          gpu.gpu.queue.writeTexture({ texture: source.texture as never }, data, { bytesPerRow: w * 4 }, [w, h])
          const expected = await host.target('adjust-expected', w, h, id === 'film_grain' ? 'rgba8unorm' : 'rgba16float')
          await builtin.render({ id, params: { ...params } }, { texture: source.texture, width: w, height: h, format: expected.textureFormat }, expected.texture, 17, 1 / divisor, [], 'final', { width, height })
          const filtered = await read(expected.texture, w, h)
          for (const opacity of [1, .35]) {
            const eight = await host.target('adjust-eight', w, h), precise = await host.target('adjust-precise', w, h, 'rgba16float')
            const region: [number, number, number, number] | undefined = opacity === 1 ? undefined : [80, 40, width - 80, height - 40]
            await runtime.render(eight.texture, width, height, { opacity, region }, {}, { time: 17 / 30, frameDuration: 1 / 30, clip: { time: 17 / 30, duration: 2 } }, undefined, undefined, false, { width: w, height: h }, {}, 'final', () => {}, () => precise.texture)
            const actual = await read(runtime.outputTexture!, w, h)
            let maxError = 0, changed = 0
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
              const i = (y * w + x) * 4 + c, before = data[i] / 255
              const inside = !region || (x + .5 >= region[0] / divisor && x + .5 <= region[2] / divisor && y + .5 >= region[1] / divisor && y + .5 <= region[3] / divisor)
              const desired = inside ? before * (1 - opacity) + filtered[i] * opacity : before
              maxError = Math.max(maxError, Math.abs(actual[i] - desired))
              if (inside && Math.abs(actual[i] - before) > 1 / 255) changed++
            }
            expect(maxError, JSON.stringify({ id, divisor, opacity, maxError })).toBeLessThanOrEqual(1 / 255)
            expect(changed).toBeGreaterThan(0)
            expect(runtime.observeElements().find(element => element.id === 'adjust')).toMatchObject({ kind: 'adjust', effects: [{ id }] })
          }
        }
      } finally { await runtime.dispose() }
    }
    expect(await device.popErrorScope()).toBeNull()
  } finally { builtin.dispose(); await host.dispose(); vi.unstubAllGlobals() }
}, 60000)

it('作者 fill 的渐变铺满 bounds，与片段上同参数的渐变逐像素一致，整帧升到高精度，取帧观察读回渐变', async () => {
  const width = 640, height = 360
  // 栅格桥：fill 画的是铺满 bounds 的不透明矩形，纹理四周是效果外扩；生成器按坐标解析算出，按 1 倍栅格不放大。
  const rastered: number[] = []
  const raster = (w: number, h: number): Uint8Array => {
    rastered.push(w)
    const data = new Uint8Array(w * h * 4), padX = (w - width) / 2, padY = (h - height) / 2
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x >= padX && x < w - padX && y >= padY && y < h - padY) data.set([255, 255, 255, 255], (y * w + x) * 4)
    return data
  }
  const d = historyRasterDevice(raster), host = new VideoEditCodeGpu(d)
  const builtin = new VideoEditBuiltinEffectsGpu(d, d.createSampler({ minFilter: 'linear', magFilter: 'linear' }), host.effectAllocator)
  const read = async (texture: GpuTexture): Promise<Float32Array> => {
    const bpp = texture.format === 'rgba16float' ? 8 : 4, bytesPerRow = Math.ceil(width * bpp / 256) * 256
    const buffer = gpu.gpu.createBuffer({ size: bytesPerRow * height, usage: 0x01 | 0x08 }), encoder = gpu.gpu.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, [width, height])
    gpu.gpu.queue.submit([encoder.finish()]); await buffer.mapAsync(0x01)
    const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Float32Array(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) pixels[y * width * 4 + x] = bpp === 8 ? videoEditHalfToFloat(new Uint16Array(mapped.buffer, y * bytesPerRow, width * 4)[x]) : mapped[y * bytesPerRow + x] / 255
    buffer.unmap(); buffer.destroy(); return pixels
  }
  const params = { mode: 'radial', start_color: VIDEO_EDIT_DARK_GRADIENT_TEST_COLORS.from, end_color: VIDEO_EDIT_DARK_GRADIENT_TEST_COLORS.to, start_x: 50, start_y: 40, end_x: 50, end_y: 110 }
  device.pushErrorScope('validation')
  const bundle = await bundleAuthorFiles({ apiVersion: CODE_AUTHOR_FILL_MIN_API_VERSION, entry: 'main.ts', files: {
    'main.ts': `import { gradient } from './effects.ts'; export default { name:'渐变背景', createSimulation(){let x=0;return {step(p,info){x+=info.dt},snapshot:()=>x,restore:s=>{x=Number(s)},read:()=>x,dispose(){}}}, layers:(p,w,h,a,info)=>[{id:'bg',bounds:[0,0,w,h],fill:t=>gradient({...${JSON.stringify(params)},start_x:50+Number(info.simulation.at(t))*20})}] }`,
    'effects.ts': generatedFactories,
  } }, build)
  const loaded = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(bundle.code).toString('base64')) as { default: AuthorModule }
  const runtime = new VideoEditAuthorRuntime(d, deterministicAuthorModule(loaded.default, CODE_AUTHOR_FILL_MIN_API_VERSION), bundle.locations, true, CODE_AUTHOR_FILL_MIN_API_VERSION, undefined, host.effectAllocator)
  try {
    const source = await host.target('fill-source', width, height)
    gpu.gpu.queue.writeTexture({ texture: source.texture as never }, new Uint8Array(width * height * 4).fill(255), { bytesPerRow: width * 4 }, [width, height])
    const expected = await host.target('fill-expected', width, height, 'rgba16float')
    await builtin.render({ id: 'gradient', params }, { texture: source.texture, width, height, format: 'rgba16float' }, expected.texture, 0, 1, [], 'final', { width, height })
    const eight = await host.target('fill-eight', width, height), precise = await host.target('fill-precise', width, height, 'rgba16float')
    await runtime.render(eight.texture, width, height, {}, {}, { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 2 } }, undefined, undefined, false, { width, height }, {}, 'final', () => {}, () => precise.texture)
    expect(runtime.outputTexture!.format).toBe('rgba16float')
    expect(Math.max(...rastered)).toBeLessThan(width * 2)
    const [actual, wanted] = [await read(runtime.outputTexture!), await read(expected.texture)]
    let maxError = 0
    for (let i = 0; i < actual.length; i++) maxError = Math.max(maxError, Math.abs(actual[i] - wanted[i]))
    expect(maxError).toBeLessThanOrEqual(1 / 255)
    expect(runtime.observeElements().find(element => element.id === 'bg')).toMatchObject({ effects: [{ id: 'gradient' }] })
    await runtime.render(eight.texture, width, height, {}, {}, { time: 1, frameDuration: 1 / 30, clip: { time: 1, duration: 2 } }, undefined, undefined, false, { width, height }, {}, 'final', () => {}, () => precise.texture)
    expect(await read(runtime.outputTexture!)).not.toEqual(actual)
    await runtime.render(eight.texture, width, height, {}, {}, { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 2 } }, undefined, undefined, false, { width, height }, {}, 'final', () => {}, () => precise.texture)
    expect(await read(runtime.outputTexture!)).toEqual(actual)
    expect(await device.popErrorScope()).toBeNull()
  } finally { await runtime.dispose(); builtin.dispose(); await host.dispose(); vi.unstubAllGlobals() }
}, 60000)

it('调整层效果链中产光的完整输出进入后续调色，与片段串行链的透明边缘一致', async () => {
  const host = new VideoEditCodeGpu(device), author = new VideoEditAuthorGpu(device), chain = new VideoEditAuthorEffects(device, host.effectAllocator)
  const builtin = new VideoEditBuiltinEffectsGpu(device, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), host.effectAllocator)
  device.pushErrorScope('validation')
  try {
    const input = await host.target('chain-input', W, H, 'rgba16float'), stack = await host.target('chain-stack', W, H, 'rgba16float')
    const glow = await host.target('chain-glow', W, H, 'rgba16float'), expected = await host.target('chain-expected', W, H, 'rgba16float')
    const pixels = new Uint16Array(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = W / 3 | 0; x < W * 2 / 3; x++) pixels.set([float32ToFloat16(.4), float32ToFloat16(.25), float32ToFloat16(.1), float32ToFloat16(.5)], (y * W + x) * 4)
    gpu.gpu.queue.writeTexture({ texture: input.texture as never }, pixels, { bytesPerRow: W * 8 }, [W, H])
    const descriptors = [{ id: 'glow', params: { strength: 70, source_opacity: 50, dither: 0 } }, { id: 'color_grade', params: { exposure: .7 } }]
    const effects = resolveAuthorEffects(descriptors, {}, 0, 'adjust', 'frame')
    const reference = { referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'final' as const }
    await author.begin(stack.texture); chain.begin(author.commandEncoder())
    const actual = await chain.encode('adjust', input.texture, W, H, effects, reference, {}, undefined, { radius: 0, lens: false }, () => {}, 0, undefined, true, { opacity: 1 })
    author.finish(); chain.commit()
    await builtin.render(effects[0], { texture: input.texture, width: W, height: H, format: 'rgba16float' }, glow.texture, 0, 1, [], 'final')
    await builtin.render(effects[1], { texture: glow.texture, width: W, height: H, format: 'rgba16float' }, expected.texture, 0, 1, [], 'final')
    const received = await row(actual.picture), wanted = await row(expected.texture)
    expect(Math.max(...received.map((value, index) => Math.abs(value - wanted[index])))).toBeLessThanOrEqual(1 / 255)
    expect(actual.carriesLight).toBe(true)
    expect(await device.popErrorScope()).toBeNull()
  } finally { chain.dispose(); builtin.dispose(); await author.dispose(); await host.dispose() }
})

it('元素效果覆盖（改值、关掉、追加、调整层）后的真实 GPU 画面与等价代码一致', async () => {
  const raster = (width: number, height: number): Uint8Array => {
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) data.set([(i * 37) % 256, (i * 11) % 256, 180, i % 3 ? 255 : 128], i * 4)
    return data
  }
  const d = historyRasterDevice(raster), host = new VideoEditCodeGpu(d)
  const module = (title: Array<{ id: string; key?: string; params: Record<string, unknown> }>, adjust: Array<{ id: string; params: Record<string, unknown> }>): AuthorModule => ({ name: '元素覆盖', layers: () => [
    { id: 'base', draw(ctx) { ctx.fillRect(0, 0, W, H) } },
    { id: 'title', bounds: [8, 0, W - 8, H], pose: () => ({}), effects: () => title as never, draw(ctx) { ctx.fillRect(8, 0, W - 16, H) } },
    { id: 'grade', adjust: () => adjust as never },
  ] })
  const code = module([{ id: 'glow', key: 'light', params: { strength: 20, dither: 0 } }, { id: 'blur', params: { amount: 30 } }], [{ id: 'vignette', params: { amount: 20 } }])
  const equivalent = module([{ id: 'glow', params: { strength: 70, dither: 0 } }, { id: 'color_grade', params: { exposure: .6 } }], [{ id: 'vignette', params: { amount: 75 } }])
  const overrides = { title: { effects: { light: { values: { strength: 70 } }, blur: { enabled: false } }, addedEffects: [{ key: 'tone', id: 'color_grade', params: { exposure: .6 } }] }, grade: { effects: { vignette: { values: { amount: 75 } } } } }
  const runtimes = [code, equivalent, code].map(effect => new VideoEditAuthorRuntime(d, effect, undefined, true, CODE_AUTHOR_API_VERSION, undefined, host.effectAllocator))
  const render = async (index: number, value?: typeof overrides): Promise<number[][]> => {
    const eight = await host.target(`override-${index}`, W, H), precise = await host.target(`override-${index}:float`, W, H, 'rgba16float')
    await runtimes[index].render(eight.texture, W, H, {}, {}, { time: .5, frameDuration: 1 / 30, clip: { time: .5, duration: 2 } }, value, undefined, false, undefined, {}, 'final', () => {}, () => precise.texture)
    expect(runtimes[index].outputTexture!.format).toBe('rgba16float')
    return Promise.all(Array.from({ length: H }, async (_, y) => [...await readVideoEditPreciseRow(gpu.gpu, runtimes[index].outputTexture as never, W, y)].map(videoEditHalfToFloat)))
  }
  device.pushErrorScope('validation')
  try {
    const overridden = await render(0, overrides), expected = await render(1), original = await render(2)
    expect(overridden).toEqual(expected)
    expect(overridden).not.toEqual(original)
    expect(runtimes[0].observeElements().find(element => element.id === 'title')?.effectStates?.map(state => [state.key, state.enabled, state.added])).toEqual([['light', true, false], ['blur', false, false], ['tone', true, true]])
    expect(await device.popErrorScope()).toBeNull()
  } finally { await Promise.all(runtimes.map(runtime => runtime.dispose())); await host.dispose(); vi.unstubAllGlobals() }
})

it('组合非法的元素效果覆盖在真实 GPU 渲染里退回代码值、跳过追加项，整帧照常出画', async () => {
  const raster = (width: number, height: number): Uint8Array => {
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) data.set([(i * 37) % 256, (i * 11) % 256, 180, 255], i * 4)
    return data
  }
  const d = historyRasterDevice(raster), host = new VideoEditCodeGpu(d)
  const module = (): AuthorModule => ({ name: '组合非法', layers: () => [
    { id: 'base', draw(ctx) { ctx.fillRect(0, 0, W, H) } },
    { id: 'title', bounds: [8, 0, W - 8, H], pose: () => ({}), effects: () => [{ id: 'color_grade', params: { exposure: .4, hsl_saturation_end: 80 } }] as never, draw(ctx) { ctx.fillRect(8, 0, W - 16, H) } },
  ] })
  // 逐项都在范围内、组合起来起点大于终点：代码项与代码给的终点冲突，追加项自身冲突。
  const illegal = { title: { effects: { color_grade: { values: { hsl_saturation_start: 90 } } }, addedEffects: [{ key: 'grade', id: 'color_grade', params: { hsl_saturation_start: 90, hsl_saturation_end: 10 } }] } }
  const runtimes = [module(), module()].map(effect => new VideoEditAuthorRuntime(d, effect, undefined, true, CODE_AUTHOR_API_VERSION, undefined, host.effectAllocator))
  const render = async (index: number, value?: typeof illegal): Promise<number[][]> => {
    const eight = await host.target(`illegal-${index}`, W, H), precise = await host.target(`illegal-${index}:float`, W, H, 'rgba16float')
    await runtimes[index].render(eight.texture, W, H, {}, {}, { time: .5, frameDuration: 1 / 30, clip: { time: .5, duration: 2 } }, value, undefined, false, undefined, {}, 'final', () => {}, () => precise.texture)
    return Promise.all(Array.from({ length: H }, async (_, y) => [...await readVideoEditPreciseRow(gpu.gpu, runtimes[index].outputTexture as never, W, y)].map(videoEditHalfToFloat)))
  }
  device.pushErrorScope('validation')
  try {
    const overridden = await render(0, illegal), original = await render(1)
    expect(overridden).toEqual(original)
    expect(runtimes[0].observeElements().find(element => element.id === 'title')?.effectStates?.map(state => [state.key, state.added, state.missing, state.overridden])).toEqual([['color_grade', false, false, []], ['grade', true, true, []]])
    expect(await device.popErrorScope()).toBeNull()
  } finally { await Promise.all(runtimes.map(runtime => runtime.dispose())); await host.dispose(); vi.unstubAllGlobals() }
})
