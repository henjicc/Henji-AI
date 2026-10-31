import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ShaderGraphSession } from './shaderEngines/shaderGraphSession'
import { initShaderGraphTestGpu } from './shaderEngines/shaderGraphGpu.testing'
import { shaderGraphTransitionProps, shaderGraphTransitionSpec } from '@/core/videoEdit/shaderGraph/transitions'
import { isShaderGraphTransition } from '@/core/videoEdit/shaderGraph/transitions'
import { isGlTransition } from '@/core/videoEdit/glTransitions/transitions'
import { type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { resolveVideoEditTransitionParams, VIDEO_EDIT_BUILTIN_TRANSITION_KINDS, type VideoEditBuiltinTransitionKind } from '@/core/videoEdit/transitionParams'
import { videoEditTransitionRender, type VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { VideoEditGlTransitionsGpu } from './glTransitions/videoEditGlTransitionsGpu'
import { VIDEO_EDIT_SOURCE_TRANSITION_KINDS, VIDEO_EDIT_SOURCE_TRANSITION_PARAMS } from '@/core/videoEdit/transitionSources'
import { isRemovedVideoEditTransition, resolveVideoEditTransitionSource } from '@/core/videoEdit/transitionCatalog'
import { migrateVideoEditTransitionCollection } from '@/core/videoEdit/transitionMigration'
import { videoEditTransitionSchema } from '@/core/videoEdit/transitions'

// 任务 4.7 视频过渡真实设备专项：过渡着色器在 Dawn 上编译，逐像素核对两端、中点与单侧过渡。npm run test:gpu 无条件执行。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
const W = 64; const H = 36
const RED = [255, 0, 0, 255]; const BLUE = [0, 0, 255, 255]
type Device = Gpu['gpu']
let gpu: Gpu
let device: Device
let effects: VideoEditBuiltinEffectsGpu
beforeAll(async () => {
  gpu = await initShaderGraphTestGpu(); device = gpu.gpu
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, sampler, {
    allocate: (width, height, format) => device.createTexture({ size: [width, height], format: format as 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_DST }) as unknown as GpuTexture,
    release: texture => texture.destroy(),
  })
})
afterAll(() => { effects?.dispose(); gpu?.dispose() })

function solid(color: number[]): GpuTexture {
  const texture = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC })
  const data = new Uint8Array(W * H * 4)
  for (let at = 0; at < data.length; at += 4) data.set(color, at)
  device.queue.writeTexture({ texture }, data, { bytesPerRow: W * 4 }, [W, H])
  return texture as unknown as GpuTexture
}
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
async function run(kind: VideoEditBuiltinTransitionKind | 'dissolve', progress: number, params: Record<string, unknown> = {}, single?: 'in' | 'out'): Promise<Uint8Array> {
  const outgoing = solid(RED); const incoming = single ? outgoing : solid(BLUE)
  const output = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture
  const source = resolveVideoEditTransitionSource(kind, resolveVideoEditTransitionParams(kind, params))!
  const input: VideoEditBuiltinTransitionInput = { ...source, progress, ...(single === 'in' ? { emptyOutgoing: true } : single === 'out' ? { emptyIncoming: true } : {}) }
  await effects.renderTransition(input, outgoing, incoming, output, { width: W, height: H, format: 'rgba8unorm' })
  try { return await read(output) } finally { outgoing.destroy(); if (incoming !== outgoing) incoming.destroy(); output.destroy() }
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]
const near = (actual: number[], expected: number[], tolerance = 3): void => { actual.forEach((value, index) => expect(Math.abs(value - expected[index]), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance)) }

