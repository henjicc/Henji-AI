import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { init } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '../../../../core/imageEdit/worker/webgpuRuntimeSupport'
import { SHADER_COMPONENTS, type ShaderGraphSpec } from '../../../../core/videoEdit/shaderGraph/spec'
import { ShaderGraphError, ShaderGraphSession } from './shaderGraphSession'
import { ShaderGraphCache } from './shaderGraphCache'
import { initShaderGraphTestGpu } from './shaderGraphGpu.testing'
import { SHADER_GRAPH_EFFECT_DEFINITIONS, shaderGraphEffectProps, shaderGraphEffectSpec, videoEditShaderGraphWarmSpecs } from '../../../../core/videoEdit/shaderGraph/effects'
import { SHADER_GRAPH_TRANSITION_KINDS, shaderGraphTransitionProps, shaderGraphTransitionSpec } from '../../../../core/videoEdit/shaderGraph/transitions'
import { resolveVideoEditTransitionParams } from '../../../../core/videoEdit/transitionParams'
import { resolveVideoEditBuiltinParams, videoEditBuiltinDefaults } from '../../../../core/videoEdit/builtinEffects'
import { THEME_SEED_ACCENT_HEX } from '../../../../core/theme/colorTokens'

type Raw = { createTexture(d: unknown): GpuTexture & { width: number; height: number }; createBuffer(d: unknown): { mapAsync(m: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void }; createCommandEncoder(): { copyTextureToBuffer(a: unknown, b: unknown, c: unknown): void; finish(): unknown }; queue: { submit(c: unknown[]): void; writeTexture(a: unknown, b: ArrayBufferView, c: unknown, d: unknown): void } }
let gpu: Awaited<ReturnType<typeof init>>
let device: GpuDevice
let raw: Raw
const W = 96; const H = 54
beforeAll(async () => {
  gpu = await initShaderGraphTestGpu()
  device = gpu.gpu as unknown as GpuDevice; raw = gpu.gpu as unknown as Raw
})
afterAll(() => gpu?.dispose())

function texture(width = W, height = H): GpuTexture { return raw.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 }) }
function fill(target: GpuTexture, pixel: (x: number, y: number) => number[], width = W, height = H): void {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  raw.queue.writeTexture({ texture: target }, data, { bytesPerRow: width * 4 }, [width, height])
}
async function read(source: GpuTexture, width = W, height = H): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = raw.createBuffer({ size: bytesPerRow * height, usage: 1 | 8 })
  const encoder = raw.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: source }, { buffer, bytesPerRow }, [width, height])
  raw.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
  buffer.unmap(); buffer.destroy(); return pixels
}
const at = (pixels: Uint8Array, x: number, y: number): number[] => Array.from(pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))
async function frame(session: ShaderGraphSession, timeSeconds: number, input?: GpuTexture, second?: GpuTexture): Promise<Uint8Array> {
  const output = texture()
  await session.render({ timeSeconds, width: W, height: H, input, second, output, outputFormat: 'rgba8unorm' })
  const pixels = await read(output); output.destroy(); return pixels
}

