import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLACK_HEX, WHITE_HEX, VIDEO_EDIT_GLOW_TEST_COLORS } from '@/core/theme/colorTokens'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { authorEffectBleed, resolveAuthorEffects, type AuthorEffectEnvironment } from '@/core/videoEdit/authorEffects'
import { videoEditEffectPresetSchema } from '@/core/videoEdit/effectPresets'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { VideoEditBuiltinEffectsGpu, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import { VideoEditAuthorEffects } from './videoEditAuthorEffects'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { videoEditHalfToFloat } from './videoEditGpuShaders'
import { planStroke, strokeJumpSteps } from './stroke'
import { planVideoEditBuiltinEffect, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { blurAmountForSigma } from '@/core/videoEdit/blur'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { ditherPattern, halftone } from '../authorLibraries/effects.generated'
import { ditherPixelSize } from '@/core/videoEdit/ditherPattern'
import { bulge, cornerPin, displace, mirror, repeat, twirl, wave } from '@/features/videoEdit/authorLibraries/effects'

// 投影、描边、扫光、溶解显影与发光“轮廓”的真实设备用例：正式 WGSL 与工序在 Dawn 上执行，按像素核对。
const TEXTURE_COPY_SRC = 0x01; const TEXTURE_COPY_DST = 0x02; const TEXTURE_BINDING = 0x04; const RENDER_ATTACHMENT = 0x10
const BUFFER_MAP_READ = 0x01; const BUFFER_COPY_DST = 0x08
const W = 96; const H = 64
let gpu: Gpu
let device: Gpu['gpu']
let effects: VideoEditBuiltinEffectsGpu
const allocator = (): VideoEditBuiltinScratchAllocator => ({
  allocate: (width, height, format, mipLevelCount = 1) => device.createTexture({ size: [width, height], format: format as 'rgba8unorm', mipLevelCount, usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_DST | TEXTURE_COPY_SRC }) as unknown as GpuTexture,
  release: texture => texture.destroy(),
})
beforeAll(async () => {
  gpu = await init(); device = gpu.gpu
  effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), allocator())
})
afterAll(() => { effects?.dispose(); gpu?.dispose() })

function texture(data: Uint8Array, width = W, height = H): GpuTexture {
  const result = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_COPY_SRC })
  device.queue.writeTexture({ texture: result }, data, { bytesPerRow: width * 4 }, [width, height])
  return result as unknown as GpuTexture
}
function target(width = W, height = H): GpuTexture { return device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_BINDING | RENDER_ATTACHMENT | TEXTURE_COPY_SRC }) as unknown as GpuTexture }
async function read(source: GpuTexture, width = W, height = H): Promise<Uint8Array> {
  const precise = source.format === 'rgba16float', bpp = precise ? 8 : 4
  const bytesPerRow = Math.ceil(width * bpp / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: source as never }, { buffer, bytesPerRow }, { width, height, depthOrArrayLayers: 1 })
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
const at = (pixels: Uint8Array, x: number, y: number, width = W): number[] => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
function hash(pixels: Uint8Array): string { let h = 2166136261; for (const value of pixels) { h ^= value; h = Math.imul(h, 16777619) >>> 0 } return h.toString(16) }

/** 透明底：白色粗字块、红色细横条、一个半透明圆点。 */
function titleData(): Uint8Array {
  const data = new Uint8Array(W * H * 4)
  for (let y = 20; y < 40; y++) for (let x = 20; x < 44; x++) data.set([255, 255, 255, 255], (y * W + x) * 4)
  for (let y = 44; y < 46; y++) for (let x = 50; x < 86; x++) data.set([255, 40, 40, 255], (y * W + x) * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 70) ** 2 + (y - 24) ** 2 < 36) data.set([64, 64, 128, 128], (y * W + x) * 4)
  return data
}
/** 不透明夜景：深底上几个亮点与一条亮带。 */
function nightData(): Uint8Array {
  const data = new Uint8Array(W * H * 4)
  for (let at = 0; at < W * H; at++) data.set([12, 14, 22, 255], at * 4)
  for (const [cx, cy] of [[20, 16], [60, 30], [80, 50]]) for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) data.set([255, 230, 180, 255], (y * W + x) * 4)
  for (let x = 0; x < W; x++) data.set([200, 220, 255, 255], (56 * W + x) * 4)
  return data
}
const reference = (quality: 'interactive' | 'final' = 'final'): LayerEffectReference => ({ referenceSize: { width: W, height: H }, contentBounds: { x: 0, y: 0, width: W, height: H }, rasterScale: 1, rasterOrigin: [0, 0], quality })
async function clip(source: Uint8Array, id: string, params: Record<string, unknown>): Promise<Uint8Array> {
  const input = texture(source), output = target()
  try {
    await effects.render({ id, params: params as Record<string, number> }, { texture: input, width: W, height: H, format: 'rgba8unorm' }, output, 0, 1, [], 'final')
    return await read(output)
  } finally { input.destroy(); output.destroy() }
}
/** 图层模式：正式图层效果链编码，结果是层内叠好下层的预乘画面与 carriesLight。 */
async function layer(source: Uint8Array, chainEffects: unknown[], defocus = { radius: 0, lens: false }, options: { width?: number; height?: number; reference?: LayerEffectReference; amount?: number; environment?: AuthorEffectEnvironment } = {}): Promise<{ pixels: Uint8Array; carriesLight: boolean }> {
  const width = options.width ?? W, height = options.height ?? H
  const d = device as unknown as GpuDevice
  const author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator())
  const input = texture(source, width, height), frame = target(width, height)
  try {
    await author.begin(frame); chain.begin(author.commandEncoder())
    const resolved = resolveAuthorEffects(chainEffects, options.environment).map(effect => ({ ...effect, amount: options.amount ?? effect.amount }))
    const result = await chain.encode('layer', input, width, height, resolved, options.reference ?? reference(), {}, undefined, defocus, value => author.mipmaps(value, width, height), 0)
    author.finish(); chain.commit()
    return { pixels: await read(result.picture, width, height), carriesLight: result.carriesLight }
  } finally { chain.dispose(); await author.dispose(); input.destroy(); frame.destroy() }
}
/** 局部图层参考：参考画面 1920×1080，未外扩内容框放在 (pad, pad)。 */
const local = (contentWidth: number, contentHeight: number, pad: number): LayerEffectReference => ({ referenceSize: { width: 1920, height: 1080 }, contentBounds: { x: 0, y: 0, width: contentWidth, height: contentHeight }, rasterScale: 1, rasterOrigin: [pad, pad], quality: 'final' })
function canvas(width: number, height: number, paint: (x: number, y: number) => readonly number[] | undefined): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const value = paint(x, y); if (value) data.set(value, (y * width + x) * 4) }
  return data
}
/** 预乘画面按普通 over 叠到不透明底色上（与片段合成器一致）。 */
const over = (pixels: Uint8Array, background: readonly number[]): number[] => [...pixels].map((value, index) => index % 4 === 3 ? 255 : Math.min(255, value + background[index % 4] * (1 - pixels[index - index % 4 + 3] / 255)))

describe('发光拆分', () => {
  // 发光在图层上拆成“金字塔 + 合成”两段：亮部方式由图层带出光，留给合成叠加；只看发光来源时不带光，片段与图层输出逐位相同。
  // 不钉像素哈希：各设备的模糊取整不同，哈希只对录下它的那块显卡成立。
  const cases: Array<[string, () => Uint8Array, Record<string, unknown>]> = [
    ['透明底文字·阈值 0', titleData, { threshold: 0, strength: 55, radius: 40 }],
    ['夜景·默认', nightData, {}],
    ['透明底文字·色差', titleData, { threshold: 0, aberration_amount: 60, aberration_mode: 'directional', aberration_angle: 30 }],
    ['透明底文字·着色', titleData, { threshold: 0, tint: 100, tint_inner: VIDEO_EDIT_GLOW_TEST_COLORS.inner, tint_outer: VIDEO_EDIT_GLOW_TEST_COLORS.outer, aspect: 40, blend: 'screen' }],
    ['夜景·发光来源', nightData, { view: 'source' }],
  ]
  it.each(cases)('%s', async (_, data, params) => {
    const clipped = await clip(data(), 'glow', params)
    const layered = await layer(data(), [{ id: 'glow', params }])
    expect(layered.carriesLight).toBe(params.view !== 'source')
    if (!layered.carriesLight) expect(hash(layered.pixels)).toBe(hash(clipped))
  })
})

