import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLACK_HEX, WHITE_HEX, VIDEO_EDIT_GLOW_TEST_COLORS } from '@/core/theme/colorTokens'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { resolveAuthorEffects } from '@/core/videoEdit/authorEffects'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { VideoEditBuiltinEffectsGpu, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import { VideoEditAuthorEffects } from './videoEditAuthorEffects'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { videoEditHalfToFloat } from './videoEditGpuShaders'
import { planStroke, strokeJumpSteps } from './stroke'
import type { VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { blurAmountForSigma } from '@/core/videoEdit/blur'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'

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
async function layer(source: Uint8Array, chainEffects: unknown[], defocus = { radius: 0, lens: false }, options: { width?: number; height?: number; reference?: LayerEffectReference; amount?: number } = {}): Promise<{ pixels: Uint8Array; carriesLight: boolean }> {
  const width = options.width ?? W, height = options.height ?? H
  const d = device as unknown as GpuDevice
  const author = new VideoEditAuthorGpu(d), chain = new VideoEditAuthorEffects(d, allocator())
  const input = texture(source, width, height), frame = target(width, height)
  try {
    await author.begin(frame); chain.begin(author.commandEncoder())
    const resolved = resolveAuthorEffects(chainEffects).map(effect => ({ ...effect, amount: options.amount ?? effect.amount }))
    const result = await chain.encode('layer', input, width, height, resolved, options.reference ?? reference(), {}, undefined, defocus, value => author.mipmaps(value, width, height))
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

describe('发光拆分基线', () => {
  // 发光拆成“金字塔 + 合成”两段前后，亮部方式的片段输出与图层拆分输出必须逐位不变。
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
    expect({ clip: hash(clipped), layer: hash(layered.pixels), carriesLight: layered.carriesLight }).toMatchSnapshot()
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
        const result = await chain.encode('slot', input, W, H, resolveAuthorEffects(effectsOfFrame), reference(), {}, 'content', { radius: 0, lens: false }, value => author.mipmaps(value, W, H))
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