describe('shader graph session', () => {
  it('renders a generator into a host texture and seeks deterministically', async () => {
    const session = await ShaderGraphSession.create(device, { layers: [{ type: 'Aurora' }] })
    const a = await frame(session, 1)
    await frame(session, 4)
    const back = await frame(session, 1)
    const fresh = await ShaderGraphSession.create(device, { layers: [{ type: 'Aurora' }] })
    const direct = await frame(fresh, 1)
    expect(a.filter(value => value > 0).length).toBeGreaterThan(W * H)
    expect(back).toEqual(a); expect(direct).toEqual(a)
    session.dispose(); fresh.dispose()
  })
  it('filters the host picture of the same frame, including compute-based blurs', async () => {
    const input = texture()
    fill(input, x => x < W / 2 ? [255, 255, 255, 255] : [255, 0, 0, 255])
    const session = await ShaderGraphSession.create(device, { layers: [{ type: '@input' }, { type: 'Blur', id: 'blur', props: { intensity: 40 } }] })
    const first = await frame(session, 0, input)
    expect(at(first, 2, 27)).toEqual([255, 255, 255, 255])
    expect(at(first, W / 2 - 2, 27)[1]).toBeLessThan(250) // edge is mixed
    fill(input, x => x < W / 2 ? [255, 0, 0, 255] : [255, 255, 255, 255])
    const swapped = await frame(session, 0, input)
    expect(at(swapped, 2, 27)).toEqual([255, 0, 0, 255])
    // per-frame props without rebuilding
    const none = await (async () => { await session.render({ timeSeconds: 0, width: W, height: H, input, output: texture(), outputFormat: 'rgba8unorm', props: new Map([['blur', { intensity: 0 }]]) }); return frame(session, 0, input) })()
    expect(at(none, W / 2 - 2, 27)).toEqual([255, 0, 0, 255])
    session.dispose(); input.destroy()
  })
  it('keeps straight colors and alpha of the host picture through the graph', async () => {
    const input = texture()
    fill(input, (x, y) => y < H / 2 ? [64, 32, 16, 128] : [0, 0, 0, 0])
    const session = await ShaderGraphSession.create(device, { layers: [{ type: '@input' }] })
    const pixels = await frame(session, 0, input)
    expect(at(pixels, 10, 5).map((value, index) => Math.abs(value - [64, 32, 16, 128][index]) <= 2)).toEqual([true, true, true, true])
    expect(at(pixels, 10, 40)).toEqual([0, 0, 0, 0])
    session.dispose(); input.destroy()
  })
  it('runs author WGSL filters and reports author line numbers', async () => {
    const input = texture()
    fill(input, x => x < W / 2 ? [255, 255, 255, 255] : [0, 0, 255, 255])
    const spec: ShaderGraphSpec = { layers: [{ type: '@input' }, { type: 'shift', props: { amount: 0.25 } }], shaders: [{ name: 'shift', kind: 'filter', props: { amount: { default: 0 } }, wgsl: 'let p = uv + vec2f(amount, 0.0);\nreturn textureSample(childTexture, childSampler, p);' }] }
    const session = await ShaderGraphSession.create(device, spec)
    const shifted = await frame(session, 0, input)
    // x = 30 reads x = 30 + 24 = 54 (blue half)
    expect(at(shifted, 30, 27)).toEqual([0, 0, 255, 255])
    session.dispose()
    const broken: ShaderGraphSpec = { layers: [{ type: 'oops' }], shaders: [{ name: 'oops', kind: 'generator', wgsl: 'let a = 1.0;\nreturn vec4f(nope, a, a, 1.0);' }] }
    const error = await ShaderGraphSession.create(device, broken).then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(ShaderGraphError)
    expect((error as ShaderGraphError).line).toBe(2)
    expect((error as ShaderGraphError).message).toContain('nope')
    input.destroy()
  })
  it('runs framework transitions between two host pictures', async () => {
    const a = texture(); const b = texture()
    fill(a, () => [255, 0, 0, 255]); fill(b, () => [0, 0, 255, 255])
    const session = await ShaderGraphSession.create(device, { layers: [{ type: '@second' }, { type: 'LinearWipe', id: 'wipe', props: { progress: 0.5, feather: 0 }, children: [{ type: '@input' }] }] })
    const pixels = await frame(session, 0, a, b)
    expect(at(pixels, 5, 27)).not.toEqual(at(pixels, W - 5, 27))
    expect([at(pixels, 5, 27), at(pixels, W - 5, 27)]).toContainEqual([255, 0, 0, 255])
    expect([at(pixels, 5, 27), at(pixels, W - 5, 27)]).toContainEqual([0, 0, 255, 255])
    session.dispose(); a.destroy(); b.destroy()
  })
})