describe('投影', () => {
  const square = (): Uint8Array => canvas(W, H, (x, y) => x >= 20 && x < 36 && y >= 20 && y < 36 ? [255, 255, 255, 255] : undefined)
  // 片段上 H = 纹理高 64；距离 250 → 偏移 250 × 0.0005 × 64 = 8 像素。
  const hard = { opacity: 100, softness: 0, distance: 250, direction: 0, source_opacity: 0 }
  it('偏移准确、只剩影子时片段与图层相同；黑影叠到底色上只变暗', async () => {
    const shadow = await clip(square(), 'drop_shadow', hard)
    expect(at(shadow, 30, 28)[3]).toBe(255); expect(at(shadow, 42, 28)[3]).toBe(255)
    expect(at(shadow, 26, 28)[3]).toBe(0); expect(at(shadow, 45, 28)[3]).toBe(0)
    const layered = await layer(square(), [{ id: 'drop_shadow', params: hard }])
    expect(layered.carriesLight).toBe(false)
    expect(Math.max(...layered.pixels.map((value, index) => Math.abs(value - shadow[index])))).toBeLessThanOrEqual(1)
    const gray = [128, 128, 128, 255]
    const composed = over(await clip(square(), 'drop_shadow', {}), gray)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!(x >= 20 && x < 36 && y >= 20 && y < 36)) for (let c = 0; c < 3; c++) expect(composed[(y * W + x) * 4 + c]).toBeLessThanOrEqual(128)
    expect(Math.min(...composed.filter((_, index) => index % 4 === 0))).toBeLessThan(128)
  })
  it('偏移取样越过纹理边当作透明，不把边缘像素拉成长影', async () => {
    const column = canvas(W, H, x => x < 10 ? [255, 255, 255, 255] : undefined)
    const shadow = await clip(column, 'drop_shadow', hard)
    expect(at(shadow, 3, 30)[3]).toBe(0)
    expect(at(shadow, 12, 30)[3]).toBe(255)
  })
  it('柔和度跨过高斯的 0.3 像素下限两侧连续', async () => {
    const lower = await clip(square(), 'drop_shadow', { ...hard, softness: blurAmountForSigma(0.2999 / H) })
    const upper = await clip(square(), 'drop_shadow', { ...hard, softness: blurAmountForSigma(0.3001 / H) })
    expect(Math.max(...lower.map((value, index) => Math.abs(value - upper[index])))).toBeLessThanOrEqual(2)
  })
})

describe('发光·轮廓', () => {
  const dark = (): Uint8Array => canvas(W, H, (x, y) => x >= 30 && x < 60 && y >= 24 && y < 40 ? [20, 20, 24, 255] : undefined)
  const params = { mode: 'shape', strength: 60, radius: 40, tint_inner: VIDEO_EDIT_GLOW_TEST_COLORS.inner, tint_outer: VIDEO_EDIT_GLOW_TEST_COLORS.inner }
  it('透明底深色字也发出着色组颜色的光；图层上光只提亮下方画面', async () => {
    const lit = await clip(dark(), 'glow', params)
    const halo = at(lit, 63, 32)
    expect(halo[0]).toBeGreaterThan(halo[2]); expect(halo[0]).toBeGreaterThan(8)
    expect(at(lit, 45, 32)).toEqual([20, 20, 24, 255])
    const layered = await layer(dark(), [{ id: 'glow', params }])
    expect(layered.carriesLight).toBe(true)
    const background = [40, 60, 90, 255]
    const composed = over(layered.pixels, background)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!(x >= 30 && x < 60 && y >= 24 && y < 40)) for (let c = 0; c < 3; c++) expect(composed[(y * W + x) * 4 + c]).toBeGreaterThanOrEqual(background[c])
  })
  it('原画不透明度 0 时片段与图层露出同样的光，相加与滤色都一样', async () => {
    for (const blend of ['add', 'screen']) {
      const clipped = await clip(dark(), 'glow', { ...params, blend, source_opacity: 0 })
      const layered = (await layer(dark(), [{ id: 'glow', params: { ...params, blend, source_opacity: 0 } }])).pixels
      for (let index = 0; index < clipped.length; index++) if (index % 4 !== 3) expect(Math.abs(clipped[index] - layered[index])).toBeLessThanOrEqual(1)
    }
    const add = await clip(dark(), 'glow', { ...params, source_opacity: 0, strength: 90 })
    const screen = await clip(dark(), 'glow', { ...params, source_opacity: 0, strength: 90, blend: 'screen' })
    expect(hash(add)).not.toBe(hash(screen))
  })
})

describe('描边', () => {
  const SW = 128, SH = 96
  // 参考高度 1080：粗细换算到恰好 6 像素宽。
  const widthFor = (pixels: number): number => Math.log1p(pixels / 1080 / 0.0006) / 4.2 * 100
  const run = async (data: Uint8Array, params: Record<string, unknown>): Promise<Uint8Array> => (await layer(data, [{ id: 'stroke', params }], undefined, { width: SW, height: SH, reference: local(SW, SH, 0) })).pixels
  const box = (alpha = 255): Uint8Array => canvas(SW, SH, (x, y) => x >= 32 && x < 96 && y >= 24 && y < 72 ? [alpha, alpha, alpha, alpha] : undefined)
  it('外侧描边的覆盖按到轮廓的距离给出，外扩之外不变', async () => {
    const pixels = await run(box(), { width: widthFor(6), color: BLACK_HEX })
    for (let x = 96; x < 104; x++) {
      const distance = x + 0.5 - 96
      expect(Math.abs(at(pixels, x, 48, SW)[3] - Math.min(1, Math.max(0, 6 - distance + 0.5)) * 255)).toBeLessThanOrEqual(3)
    }
    expect(at(pixels, 110, 48, SW)[3]).toBe(0)
    expect(at(pixels, 60, 48, SW)).toEqual([255, 255, 255, 255])
  })
  it('半透明平台上 E ≤ a ≤ D：内侧描边不改 alpha、输出非负且预乘成立', async () => {
    const input = box(153)
    const pixels = await run(input, { width: widthFor(6), color: BLACK_HEX, position: 'inside' })
    for (let index = 0; index < pixels.length; index += 4) {
      expect(Math.abs(pixels[index + 3] - input[index + 3])).toBeLessThanOrEqual(1)
      for (let c = 0; c < 3; c++) expect(pixels[index + c]).toBeLessThanOrEqual(pixels[index + 3])
    }
    expect(at(pixels, 64, 48, SW)[0]).toBeGreaterThan(140)
    expect(at(pixels, 33, 48, SW)[0]).toBeLessThan(20)
  })
  it('空心字：原画不透明度 0 只剩描边；居中描边跨在轮廓两侧', async () => {
    const hollow = await run(box(), { width: widthFor(6), color: WHITE_HEX, source_opacity: 0, position: 'center' })
    expect(at(hollow, 64, 48, SW)[3]).toBe(0)
    expect(at(hollow, 95, 48, SW)[3]).toBe(255); expect(at(hollow, 97, 48, SW)[3]).toBe(255)
  })
})