describe('剪辑视频过渡（真实设备）', () => {
  it('正式过渡宿主把显影中间帧升为浮点，两端回到输入精度', async () => {
    const host = new VideoEditCodeGpu(device as unknown as GpuDevice)
    device.pushErrorScope('validation')
    try {
      const outgoing = await host.target('outgoing', W, H), incoming = await host.target('incoming', W, H)
      for (const [picture, color] of [[outgoing, RED], [incoming, BLUE]] as const) {
        const data = new Uint8Array(W * H * 4)
        for (let at = 0; at < data.length; at += 4) data.set(color, at)
        device.queue.writeTexture({ texture: picture.texture as never }, data, { bytesPerRow: W * 4 }, [W, H])
      }
      for (const mode of ['noise_reveal', 'blocks_reveal', 'dots', 'halftone']) for (const progress of [0, .5, 1]) {
        const source = resolveVideoEditTransitionSource('dissolve', resolveVideoEditTransitionParams('dissolve', { mode, reveal_edge_width: 30, reveal_glow_strength: 60 }))!
        const picture = await host.transition('dissolve', { ...source, progress }, outgoing, incoming)
        expect(picture.textureFormat, `${mode} ${progress}`).toBe(progress === .5 ? 'rgba16float' : 'rgba8unorm')
      }
      expect(await device.popErrorScope()).toBeNull()
    } finally { await host.dispose() }
  })
  it('显影四种新增方式双侧连续切换、单侧透明，统一亮边和光晕参与真实 GPU 合成', async () => {
    const frames: Uint8Array[] = []
    for (const mode of ['noise_reveal', 'blocks_reveal', 'dots', 'halftone']) {
      const params = { mode, reveal_size: 90, reveal_softness: 0, reveal_seed: 12 }
      near(pixel(await run('dissolve', 0, params), 32, 18), RED)
      near(pixel(await run('dissolve', 1, params), 32, 18), BLUE)
      const before = await run('dissolve', .25, params), middle = await run('dissolve', .5, params), after = await run('dissolve', .75, params)
      const blue = (pixels: Uint8Array): number => pixels.reduce((sum, value, index) => sum + (index % 4 === 2 ? value : 0), 0)
      expect(blue(after), mode).toBeGreaterThan(blue(before))
      expect(middle.some((value, index) => index % 4 === 0 && value > 0), mode).toBe(true)
      expect(blue(middle), mode).toBeGreaterThan(0)
      const edgeParams = { ...params, reveal_edge_width: 60 }
      const edge = await run('dissolve', .5, edgeParams)
      expect(edge.some((value, index) => index % 4 === 1 && value > 0), `${mode} 亮边`).toBe(true)
      const glow = await run('dissolve', .5, { ...edgeParams, reveal_glow_strength: 70, reveal_glow_radius: 40 })
      expect(glow.some((value, index) => value > edge[index] + 3), `${mode} 光晕`).toBe(true)
      for (const side of ['in', 'out'] as const) {
        expect(pixel(await run('dissolve', side === 'in' ? 0 : 1, edgeParams, side), 32, 18)[3], `${mode} ${side} 空端`).toBe(0)
        near(pixel(await run('dissolve', side === 'in' ? 1 : 0, edgeParams, side), 32, 18), RED)
        const faded = await run('dissolve', .5, params, side)
        const alpha = faded.filter((_, index) => index % 4 === 3)
        expect(alpha.some(value => value > 0) && alpha.some(value => value < 255), `${mode} ${side} 中点`).toBe(true)
      }
      if (mode !== 'halftone') expect(await run('dissolve', .5, { ...params, reveal_seed: 13 }), `${mode} 种子`).not.toEqual(middle)
      frames.push(middle)
    }
    for (let index = 0; index < frames.length; index++) for (let other = 0; other < index; other++) expect(frames[index]).not.toEqual(frames[other])
  }, 60_000)
  it('合并后的每种方式与迁移前来源在真实 GPU 上逐像素相同，包含双侧与单侧', async () => {
    const outgoing = solid(RED); const incoming = solid(BLUE); const transparent = solid([0, 0, 0, 0])
    const gl = new VideoEditGlTransitionsGpu(device as unknown as GpuDevice, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }))
    try {
      for (const kind of VIDEO_EDIT_SOURCE_TRANSITION_KINDS) {
        if (isRemovedVideoEditTransition(kind)) continue
        const parameters = Object.fromEntries(VIDEO_EDIT_SOURCE_TRANSITION_PARAMS[kind].map(param => [param.key, param.default]))
        const old = { id: kind, kind, durationFrames: 100, parameters }
        const migrated = migrateVideoEditTransitionCollection({ transitions: [old] }) as { transitions: unknown[] }
        const transition = videoEditTransitionSchema.parse(migrated.transitions[0])
        const shader = isShaderGraphTransition(kind) ? await ShaderGraphSession.create(device as unknown as GpuDevice, shaderGraphTransitionSpec(kind)) : undefined
        const output = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture
        const draw = async (input: VideoEditBuiltinTransitionInput): Promise<Uint8Array> => {
          if (shader && isShaderGraphTransition(input.kind)) await shader.render({ timeSeconds: .5, width: W, height: H, input: input.emptyOutgoing ? transparent : outgoing, second: input.emptyIncoming ? transparent : incoming, output, outputFormat: 'rgba8unorm', props: new Map([['fx', shaderGraphTransitionProps(input.kind, input.params, input.progress)]]) })
          else if (isGlTransition(input.kind)) await gl.render({ ...input, kind: input.kind }, outgoing, incoming, output, { width: W, height: H, format: 'rgba8unorm' }, () => transparent)
          else await effects.renderTransition(input, outgoing, incoming, output, { width: W, height: H, format: 'rgba8unorm' })
          return read(output)
        }
        try {
          for (const side of [undefined, 'in', 'out'] as const) for (const frame of [0, 25, 50, 75, 99]) {
            const rendered = videoEditTransitionRender({ transition, start: 0, end: 100, side }, frame)
            if (rendered.kind !== 'builtin') throw new Error(kind)
            const expected = await draw({ kind, params: parameters, progress: frame / 100, ...(side === 'in' ? { emptyOutgoing: true } : side === 'out' ? { emptyIncoming: true } : {}) })
            expect(await draw(rendered.input), `${kind} ${side ?? '双侧'} ${frame}`).toEqual(expected)
          }
        } finally { output.destroy(); shader?.dispose() }
      }
    } finally { gl.dispose(); outgoing.destroy(); incoming.destroy(); transparent.destroy() }
  }, 240_000)
  it('转场内部帧贝塞尔参数进入真实 GPU；同进度不同参数产生不同画面（内置与 shaders）', async () => {
    const outgoing = solid(RED); const incoming = solid(BLUE)
    for (const kind of ['flash', 'shaders.LinearWipe'] as const) {
      const parameter = kind === 'flash' ? 'intensity' : 'angle'
      const range = kind === 'flash' ? 100 : 180
      const transition = { id: 'animated', kind, durationFrames: 11, frameCurves: { [parameter]: [{ time: 0, value: 0, interpolation: 'bezier' as const, bezier: [1 / 3, 0, 2 / 3, 0] as [number, number, number, number] }, { time: 10, value: range, interpolation: 'linear' as const }] } }
      const render = videoEditTransitionRender({ start: 100, end: 111, transition }, 105)
      if (render.kind !== 'builtin') throw new Error('需要参数转场输入。')
      expect(render.input.params[parameter]).toBeCloseTo(range / 8, 5)
      const output = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture
      const shader = isShaderGraphTransition(kind) ? await ShaderGraphSession.create(device as unknown as GpuDevice, shaderGraphTransitionSpec(kind)) : undefined
      const draw = async (input: VideoEditBuiltinTransitionInput): Promise<void> => {
        if (shader && isShaderGraphTransition(input.kind)) await shader.render({ timeSeconds: .5, width: W, height: H, input: outgoing, second: incoming, output, outputFormat: 'rgba8unorm', props: new Map([['fx', shaderGraphTransitionProps(input.kind, input.params, input.progress)]]) })
        else await effects.renderTransition(input, outgoing, incoming, output, { width: W, height: H, format: 'rgba8unorm' })
      }
      await draw(render.input)
      const animated = await read(output)
      await draw({ ...render.input, params: { ...render.input.params, [parameter]: range } })
      const constant = await read(output)
      expect(animated.some((value, index) => Math.abs(value - constant[index]) > 10), kind).toBe(true)
      output.destroy(); shader?.dispose()
    }
    outgoing.destroy(); incoming.destroy()
  })
  it('全部过渡在设备上编译；默认参数下进度 0 是前一段、进度 1 是后一段', async () => {
    for (const kind of VIDEO_EDIT_BUILTIN_TRANSITION_KINDS.filter(value => !isShaderGraphTransition(value) && !isGlTransition(value))) {
      for (const [x, y] of [[1, 1], [W / 2, H / 2], [W - 2, H - 2]]) {
        near(pixel(await run(kind, 0), x, y), RED); near(pixel(await run(kind, 1), x, y), BLUE)
      }
    }
  }, 60_000)
  it('中点：擦除按方向分两半、推动与滑动从指定侧进入、圆形划像中心先露出、闪光整屏变闪光色、模糊与缩放两段各半', async () => {
    const wipe = await run('wipe', 0.5, { feather: 0 })
    near(pixel(wipe, 4, 18), BLUE); near(pixel(wipe, W - 5, 18), RED)
    const down = await run('wipe', 0.5, { direction: 'from_top', feather: 0 })
    near(pixel(down, 32, 3), BLUE); near(pixel(down, 32, H - 4), RED)
    const bordered = await run('wipe', 0.5, { feather: 0, border: 100 })
    near(pixel(bordered, W / 2, 18), [255, 255, 255, 255], 30)
    for (const kind of ['push', 'slide'] as const) {
      const moved = await run(kind, 0.5, { direction: 'from_right', smooth: false })
      near(pixel(moved, 4, 18), RED); near(pixel(moved, W - 5, 18), BLUE)
    }
    const iris = await run('iris_round', 0.5, { feather: 0 })
    near(pixel(iris, W / 2, H / 2), BLUE); near(pixel(iris, 0, 0), RED)
    const closing = await run('iris_round', 0.5, { feather: 0, mode: 'close' })
    near(pixel(closing, W / 2, H / 2), RED); near(pixel(closing, 0, 0), BLUE)
    near(pixel(await run('flash', 0.5), W / 2, H / 2), [255, 255, 255, 255])
    near(pixel(await run('flash', 0.5, { color: BLACK_HEX, intensity: 100 }), W / 2, H / 2), [0, 0, 0, 255])
    near(pixel(await run('blur_dissolve', 0.5), W / 2, H / 2), [128, 0, 128, 255], 4)
    near(pixel(await run('cross_zoom', 0.5), W / 2, H / 2), [128, 0, 128, 255], 4)
  }, 60_000)
  it('单侧过渡空着的一侧是透明：入点从透明开始，出点结束于透明', async () => {
    for (const kind of VIDEO_EDIT_BUILTIN_TRANSITION_KINDS.filter(value => !isShaderGraphTransition(value) && !isGlTransition(value))) {
      expect(pixel(await run(kind, 0, {}, 'in'), W / 2, H / 2)[3], kind).toBe(0)
      near(pixel(await run(kind, 1, {}, 'in'), W / 2, H / 2), RED)
      near(pixel(await run(kind, 0, {}, 'out'), W / 2, H / 2), RED)
      expect(pixel(await run(kind, 1, {}, 'out'), W / 2, H / 2)[3], kind).toBe(0)
    }
  }, 60_000)
})