describe('shader graph effects', () => {
  it('renders every effect definition with its default parameters through the shared cache', async () => {
    const cache = new ShaderGraphCache(device)
    const input = texture()
    fill(input, (x, y) => [x * 2 % 256, y * 4 % 256, 128, 255])
    const failures: string[] = []
    for (const definition of SHADER_GRAPH_EFFECT_DEFINITIONS) {
      const output = texture()
      try { await cache.render(shaderGraphEffectSpec(definition.id), { timeSeconds: 0.5, width: W, height: H, input, output, outputFormat: 'rgba8unorm', props: new Map([['fx', shaderGraphEffectProps(definition.id, videoEditBuiltinDefaults(definition))]]) }) }
      catch (error) { failures.push(`${definition.id}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`) }
      output.destroy()
    }
    cache.dispose(); input.destroy()
    expect(failures).toEqual([])
  }, 600_000)
  it('framework transitions show the outgoing picture at progress 0 and the incoming picture at progress 1', async () => {
    const cache = new ShaderGraphCache(device)
    const a = texture(); const b = texture()
    fill(a, () => [255, 0, 0, 255]); fill(b, () => [0, 0, 255, 255])
    const failures: string[] = []
    for (const kind of SHADER_GRAPH_TRANSITION_KINDS) {
      for (const [progress, expected] of [[0, [255, 0, 0, 255]], [1, [0, 0, 255, 255]]] as const) {
        const output = texture()
        await cache.render(shaderGraphTransitionSpec(kind), { timeSeconds: 0, width: W, height: H, input: a, second: b, output, outputFormat: 'rgba8unorm', props: new Map([['fx', shaderGraphTransitionProps(kind, resolveVideoEditTransitionParams(kind, {}), progress)]]) })
        const pixels = await read(output); output.destroy()
        const matching = [[W / 2, H / 2], [3, 3], [W - 4, H - 4]].filter(([x, y]) => at(pixels, x, y).every((value, index) => Math.abs(value - expected[index]) <= 3)).length
        if (matching < 2) failures.push(`${kind} @${progress}: ${JSON.stringify(at(pixels, W / 2, H / 2))}`)
      }
    }
    cache.dispose(); a.destroy(); b.destroy()
    expect(failures).toEqual([])
  }, 300_000)
  it('warms effect and transition graphs found in the edit so the first real frame does not compile', async () => {
    const cache = new ShaderGraphCache(device)
    const specs = videoEditShaderGraphWarmSpecs([{ clips: [{ effects: [{ builtin: { id: 'shaders.Posterize' } }, { builtin: { id: 'blur' } }, { builtin: { id: 'shaders.Posterize' } }] }], transitions: [{ kind: 'shaders.LinearWipe' }, { kind: 'wipe' }] }], kind => kind.startsWith('shaders.') ? shaderGraphTransitionSpec(kind as never) : undefined)
    expect(specs).toHaveLength(2)
    await cache.warm(specs)
    const input = texture(); const output = texture(); fill(input, () => [10, 20, 30, 255])
    const started = performance.now()
    await cache.render(specs[0], { timeSeconds: 0, width: W, height: H, input, output, outputFormat: 'rgba8unorm' })
    expect(performance.now() - started).toBeLessThan(250)
    cache.dispose(); input.destroy(); output.destroy()
  })
  it('同一组件不同编译期设置、不同混合模式的片段交替渲染：各用一个会话、建好后不再重建，每帧与新会话逐位一致', async () => {
    const cache = new ShaderGraphCache(device)
    const input = texture()
    // 胶片：换胶片是编译期属性，光晕跨过 0 换结构；极光：两种混合模式。
    const clips = [
      { id: 'film_look', params: { stock: 'vivid100' } },
      { id: 'film_look', params: { stock: 'mono400', halation: 0 } },
      { id: 'shaders.Aurora', params: { blend_mode: 'normal' } },
      { id: 'shaders.Aurora', params: { blend_mode: 'screen' } },
    ]
    const fxProps = (clip: typeof clips[number]): Record<string, unknown> => shaderGraphEffectProps(clip.id, resolveVideoEditBuiltinParams({ id: clip.id, params: clip.params }))
    const render = async (target: { render(request: Parameters<ShaderGraphSession['render']>[0]): Promise<void> }, clip: typeof clips[number]): Promise<Uint8Array> => {
      const output = texture()
      await target.render({ timeSeconds: 0.5, width: W, height: H, input, output, outputFormat: 'rgba8unorm', props: new Map([['fx', fxProps(clip)]]) })
      const pixels = await read(output); output.destroy(); return pixels
    }
    const create = ShaderGraphSession.create.bind(ShaderGraphSession)
    const created: ShaderGraphSession[] = []
    const spy = vi.spyOn(ShaderGraphSession, 'create').mockImplementation(async (d, spec) => { const session = await create(d, spec); created.push(session); return session })
    try {
      for (let frame = 0; frame < 3; frame++) for (const clip of clips) {
        // 每帧换一张输入：会话若用到别的设置留下的合成或上一帧的画面，都能比出来。
        fill(input, (x, y) => [(x * 3 + frame * 50) % 256, (y * 5 + frame * 90) % 256, 128, 255])
        const spec = shaderGraphEffectSpec(clip.id)
        const fresh = await create(device, { ...spec, layers: spec.layers.map(layer => layer.id === 'fx' ? { ...layer, props: fxProps(clip) } : layer) })
        const expected = await render(fresh, clip)
        fresh.dispose()
        expect(await render({ render: request => cache.render(spec, request) }, clip), `${clip.id} ${JSON.stringify(clip.params)} @${frame}`).toEqual(expected)
      }
      expect(created).toHaveLength(clips.length)
      expect(created.map(session => session.hostBuilds)).toEqual(clips.map(() => 1))
    } finally { spy.mockRestore(); cache.dispose(); input.destroy() }
  }, 180_000)
  it('时钟快慢不同的同种组件片段交替播放：跳到某一帧与顺序播放到这一帧逐位一致', async () => {
    const input = texture()
    fill(input, (x, y) => [x * 2 % 256, y * 4 % 256, 128, 255])
    // 影棚背景按环境光速度另行累加漂移；极光代表按 speedProp 推进动画时间的组件。各段的片段内时间也错开。
    const clips = [
      { id: 'shaders.StudioBackground', params: { ambient_speed: 2 }, offset: 0 },
      { id: 'shaders.StudioBackground', params: { ambient_speed: 5 }, offset: 0.25 },
      { id: 'shaders.Aurora', params: { speed: 1 }, offset: 0.5 },
      { id: 'shaders.Aurora', params: { speed: 3 }, offset: 0.75 },
    ]
    const render = async (cache: ShaderGraphCache, clip: typeof clips[number], timeSeconds: number): Promise<Uint8Array> => {
      const output = texture()
      await cache.render(shaderGraphEffectSpec(clip.id), { timeSeconds, width: W, height: H, input, output, outputFormat: 'rgba8unorm', props: new Map([['fx', shaderGraphEffectProps(clip.id, resolveVideoEditBuiltinParams({ id: clip.id, params: clip.params }))]]) })
      const pixels = await read(output); output.destroy(); return pixels
    }
    const sequential = new ShaderGraphCache(device), played: Uint8Array[] = []
    for (let frame = 0; frame <= 30; frame++) for (const [index, clip] of clips.entries()) played[index] = await render(sequential, clip, clip.offset + frame / 30)
    sequential.dispose()
    for (const [index, clip] of clips.entries()) {
      const jump = new ShaderGraphCache(device)
      expect(await render(jump, clip, clip.offset + 1), `${clip.id} ${JSON.stringify(clip.params)}`).toEqual(played[index])
      jump.dispose()
    }
    input.destroy()
  }, 180_000)
  it('maps percent positions and blend modes onto component props', () => {
    expect(shaderGraphEffectProps('shaders.Vignette', { center_x: 25, center_y: 75 })).toMatchObject({ center: { x: 0.25, y: 0.75 } })
    expect(shaderGraphEffectProps('shaders.Aurora', { blend_mode: 'screen', color_a: THEME_SEED_ACCENT_HEX.violet })).toMatchObject({ blendMode: 'screen', colorA: THEME_SEED_ACCENT_HEX.violet })
  })
})