describe('描边两条路径', () => {
  const SIZE = 256
  // 片段上 H = 纹理高 256；按需要的像素宽反推粗细。
  const widthFor = (pixels: number): number => Math.log1p(pixels / SIZE / 0.0006) / 4.2 * 100
  const shapes = (): Uint8Array => canvas(SIZE, SIZE, (x, y) => {
    if (Math.hypot(x - 70, y - 70) < 40) return [255, 255, 255, 255]
    if (x >= 140 && x < 220 && y >= 40 && y < 110) return [255, 255, 255, 255]
    const edge = Math.min(1, Math.max(0, 0.5 - ((x - 120) * 0.8 - (y - 180) * 0.6)))
    return x > 60 && x < 230 && y > 140 && y < 240 && edge > 0 ? [255, 255, 255, 255].map(v => Math.round(v * edge)) : undefined
  })
  async function render(width: number, field?: number, data = shapes(), position = 'outside'): Promise<Uint8Array> {
    const plan = planStroke({ width: widthFor(width), softness: 0, position, color: BLACK_HEX, opacity: 100, source_opacity: 100 }, SIZE, SIZE)
    if (field !== undefined) {
      // 强制路径：邻域取样的规划也改成“种子 + JFA + 着色”，着色里按 field 选距离场（1）或邻域取样（0）。
      const shade = plan.passes.find(pass => pass.entry === 'stroke_shade' || pass.entry === 'stroke_near')!
      const uniforms = shade.uniforms.slice(); uniforms[13] = field
      const steps = strokeJumpSteps(uniforms[6])
      const step = (value: number): Float32Array => Float32Array.from([SIZE, SIZE, SIZE, SIZE, value, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      plan.scratchFormat = 'rg32float'; plan.scratch = [{ width: SIZE, height: SIZE }, { width: SIZE, height: SIZE }]
      plan.passes = [{ entry: 'stroke_seed', source: 'input', target: 0, uniforms: step(0) }, ...steps.map((value, index) => ({ entry: 'stroke_jfa' as const, source: index % 2, target: 1 - index % 2, uniforms: step(value) })),
        { entry: 'stroke_shade', source: steps.length % 2, target: 'output', original: 'input', uniforms }]
    }
    const input = texture(data, SIZE, SIZE), output = target(SIZE, SIZE)
    try { await effects.encodePlan(plan, 'rgba8unorm', input, output); return await read(output, SIZE, SIZE) } finally { input.destroy(); output.destroy() }
  }
  // 两路对抗锯齿斜边的插值不同（距离场沿横竖相邻像素插值、邻域取样沿圆盘双线性取样），实测斜边上最多差约 0.25 像素（60/255），
  // 其余像素几乎一致（平均不到 0.1/255）。
  it('同一粗细强制两条路径：覆盖差最大 64/255、平均 1/255 以内', async () => {
    // 只比邻域取样真正会用到的粗细（覆盖距离 4 像素以内）。
    for (const width of [1, 1.6, 2.4]) {
      const near = await render(width, 0), field = await render(width, 1)
      let worst = 0, total = 0
      for (let index = 3; index < near.length; index += 4) { const d = Math.abs(near[index] - field[index]); worst = Math.max(worst, d); total += d }
      expect(worst).toBeLessThanOrEqual(64); expect(total / (near.length / 4)).toBeLessThanOrEqual(1)
    }
  })
  it('整幅不透明画面的四边：两条路径都把画幅外当透明，内侧画框一致', async () => {
    const opaque = canvas(SIZE, SIZE, () => [255, 255, 255, 255])
    const near = await render(1.6, 0, opaque, 'inside'), field = await render(1.6, 1, opaque, 'inside')
    let worst = 0
    for (let index = 0; index < near.length; index++) worst = Math.max(worst, Math.abs(near[index] - field[index]))
    expect(worst).toBeLessThanOrEqual(8)
    // 画框真的画在四边上（白底上黑边），中间不受影响。
    expect(at(near, 0, 128, SIZE)[0]).toBeLessThan(40); expect(at(near, 128, 128, SIZE)).toEqual([255, 255, 255, 255])
  })
  it('粗细以 0.05 像素步长穿过 3–4 像素的过渡区，相邻两步的变化有界', async () => {
    let previous = await render(1.2), worst = 0
    for (let width = 1.25; width <= 3.2; width += 0.05) {
      const current = await render(width)
      for (let index = 3; index < current.length; index += 4) worst = Math.max(worst, Math.abs(current[index] - previous[index]))
      previous = current
    }
    // 直边上覆盖随边宽线性变化，0.05 像素约 13/255；过渡区两端在尖角像素上另有约 7/255 的两路差（邻域取样 16 个方向漏掉尖角）。
    expect(worst).toBeLessThanOrEqual(21)
  }, 60_000)
})

describe('描边距离场精度（Jump Flood 对照暴力最近距离）', () => {
  /** 与 stroke_seed 同一定义的边交点。 */
  function seeds(alpha: Float32Array, width: number, height: number): Float32Array {
    const out = new Float32Array(width * height * 2).fill(-1e9)
    const value = (x: number, y: number): number => x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[y * width + x]
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = value(x, y), inside = a >= 0.5
      let nearest = 2
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = value(x + dx, y + dy)
        if ((b >= 0.5) === inside) continue
        const t = (0.5 - a) / (b - a)
        if (t < nearest) { nearest = t; out[(y * width + x) * 2] = x + 0.5 + dx * t; out[(y * width + x) * 2 + 1] = y + 0.5 + dy * t }
      }
    }
    return out
  }
  async function compare(width: number, height: number, paint: (x: number, y: number) => number, reach: number): Promise<{ within: number; worst: number }> {
    const alpha = new Float32Array(width * height)
    const data = canvas(width, height, (x, y) => { const a = paint(x, y); alpha[y * width + x] = Math.round(a * 255) / 255; return a > 0 ? [255, 255, 255, Math.round(a * 255)].map(v => Math.round(v * a)) as number[] : undefined })
    for (let index = 0; index < alpha.length; index++) alpha[index] = data[index * 4 + 3] / 255
    // 只跑种子与 JFA，最后一道写到 rg32float 输出，读回每个像素找到的种子。
    const steps = strokeJumpSteps(reach)
    const uniforms = (step: number): Float32Array => Float32Array.from([width, height, width, height, step, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const plan: VideoEditBuiltinPlan = { width, height, scratch: [{ width, height }, { width, height }], scratchFormat: 'rg32float', passes: [
      { entry: 'stroke_seed', source: 'input', target: 0, uniforms: uniforms(0) },
      ...steps.map((step, index) => ({ entry: 'stroke_jfa' as const, source: index % 2, target: index === steps.length - 1 ? 'output' as const : 1 - index % 2, uniforms: uniforms(step) })),
    ] }
    const input = texture(data, width, height)
    const output = device.createTexture({ size: [width, height], format: 'rg32float', usage: RENDER_ATTACHMENT | TEXTURE_COPY_SRC | TEXTURE_BINDING }) as unknown as GpuTexture
    const bytesPerRow = Math.ceil(width * 8 / 256) * 256
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
    try {
      device.pushErrorScope('validation')
      await effects.encodePlan(plan, 'rg32float', input, output)
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture: output as never }, { buffer, bytesPerRow }, { width, height, depthOrArrayLayers: 1 })
      device.queue.submit([encoder.finish()]); await buffer.mapAsync(BUFFER_MAP_READ)
      expect(await device.popErrorScope()).toBeNull()
      const mapped = new Float32Array(buffer.getMappedRange().slice(0))
      const exact = seeds(alpha, width, height)
      const list: number[] = []
      for (let index = 0; index < width * height; index++) if (exact[index * 2] > -1e8) list.push(exact[index * 2], exact[index * 2 + 1])
      const cell = 16, buckets = new Map<number, number[]>()
      for (let index = 0; index < list.length; index += 2) { const key = Math.floor(list[index + 1] / cell) * 4096 + Math.floor(list[index] / cell); (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(list[index], list[index + 1]) }
      let total = 0, good = 0, worst = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const cx = x + 0.5, cy = y + 0.5
        let best = Infinity
        for (let by = Math.floor((cy - reach) / cell); by <= Math.floor((cy + reach) / cell); by++) for (let bx = Math.floor((cx - reach) / cell); bx <= Math.floor((cx + reach) / cell); bx++) {
          const bucket = buckets.get(by * 4096 + bx); if (!bucket) continue
          for (let index = 0; index < bucket.length; index += 2) best = Math.min(best, Math.hypot(bucket[index] - cx, bucket[index + 1] - cy))
        }
        if (best > reach) continue
        const row = y * bytesPerRow / 4 + x * 2, sx = mapped[row], sy = mapped[row + 1]
        const found = sx > -1e8 ? Math.hypot(sx - cx, sy - cy) : Infinity
        const error = Math.abs(found - best)
        total++; if (error <= 0.05) good++; worst = Math.max(worst, error)
      }
      buffer.unmap()
      return { within: good / total, worst }
    } finally { input.destroy(); output.destroy(); buffer.destroy() }
  }
  it('奇数尺寸、带孔字形、相距 2 像素的两个轮廓', async () => {
    const result = await compare(1023, 517, (x, y) => {
      const ring = Math.hypot(x - 300, y - 250); if (ring < 120 && ring > 60) return 1
      if (x >= 600 && x < 700 && y >= 100 && y < 400) return 1
      if (x >= 702 && x < 760 && y >= 100 && y < 400) return 1
      // 抗锯齿斜边
      const edge = (x - 850) * 0.8 - (y - 250) * 0.6; return Math.min(1, Math.max(0, 0.5 - edge)) * (x > 820 && x < 990 && y > 60 && y < 460 ? 1 : 0)
    }, 12)
    expect(result.within).toBeGreaterThanOrEqual(0.999); expect(result.worst).toBeLessThanOrEqual(1)
  }, 120_000)
  it('大坐标（4096 宽纹理的远端）', async () => {
    const result = await compare(4096, 48, (x, y) => x >= 4000 && x < 4080 && y >= 8 && y < 40 ? 1 : 0, 10)
    expect(result.within).toBeGreaterThanOrEqual(0.999); expect(result.worst).toBeLessThanOrEqual(1)
  }, 120_000)
})

describe('扫光与溶解显影', () => {
  it('扫光：首尾与原画逐位相同；不开发光时透明处不变', async () => {
    for (const progress of [0, 100]) expect(hash(await clip(titleData(), 'light_sweep', { progress }))).toBe(hash(titleData()))
    const swept = await clip(titleData(), 'light_sweep', { glow_strength: 0, progress: 40 })
    const source = titleData()
    for (let index = 0; index < source.length; index += 4) if (source[index + 3] === 0) expect(swept[index + 3]).toBe(0)
    expect((await layer(titleData(), [{ id: 'light_sweep', params: {} }])).carriesLight).toBe(true)
  })
  it('溶解：进度 100 与原画逐位相同，进度 0 全透明无光；柔和度 0 的对齐网格结果确定', async () => {
    expect(hash(await clip(titleData(), 'dissolve_reveal', { progress: 100, edge_width: 40 }))).toBe(hash(titleData()))
    const hidden = await layer(titleData(), [{ id: 'dissolve_reveal', params: { progress: 0, edge_width: 40 } }])
    expect(hidden.carriesLight).toBe(false); expect(hidden.pixels.every(value => value === 0)).toBe(true)
    const dots = { mode: 'dots', softness: 0, progress: 50 }
    expect(hash(await clip(titleData(), 'dissolve_reveal', dots))).toBe(hash(await clip(titleData(), 'dissolve_reveal', dots)))
    const edge = await layer(titleData(), [{ id: 'dissolve_reveal', params: { progress: 50, edge_width: 40 } }])
    expect(edge.carriesLight).toBe(true)
  })
  it('换随机种子换一种排法（噪声与点阵）', async () => {
    for (const mode of ['noise', 'dots']) {
      const first = await clip(titleData(), 'dissolve_reveal', { mode, seed: 0, size: 40 })
      const second = await clip(titleData(), 'dissolve_reveal', { mode, seed: 7, size: 40 })
      const third = await clip(titleData(), 'dissolve_reveal', { mode, seed: 1234, size: 40 })
      expect(hash(first)).not.toBe(hash(second)); expect(hash(second)).not.toBe(hash(third))
    }
  })
  it('蓝噪声平铺接缝与内部一样连续', async () => {
    // 参考高度 1080、大小 0：格子 2.16 像素，64 格一铺约 138 像素，300 像素宽里有两条接缝。
    const width = 300, height = 40
    const solid = canvas(width, height, () => [255, 255, 255, 255])
    const pixels = (await layer(solid, [{ id: 'dissolve_reveal', params: { size: 0, softness: 100, progress: 50 } }], undefined, { width, height, reference: local(width, height, 0) })).pixels
    const cell = 0.002 * 1080, seams = new Set([Math.floor(64 * cell), Math.floor(128 * cell)])
    let seam = 0, inner = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width - 1; x++) {
      const step = Math.abs(at(pixels, x + 1, y, width)[3] - at(pixels, x, y, width)[3])
      if (seams.has(x) || seams.has(x + 1)) seam = Math.max(seam, step); else inner = Math.max(inner, step)
    }
    expect(seam).toBeLessThanOrEqual(inner)
  })
})

describe('混合链与资源', () => {
  const shadow = { id: 'drop_shadow', params: { distance: 60 } }
  const glowBright = { id: 'glow', params: { threshold: 0, strength: 50, radius: 30 } }
  const glowShape = { id: 'glow', params: { mode: 'shape', strength: 50, radius: 30 } }
  it('影与光的像素：影确实投下、amount 按比例、散焦让影边变软、顺序决定谁在上面', async () => {
    // 白块 (20..44, 20..40)；投影向下 8 像素（250 × 0.0005 × 64）、不虚化，(30, 44) 只落在影子里。
    const crisp = { id: 'drop_shadow', params: { distance: 250, softness: 0, opacity: 100 } }
    const glow = { id: 'glow', params: { threshold: 0, strength: 70, radius: 20 } }
    const full = await layer(titleData(), [crisp, glow])
    expect(at(full.pixels, 30, 44)[3]).toBeGreaterThanOrEqual(250)
    expect(full.carriesLight).toBe(true)
    const half = await layer(titleData(), [crisp, glow], undefined, { amount: 0.5 })
    expect(Math.abs(at(half.pixels, 30, 44)[3] - 128)).toBeLessThanOrEqual(3)
    // 散焦：影子下缘（第 47 行）从实变软，影子中间仍然较实。
    expect(at(full.pixels, 30, 47)[3]).toBeGreaterThanOrEqual(250)
    for (const lens of [false, true]) {
      const blurred = await layer(titleData(), [crisp, glow], { radius: 3, lens })
      expect(at(blurred.pixels, 30, 47)[3]).toBeLessThan(240); expect(at(blurred.pixels, 30, 47)[3]).toBeGreaterThan(20)
      expect(at(blurred.pixels, 30, 44)[3]).toBeGreaterThan(at(blurred.pixels, 30, 47)[3])
    }
    // 后产生的叠在上面：光在影子之后时影子处还看得到光，影子在光之后时光被影子压暗。
    const lightOnTop = at(full.pixels, 30, 42), shadowOnTop = at((await layer(titleData(), [glow, crisp])).pixels, 30, 42)
    expect(lightOnTop[0]).toBeGreaterThan(shadowOnTop[0] + 20)
  })
  it('影与光混合、换顺序、amount 0.5、两种 pose.blur：结果有效、可重复，carriesLight 只看光', async () => {
    for (const chain of [[shadow, glowBright], [glowBright, shadow], [shadow, glowShape]]) {
      for (const defocus of [{ radius: 0, lens: false }, { radius: 3, lens: false }, { radius: 3, lens: true }]) {
        for (const amount of [1, 0.5]) {
          device.pushErrorScope('validation')
          const first = await layer(titleData(), chain, defocus, { amount })
          const second = await layer(titleData(), chain, defocus, { amount })
          expect(await device.popErrorScope()).toBeNull()
          expect(first.carriesLight).toBe(true)
          expect(hash(first.pixels)).toBe(hash(second.pixels))
        }
      }
    }
    expect((await layer(titleData(), [shadow], { radius: 3, lens: true })).carriesLight).toBe(false)
  }, 60_000)
  it('同一槽位逐帧切换“光 → 只有影 → 无下层”，不残留上一帧的下层', async () => {
    const d = device as unknown as GpuDevice
    const author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator())
    const input = texture(titleData()), frame = target()
    try {
      const results: Array<{ carriesLight: boolean; pixels: Uint8Array }> = []
      for (const effectsOfFrame of [[glowShape], [shadow], []]) {
        await author.begin(frame); chain.begin(author.commandEncoder())
        const result = await chain.encode('slot', input, W, H, resolveAuthorEffects(effectsOfFrame), reference(), {}, 'content', { radius: 0, lens: false }, value => author.mipmaps(value, W, H), 0)
        author.finish(); chain.commit()
        results.push({ carriesLight: result.carriesLight, pixels: await read(result.picture) })
      }
      expect(results.map(result => result.carriesLight)).toEqual([true, false, false])
      expect(hash(results[1].pixels)).toBe(hash((await layer(titleData(), [shadow])).pixels))
      expect(hash(results[2].pixels)).toBe(hash(titleData()))
    } finally { chain.dispose(); await author.dispose(); input.destroy(); frame.destroy() }
  })
  it('rg32float 经正式分配器计账；蓝噪声表与调色表交替使用不复用错尺寸', async () => {
    const host = new VideoEditCodeGpu(device as unknown as GpuDevice)
    try {
      const before = host.diagnostics().residentBytes
      const seedTexture = host.effectAllocator.allocate(16, 16, 'rg32float')
      expect(host.diagnostics().residentBytes - before).toBe(16 * 16 * 8)
      host.effectAllocator.release(seedTexture)
      expect(host.diagnostics().residentBytes).toBe(before)
      device.pushErrorScope('validation')
      const reference = await clip(titleData(), 'dissolve_reveal', {})
      for (let round = 0; round < 10; round++) {
        await clip(titleData(), 'color_grade', { exposure: round / 10 }); effects.releaseIdle()
        expect(hash(await clip(titleData(), 'dissolve_reveal', {}))).toBe(hash(reference)); effects.releaseIdle()
      }
      expect(await device.popErrorScope()).toBeNull()
    } finally { await host.dispose() }
  })
})