// 全目录扫描：每个组件独立会话直接渲染 t=1.25，与先到 t=3 再回到 1.25 的结果逐字节比较。
// 不一致的组件依赖上一帧状态，登记进 scripts/shader-component-exclusions.cjs（history）。
describe.runIf(process.env.HENJI_SHADER_SWEEP === '1')('shader component sweep', () => {
  it('every component renders and seeks deterministically', async () => {
    const input = texture()
    fill(input, (x, y) => [x * 2 % 256, y * 4 % 256, 128, 255])
    const failures: string[] = []
    for (const component of SHADER_COMPONENTS) {
      if (component.role === 'group') continue
      const layers = component.role === 'generator' ? [{ type: component.name }] : component.role === 'transition' ? [{ type: '@second' }, { type: component.name, children: [{ type: '@input' }] }] : [{ type: '@input' }, { type: component.name }]
      try {
        const one = await ShaderGraphSession.create(device, { layers })
        const direct = await frame(one, 1.25, input, input)
        await frame(one, 3, input, input)
        const back = await frame(one, 1.25, input, input)
        one.dispose()
        const fresh = await ShaderGraphSession.create(device, { layers })
        await frame(fresh, 0.5, input, input)
        const stepped = await frame(fresh, 1.25, input, input)
        fresh.dispose()
        const same = (x: Uint8Array, y: Uint8Array) => x.every((value, index) => Math.abs(value - y[index]) <= 1)
        if (!same(direct, back) || !same(direct, stepped)) failures.push(`${component.name}: history`)
      } catch (error) { failures.push(`${component.name}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`) }
    }
    expect(failures, `扫描 ${SHADER_COMPONENTS.length} 个组件`).toEqual([])
  }, 900_000)
})