describe('外扩覆盖实际取样支撑', () => {
  // 声明的外扩以外，用更大的外扩渲染也看不到任何内容（不超过半级）。
  const cases: Array<[string, Record<string, unknown>]> = [
    ['drop_shadow', { distance: 100, softness: 60, opacity: 100 }],
    ['stroke', { width: 80, softness: 50 }],
    ['light_sweep', { glow_strength: 60, glow_radius: 40, intensity: 200 }],
    ['dissolve_reveal', { edge_width: 40, glow_strength: 60, glow_radius: 40 }],
    ['paper', { amount: 100, edge: 100, scale: 100 }],
  ]
  it.each(cases)('%s', async (id, params) => {
    const contentWidth = 60, contentHeight = 30
    const definition = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.find(value => value.id === id)!
    const resolved = { ...videoEditBuiltinDefaults(definition), ...params } as Record<string, number>
    const declared = Math.ceil(definition.bleed!(resolved, local(contentWidth, contentHeight, 0)) * 1080)
    const pad = declared + 48, width = contentWidth + pad * 2, height = contentHeight + pad * 2
    const data = canvas(width, height, (x, y) => x >= pad && x < pad + contentWidth && y >= pad && y < pad + contentHeight ? [255, 255, 255, 255] : undefined)
    const pixels = (await layer(data, [{ id, params }], undefined, { width, height, reference: local(contentWidth, contentHeight, pad) })).pixels
    let outside = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x >= pad - declared && x < pad + contentWidth + declared && y >= pad - declared && y < pad + contentHeight + declared) continue
      outside = Math.max(outside, ...at(pixels, x, y, width))
    }
    expect(outside).toBeLessThanOrEqual(1)
  }, 60_000)
})

describe('质感', () => {
  // 作者库生成的工厂直接给出描述；参考画面 1920×1080，小纹理里也是正常大小的网点与点阵。
  const texture1080 = (): LayerEffectReference => local(W, H, 0)
  const alphas = (pixels: Uint8Array): number[] => Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3])
  it('半调网点：原色网点之间透明；双色的纸按原画逐像素透明度铺满内容；彩色印刷白处不上墨、黑处盖满', async () => {
    const original = (await layer(nightData(), [halftone({ size: 60 })], undefined, { reference: texture1080() })).pixels
    expect(alphas(original).some(alpha => alpha === 0)).toBe(true)
    const title = titleData()
    const duo = (await layer(title, [halftone({ size: 60, color_mode: 'duo' })], undefined, { reference: texture1080() })).pixels
    expect(Math.max(...alphas(duo).map((alpha, i) => Math.abs(alpha - title[i * 4 + 3])))).toBeLessThanOrEqual(1)
    const half = canvas(W, H, x => x < W / 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])
    const cmyk = (await layer(half, [halftone({ size: 60, mode: 'cmyk', misregister: 20 })], undefined, { reference: texture1080() })).pixels
    expect(at(cmyk, 4, 32)).toEqual([255, 255, 255, 255]); expect(at(cmyk, W - 4, 32)).toEqual([0, 0, 0, 255])
    expect(Math.min(...alphas(cmyk))).toBe(255)
    // 线条：网线水平，同一行横向一致；远看墨的面积就是暗度（半灰约一半）。
    const gray = canvas(W, H, () => [128, 128, 128, 255])
    const lines = (await layer(gray, [halftone({ size: 60, color_mode: 'duo', shape: 'line' })], undefined, { reference: texture1080() })).pixels
    const rows = Array.from({ length: H }, (_, y) => new Set(Array.from({ length: W }, (_, x) => at(lines, x, y)[0])).size)
    expect(Math.max(...rows)).toBe(1)
    const linear = (value: number): number => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const paperShare = Array.from({ length: H }, (_, y) => linear(at(lines, 0, y)[0])).reduce((sum, value) => sum + value, 0) / H
    expect(Math.abs(paperShare - 128 / 255)).toBeLessThan(0.08)
  }, 60_000)
  it('抖动点阵：两色时每个像素只是暗色或亮色、同一个点里同色；蓝噪声与方格都确定', async () => {
    for (const pattern of ['bayer', 'blue_noise'] as const) {
      const params = { pixel_size: 60, pattern }
      const pixels = (await layer(nightData(), [ditherPattern(params)], undefined, { reference: texture1080() })).pixels
      expect(hash(pixels)).toBe(hash((await layer(nightData(), [ditherPattern(params)], undefined, { reference: texture1080() })).pixels))
      // 同一个点里与点的左上角同色（点的边长按参考画面高度换算再取整）。
      const size = Math.round(ditherPixelSize(60) * 1080), wrong: string[] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [r, g, b, a] = at(pixels, x, y)
        if (!/^(0,0,0|255,255,255),255$/.test([r, g, b, a].join()) || r !== at(pixels, x - x % size, y - y % size)[0]) wrong.push(`${x},${y}`)
      }
      expect(wrong.slice(0, 5)).toEqual([])
    }
    // 原色、色阶 2：每个通道只剩 0 或 255，透明处仍透明。
    const title = titleData()
    const original = (await layer(title, [ditherPattern({ pixel_size: 0, color_mode: 'original' })], undefined, { reference: texture1080() })).pixels
    const levels = new Set(Array.from({ length: W * H }, (_, i) => original[i * 4 + 3] === 255 ? [0, 1, 2].map(c => original[i * 4 + c]) : []).flat())
    expect([...levels].every(value => value === 0 || value === 255)).toBe(true)
    expect(at(original, 2, 2)[3]).toBe(0)
  }, 60_000)
  it('纸张强度 0 与原画逐位相同、默认只改明暗不改透明度；划痕同一帧相同、停留 100 换帧不变、数量 0 不改画面', async () => {
    const night = nightData()
    expect(hash(await clip(night, 'paper', { amount: 0 }))).toBe(hash(night))
    const paper = await clip(titleData(), 'paper', { edge: 0 })
    expect(alphas(paper)).toEqual(alphas(titleData()))
    const scratches = async (params: Record<string, unknown>, frame: number): Promise<string> => {
      const input = texture(night), output = target()
      try {
        await effects.render({ id: 'scratches', params: params as Record<string, number> }, { texture: input, width: W, height: H, format: 'rgba8unorm' }, output, frame, 1, [], 'final')
        return hash(await read(output))
      } finally { input.destroy(); output.destroy() }
    }
    const busy = { amount: 100, opacity: 100, width: 100 }
    expect(await scratches(busy, 7)).toBe(await scratches(busy, 7))
    expect(await scratches(busy, 7)).not.toBe(hash(night))
    expect(await scratches({ ...busy, hold: 100 }, 7)).toBe(await scratches({ ...busy, hold: 100 }, 300))
    expect(await scratches({ ...busy, amount: 0 }, 7)).toBe(hash(night))
  }, 60_000)
})

describe('镜头光晕与漏光', () => {
  /** 片段入口，或图层拆输出（主图叠在零 alpha 光上）；漏光的时间是效果时钟的 帧号 × 帧时长（这里 30 fps）。 */
  async function light(source: Uint8Array, id: string, params: Record<string, unknown>, options: { frame?: number; split?: boolean } = {}): Promise<Uint8Array> {
    const instance = { id, params } as never, frame = options.frame ?? 0, frameDuration = 1 / 30
    const input = texture(source), output = target(), image = target(), under = target()
    try {
      if (!options.split) await effects.render(instance, { texture: input, width: W, height: H, format: 'rgba8unorm' }, output, frame, 1, [], 'final', undefined, frameDuration)
      else {
        const plan = planVideoEditBuiltinEffect(instance, { width: W, height: H, frame, frameDuration, split: true })
        expect(plan.underlay).toBeDefined()
        await effects.encodePlan(plan, 'rgba8unorm', input, image, undefined, [], undefined, under)
        const compose: VideoEditBuiltinPlan = { width: W, height: H, scratch: [], passes: [{ entry: 'effect_over', source: 'input', original: 'second', target: 'output', uniforms: new Float32Array([W, H, W, H, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }] }
        await effects.encodePlan(compose, 'rgba8unorm', image, output, under)
      }
      return await read(output)
    } finally { [input, output, image, under].forEach(value => value.destroy()) }
  }
  const brightness = (pixels: Uint8Array, x: number, y: number): number => at(pixels, x, y).slice(0, 3).reduce((sum, value) => sum + value, 0)
  const dark = (): Uint8Array => canvas(W, H, () => [14, 14, 16, 255])
  /** 透明底上一块不透明的字块：半透明处两种输出本来就按不同的透明度语义叠光（与发光相同），这里只比完全透明与不透明。 */
  const block = (): Uint8Array => canvas(W, H, (x, y) => x >= 30 && x < 70 && y >= 20 && y < 44 ? [200, 200, 210, 255] : undefined)

  it('镜头光晕：只给画面加光；光源移出画面时边上的光连续变暗、过边缘不跳变；拆输出与片段一致', async () => {
    const night = nightData(), flare = await light(night, 'lens_flare', {})
    expect(Math.min(...flare.map((value, index) => value - night[index]))).toBeGreaterThanOrEqual(-1)
    expect(brightness(flare, 24, 16)).toBeGreaterThan(740)
    // 只看光雾：没有星芒与拉丝时，光源离画面右边缘由近到远，边上一点的亮度单调变暗。
    const edge: number[] = []
    for (const x of [98, 99, 100, 100.5, 101, 102, 104, 110, 120]) edge.push(brightness(await light(dark(), 'lens_flare', { light_x: x, light_y: 25, rays: 0, streak: 0 }), 88, 16))
    for (let index = 1; index < edge.length; index++) expect(edge[index], `第 ${index} 个位置`).toBeLessThanOrEqual(edge[index - 1] + 8)
    expect(Math.abs(edge[2] - edge[3])).toBeLessThanOrEqual(12)
    expect(edge[0] - edge.at(-1)!).toBeGreaterThan(300)
    const black = [0, 0, 0, 255], params = { ghosts: 60, light_x: 40 }
    const clipped = over(await light(block(), 'lens_flare', params), black), layered = over(await light(block(), 'lens_flare', params, { split: true }), black)
    // 片段先压锐利的光再叠光雾，图层下层先有光雾再加锐利的光：两者都接近白时肩部压缩的先后差几级。
    expect(Math.max(...clipped.map((value, index) => Math.abs(value - layered[index])))).toBeLessThanOrEqual(3)
  }, 60_000)
  it('漏光：从所选方向渗进来；速度 > 0 时光形随效果时钟流动；拆输出与片段一致', async () => {
    const corner = await light(dark(), 'light_leak', {})
    expect(brightness(corner, 3, 3)).toBeGreaterThan(brightness(corner, 92, 60) + 150)
    const right = await light(dark(), 'light_leak', { side: 'right' })
    expect(brightness(right, 92, 32)).toBeGreaterThan(brightness(right, 3, 32) + 150)
    expect(hash(await light(dark(), 'light_leak', { speed: 100, flicker: 0 }, { frame: 0 }))).not.toBe(hash(await light(dark(), 'light_leak', { speed: 100, flicker: 0 }, { frame: 90 })))
    const black = [0, 0, 0, 255]
    const clipped = over(await light(block(), 'light_leak', { amount: 120 }), black), layered = over(await light(block(), 'light_leak', { amount: 120 }, { split: true }), black)
    expect(Math.max(...clipped.map((value, index) => Math.abs(value - layered[index])))).toBeLessThanOrEqual(2)
  }, 60_000)
})

describe('变形（真实设备）', () => {
  // 声明的外扩以外看不到内容：变形把内容推出内容框时，图层纹理不切掉它。描述由生成的作者工厂产出，走正式作者链。
  const factories: Record<string, (params: never) => unknown> = { mirror, repeat, bulge, twirl, wave, corner_pin: cornerPin, displace }
  const reaches: Array<[string, string, Record<string, unknown>, [number, number]?]> = [
    ['镜像·斜着、中心偏右', 'mirror', { angle: 30, center_x: 80 }],
    ['重复·网格错位', 'repeat', { columns: 4, rows: 3, stagger: 50, spacing: 20 }],
    ['重复·直线', 'repeat', { mode: 'linear', count: 4, angle: 30, spacing: 30 }],
    ['重复·环形放大', 'repeat', { mode: 'ring', count: 6, radius: 5, scale_step: 20, face_center: true }],
    ['膨胀·平滑', 'bulge', { amount: 100, radius: 6 }],
    ['膨胀·球面', 'bulge', { amount: 100, radius: 6, shape: 'sphere' }],
    ['旋转扭曲·平滑', 'twirl', { angle: 300, radius: 5 }],
    ['旋转扭曲·同心环', 'twirl', { mode: 'rings', angle: 200, radius: 5, rings: 4 }],
    // 最外一圈与环外的过渡带一直转到半径外：两圈、柔和度 100%、各圈都转满角度时伸得最远。
    ['旋转扭曲·同心环最宽过渡', 'twirl', { mode: 'rings', angle: 180, radius: 10, rings: 2, ring_softness: 100, ring_random: 0 }, [600, 100]],
    ['波动·波浪', 'wave', { amount: 60, wavelength: 10, waveform: 'square' }],
    ['波动·流动', 'wave', { mode: 'flow', amount: 60, wavelength: 10, detail: 100 }],
    ['边角定位', 'corner_pin', { tr_x: 160, br_y: 180, bl_x: -40 }],
    ['置换·噪声', 'displace', { amount: 60, scale: 0, detail: 100 }],
    ['置换·自身亮度', 'displace', { source: 'luma', amount: 60 }],
  ]
  it.each(reaches)('外扩覆盖：%s', async (_, id, params, size = [60, 30]) => {
    const [contentWidth, contentHeight] = size
    const definition = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.find(value => value.id === id)!
    const resolved = { ...videoEditBuiltinDefaults(definition), ...params } as Record<string, number>
    const declared = Math.ceil(definition.bleed!(resolved, local(contentWidth, contentHeight, 0)) * 1080)
    const pad = declared + 48, width = contentWidth + pad * 2, height = contentHeight + pad * 2
    const data = canvas(width, height, (x, y) => x >= pad && x < pad + contentWidth && y >= pad && y < pad + contentHeight ? [255, 255, 255, 255] : undefined)
    const pixels = (await layer(data, [factories[id](params as never)], undefined, { width, height, reference: local(contentWidth, contentHeight, pad) })).pixels
    let outside = 0, inside = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const alpha = at(pixels, x, y, width)[3]
      if (x >= pad - declared && x < pad + contentWidth + declared && y >= pad - declared && y < pad + contentHeight + declared) inside = Math.max(inside, alpha)
      else outside = Math.max(outside, alpha)
    }
    expect(inside).toBe(255); expect(outside).toBeLessThanOrEqual(1)
  }, 60_000)

  it('镜像左右对称；边角定位缩进的四角之外透明、重复边缘时铺满内容框；透明底的边缘不发黑', async () => {
    const mirrored = await clip(nightData(), 'mirror', {})
    for (let y = 0; y < H; y += 7) for (let x = 0; x < W / 2; x += 5) expect(at(mirrored, W - 1 - x, y)).toEqual(at(mirrored, x, y))
    const quad = { tl_x: 25, tl_y: 25, tr_x: 75, tr_y: 25, bl_x: 25, bl_y: 75, br_x: 75, br_y: 75 }
    const pinned = await clip(nightData(), 'corner_pin', quad)
    expect(at(pinned, 2, 2)[3]).toBe(0); expect(at(pinned, W / 2, H / 2)[3]).toBe(255)
    // 四角缩到一半：原画右下角的亮点（80, 50）落到（64, 41）附近。
    expect(at(pinned, 64, 41)[0]).toBeGreaterThan(200)
    const filled = await clip(nightData(), 'corner_pin', { ...quad, edges: 'clamp' })
    expect(Math.min(...Array.from({ length: W * H }, (_, index) => filled[index * 4 + 3]))).toBe(255)
    // 白色内容在透明底上变形：凡有覆盖的像素，去掉预乘后仍是白色（双线性取到纹理外按零边框，不混进黑色）。
    const cases: Array<[string, Record<string, unknown>]> = [['twirl', { angle: 200 }], ['wave', { amount: 80, waveform: 'square' }], ['repeat', { mode: 'ring', count: 7, scale_step: -30 }], ['corner_pin', { tr_x: 90, tr_y: 20, br_x: 70 }]]
    for (const [id, params] of cases) {
      const white = canvas(W, H, (x, y) => (x - 48) ** 2 / 400 + (y - 32) ** 2 / 100 < 1 ? [255, 255, 255, 255] : undefined)
      const pixels = (await layer(white, [{ id, params }])).pixels
      for (let index = 0; index < W * H; index++) if (pixels[index * 4 + 3] > 8) expect(pixels[index * 4] / pixels[index * 4 + 3], id).toBeGreaterThan(0.97)
    }
  }, 60_000)

  it('速度按效果时钟走：同一时刻逐像素相同，速度 0 时与时间无关', async () => {
    // 片段效果链的时钟：片段内帧号乘每帧秒数（30 帧每秒）。
    const run = async (id: string, params: Record<string, unknown>, time: number): Promise<string> => {
      const input = texture(nightData()), output = target()
      try {
        await effects.render({ id, params: params as Record<string, number> }, { texture: input, width: W, height: H, format: 'rgba8unorm' }, output, time * 30, 1, [], 'final', undefined, 1 / 30)
        return hash(await read(output))
      } finally { input.destroy(); output.destroy() }
    }
    const cases: Array<[string, Record<string, unknown>]> = [['wave', { amount: 60 }], ['wave', { mode: 'flow', amount: 60 }], ['displace', { amount: 60 }]]
    for (const [id, params] of cases) {
      expect(await run(id, { ...params, speed: 100 }, 0.25)).toBe(await run(id, { ...params, speed: 100 }, 0.25))
      expect(await run(id, { ...params, speed: 100 }, 0.25)).not.toBe(await run(id, { ...params, speed: 100 }, 0.5))
      expect(await run(id, params, 0.25)).toBe(await run(id, params, 3))
    }
  }, 60_000)
  // 图层上一律按透明取样：贴着内容框的不透明卡片变形后，框内也会露出透明处，内容框的直边不留在画面上。
  it.each([['wave', {}], ['twirl', {}], ['bulge', { amount: -60 }]] as const)('不透明卡片图层加默认%s，不留内容框直边', async (id, params) => {
    const contentWidth = 120, contentHeight = 60, pad = 96, width = contentWidth + pad * 2, height = contentHeight + pad * 2
    const card = canvas(width, height, (x, y) => x >= pad && x < pad + contentWidth && y >= pad && y < pad + contentHeight ? [40 + (x - pad), 90, 160, 255] : undefined)
    const pixels = (await layer(card, [{ id, params }], undefined, { width, height, reference: local(contentWidth, contentHeight, pad) })).pixels
    let holes = 0
    for (let y = pad; y < pad + contentHeight; y++) for (let x = pad; x < pad + contentWidth; x++) if (at(pixels, x, y, width)[3] <= 8) holes++
    expect(holes).toBeGreaterThan(20)
  }, 60_000)

  // 方波每一段是整像素平移：[发光, 波动] 在同一段里等于把 [发光] 整体挪过去。光晕跟着走，内容框边上也不会被拉成条纹。
  it('[发光, 波动] 的光晕随波动一起平移，内容框边缘不出条纹', async () => {
    const contentWidth = 60, contentHeight = 30
    const glow = { id: 'glow', params: { threshold: 0, strength: 60, radius: 30 } }
    // 方向 90°：波往下走、画面左右平移；波长一个画面高、相位 −90°，内容附近都在同一段，整体左移 27 像素。
    const waved = { id: 'wave', params: { amount: 50, wavelength: 100, direction: 90, waveform: 'square', phase: -90 } }
    const pad = Math.ceil(authorEffectBleed(resolveAuthorEffects([glow, waved]), local(contentWidth, contentHeight, 0)) * 1080) + 8
    expect(pad).toBeLessThan(260)
    const width = contentWidth + pad * 2, height = contentHeight + pad * 2
    const data = canvas(width, height, (x, y) => x >= pad && x < pad + contentWidth && y >= pad && y < pad + contentHeight ? [255, 255, 255, 255] : undefined)
    const reference = local(contentWidth, contentHeight, pad)
    const alone = (await layer(data, [glow], undefined, { width, height, reference })).pixels
    const moved = (await layer(data, [glow, waved], undefined, { width, height, reference })).pixels
    let worst = 0
    for (let y = 0; y < height; y++) for (let x = 0; x + 27 < width; x++) for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(at(moved, x, y, width)[c] - at(alone, x + 27, y, width)[c]))
    expect(worst).toBeLessThanOrEqual(1)
  }, 60_000)

  it('[投影, 边角定位] 的影子贴进透视；[投影, 重复阵列] 的每个副本都带影子', async () => {
    const contentWidth = 60, contentHeight = 30, pad = 128, width = contentWidth + pad * 2, height = contentHeight + pad * 2
    const data = canvas(width, height, (x, y) => x >= pad && x < pad + contentWidth && y >= pad && y < pad + contentHeight ? [255, 255, 255, 255] : undefined)
    const reference = local(contentWidth, contentHeight, pad)
    // 影子往右 10.8 像素、边缘清楚、不透明。
    const shadow = { id: 'drop_shadow', params: { opacity: 100, distance: 20, softness: 0, direction: 0 } }
    // 四角收进左半边：内容与影子一起被压窄，右半边（内容框里 x = 50）什么都没有。
    const pinned = (await layer(data, [shadow, { id: 'corner_pin', params: { tr_x: 50, br_x: 50 } }], undefined, { width, height, reference })).pixels
    expect(at(pinned, pad + 50, pad + 15, width)[3]).toBeLessThanOrEqual(8)
    expect(at(pinned, pad + 33, pad + 15, width)[3]).toBeGreaterThan(200)
    // 三列网格、间距 50%：左边副本的影子落在它右侧的格缝里（内容框坐标 x = −25）。
    const copies = (await layer(data, [shadow, { id: 'repeat', params: { columns: 3, rows: 1, spacing: 50 } }], undefined, { width, height, reference })).pixels
    const gap = at(copies, pad - 25, pad + 15, width)
    expect(gap[3]).toBeGreaterThan(200); expect(gap[0]).toBeLessThan(40)
  }, 60_000)
  // 片段效果存完整参数表，风格件里总带着片段专用的边缘；图层上略过它（图层一律透明），与直接写同参数的波动逐像素相同。
  it('片段上的波动（边缘为镜像）存成风格件，代码图层 look() 照常渲染', async () => {
    const definition = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.find(value => value.id === 'wave')!
    const params = { ...videoEditBuiltinDefaults(definition), amount: 60, edges: 'mirror' }
    const preset = videoEditEffectPresetSchema.parse({ id: 'piece', name: '水波', media: 'video', effects: [{ id: 'fx', name: '波动', enabled: true, amount: 1, builtin: { id: 'wave', params } }] })
    const white = canvas(W, H, (x, y) => (x - 48) ** 2 / 400 + (y - 32) ** 2 / 100 < 1 ? [255, 255, 255, 255] : undefined)
    const looked = (await layer(white, [{ id: 'look', params: { name: '水波' } }], undefined, { environment: { presets: [preset] } })).pixels
    const direct = (await layer(white, [{ id: 'wave', params: Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'edges')) }])).pixels
    expect(hash(looked)).toBe(hash(direct)); expect(Math.max(...looked)).toBe(255)
  }, 60_000)

  // 透视会把框外的影子、模糊边按射影外推放大：外扩按“内容框加前面外扩”经同一透视映射后的范围算，纹理边上不留切口。
  it.each([
    ['投影 → 地面透视 30/70', { id: 'drop_shadow', params: {} }, { tl_x: 30, tr_x: 70 }],
    ['投影 → 角点拉出内容框', { id: 'drop_shadow', params: {} }, { tr_x: 160, br_y: 180, bl_x: -40 }],
    ['模糊 → 地面透视 30/70', { id: 'blur', params: { amount: 40, repeat_edges: false } }, { tl_x: 30, tr_x: 70 }],
  ] as const)('%s：影子、模糊边不被纹理边切掉', async (_, before, pin) => {
    const contentWidth = 600, contentHeight = 340, chain = [before, { id: 'corner_pin', params: pin }]
    const pad = Math.ceil(authorEffectBleed(resolveAuthorEffects(chain), local(contentWidth, contentHeight, 0)) * 1080)
    const width = contentWidth + pad * 2, height = contentHeight + pad * 2
    const data = canvas(width, height, (x, y) => x >= pad && x < pad + contentWidth && y >= pad && y < pad + contentHeight ? [255, 255, 255, 255] : undefined)
    const pixels = (await layer(data, [...chain], undefined, { width, height, reference: local(contentWidth, contentHeight, pad) })).pixels
    let border = 0
    for (let x = 0; x < width; x++) border = Math.max(border, at(pixels, x, 0, width)[3], at(pixels, x, height - 1, width)[3])
    for (let y = 0; y < height; y++) border = Math.max(border, at(pixels, 0, y, width)[3], at(pixels, width - 1, y, width)[3])
    expect(border).toBeLessThanOrEqual(1)
  }, 120_000)
})
describe('主体抠像与主体轮廓', () => {
  /** 人物蒙版 `subject` 与输入同尺寸，由合成场景按片段几何放好：a 取 `matte` 的 alpha，r 为片段画面覆盖（整幅都是片段）。 */
  async function keyed(source: Uint8Array, matte: Uint8Array, id: string, params: Record<string, unknown>): Promise<Uint8Array> {
    const input = texture(source), subject = texture(Uint8Array.from(matte, (value, index) => index % 4 === 3 ? value : 255)), output = target()
    try {
      await effects.render({ id, params: params as Record<string, number> }, { texture: input, width: W, height: H, format: 'rgba8unorm' }, output, 0, 1, [], 'final', undefined, undefined, subject)
      return await read(output)
    } finally { input.destroy(); subject.destroy(); output.destroy() }
  }
  const SUBJECT = [40, 60, 160], BACKDROP = [230, 220, 120]
  const inBox = (x: number, y: number): boolean => x >= 30 && x < 66 && y >= 16 && y < 48
  const white = (value: number): number[] => [value, value, value, value]

  it('蒙版内保留原画、蒙版外透明，预乘成立；去掉主体反过来只留背景', async () => {
    const picture = canvas(W, H, (x, y) => [...(inBox(x, y) ? SUBJECT : BACKDROP), 255])
    const matte = canvas(W, H, (x, y) => inBox(x, y) ? white(255) : undefined)
    const kept = await keyed(picture, matte, 'subject_key', {})
    expect(at(kept, 48, 32)).toEqual([...SUBJECT, 255]); expect(at(kept, 5, 5)).toEqual([0, 0, 0, 0])
    for (let index = 0; index < kept.length; index += 4) for (let c = 0; c < 3; c++) expect(kept[index + c]).toBeLessThanOrEqual(kept[index + 3])
    const removed = await keyed(picture, matte, 'subject_key', { invert: true })
    expect(at(removed, 48, 32)[3]).toBe(0); expect(at(removed, 5, 5)).toEqual([...BACKDROP, 255])
  })

  it('收缩 / 扩展移动人物边缘，“去掉主体”时作用在保留的背景上（方向反过来）', async () => {
    const picture = canvas(W, H, (x, y) => [...(inBox(x, y) ? SUBJECT : BACKDROP), 255])
    const matte = canvas(W, H, (x, y) => inBox(x, y) ? white(255) : undefined)
    // H = 64：±100 约 0.64 像素，边上一圈按 0.64 的权重移进或移出；柔化默认值在这个尺寸下不到 0.3 像素，不模糊。
    const alpha = async (choke: number, invert: boolean, x: number): Promise<number> => at(await keyed(picture, matte, 'subject_key', { choke, invert }), x, 32)[3]
    const near = (value: number, expected: number): void => expect(Math.abs(value - expected)).toBeLessThanOrEqual(3)
    near(await alpha(100, false, 66), 163); near(await alpha(100, false, 65), 255)
    near(await alpha(-100, false, 65), 92); near(await alpha(-100, false, 66), 0)
    // 去掉主体：扩展让保留的背景长进人物（人物边上一圈只剩 0.36），收缩让背景退开（人物外一圈也去掉 0.64）。
    near(await alpha(100, true, 65), 163); near(await alpha(100, true, 66), 255)
    near(await alpha(-100, true, 66), 92); near(await alpha(-100, true, 65), 0)
  })

  it('边缘柔化：人物边上的透明度单调过渡，去掉主体时反过来', async () => {
    const picture = canvas(W, H, (x, y) => [...(inBox(x, y) ? SUBJECT : BACKDROP), 255])
    const matte = canvas(W, H, (x, y) => inBox(x, y) ? white(255) : undefined)
    for (const invert of [false, true]) {
      const pixels = await keyed(picture, matte, 'subject_key', { feather: 100, invert })
      const row = Array.from({ length: 12 }, (_, index) => at(pixels, 60 + index, 32)[3])
      for (let index = 1; index < row.length; index++) expect(invert ? row[index] - row[index - 1] : row[index - 1] - row[index]).toBeGreaterThanOrEqual(0)
      expect(row.filter(value => value > 8 && value < 247).length).toBeGreaterThanOrEqual(2)
      expect(invert ? row[0] : row.at(-1)).toBe(0)
    }
  })

  it('半透明边缘换成附近人物的颜色：叠到新底色上比直接相乘更接近人物本色，人物内部不变', async () => {
    // 原画 = α·人物色 + (1 − α)·原背景色，α 沿横向从 0 升到 1；人物蒙版就是 α。
    const alphaAt = (x: number): number => Math.min(1, Math.max(0, (x - 40) / 16))
    const picture = canvas(W, H, x => [...SUBJECT.map((value, c) => Math.round(alphaAt(x) * value + (1 - alphaAt(x)) * BACKDROP[c])), 255])
    const matte = canvas(W, H, x => white(Math.round(alphaAt(x) * 255)))
    const pixels = await keyed(picture, matte, 'subject_key', {})
    expect(at(pixels, 80, 32)).toEqual([...SUBJECT, 255])
    for (let x = 44; x < 52; x++) {
      const alpha = Math.round(alphaAt(x) * 255) / 255
      const decontaminated = Math.max(...SUBJECT.map((value, c) => Math.abs(at(pixels, x, 32)[c] - alpha * value)))
      const multiplied = Math.max(...SUBJECT.map((value, c) => Math.abs(at(picture, x, 32)[c] * alpha - alpha * value)))
      expect(decontaminated).toBeLessThan(multiplied * 0.65)
      for (let c = 0; c < 3; c++) expect(at(pixels, x, 32)[c]).toBeLessThanOrEqual(at(pixels, x, 32)[3])
    }
  })

  it('蒙版取内容自己的 alpha 时，轮廓来源“主体”的描边（两条路径）与发光和内容透明度方式一致', async () => {
    const title = titleData()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['stroke', { width: 50, color: WHITE_HEX }], ['stroke', { width: 110, color: WHITE_HEX, position: 'center' }],
      ['glow', { mode: 'shape', strength: 60, radius: 40, tint_inner: VIDEO_EDIT_GLOW_TEST_COLORS.inner, tint_outer: VIDEO_EDIT_GLOW_TEST_COLORS.outer }],
    ]
    for (const [id, params] of cases) {
      const alpha = await keyed(title, title, id, params)
      const subject = await keyed(title, title, id, { ...params, contour: 'subject' })
      // 半透明内容（圆点）在两种方式里本来就按不同的叠法计算，只比较完全透明与完全不透明处。
      for (let index = 0; index < title.length; index += 4) if (title[index + 3] === 0 || title[index + 3] === 255) for (let c = 0; c < 4; c++) expect(Math.abs(alpha[index + c] - subject[index + c])).toBeLessThanOrEqual(1)
    }
  })

  it('主体描边叠在不透明原画之上：人物内外远处原样，边落在人物外的背景上', async () => {
    const picture = canvas(W, H, (x, y) => [...(inBox(x, y) ? SUBJECT : BACKDROP), 255])
    const matte = canvas(W, H, (x, y) => inBox(x, y) ? white(255) : undefined)
    const pixels = await keyed(picture, matte, 'stroke', { width: 110, color: WHITE_HEX, contour: 'subject' })
    expect(at(pixels, 48, 32)).toEqual([...SUBJECT, 255]); expect(at(pixels, 5, 5)).toEqual([...BACKDROP, 255])
    expect(at(pixels, 67, 32)).toEqual([255, 255, 255, 255])
  })

  it('主体发光：人物内部不变、身后背景变亮', async () => {
    const DARK = [16, 16, 20]
    const params = { mode: 'shape', strength: 60, radius: 40, contour: 'subject' }
    const matte = canvas(W, H, (x, y) => inBox(x, y) ? white(255) : undefined)
    const lit = await keyed(canvas(W, H, (x, y) => [...(inBox(x, y) ? SUBJECT : DARK), 255]), matte, 'glow', params)
    expect(at(lit, 48, 32).map((value, c) => Math.abs(value - [...SUBJECT, 255][c])).every(diff => diff <= 1)).toBe(true)
    const full = at(lit, 70, 32)[0] - DARK[0]
    expect(full).toBeGreaterThan(20)
  })
})
