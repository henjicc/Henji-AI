import type { CubeLut } from '../../lut/cube'
import { colorGradeLinear, colorGradeSrgb } from '../../adjustments/colorGrade'
import { planColorGrade, type AdjustmentPass, type AdjustmentPlan } from '../../adjustments/plan'

type Rgb = [number, number, number]
export interface AdjustmentCoordinates { origin: readonly [number, number]; size: readonly [number, number] }
export interface AdjustmentPixels { width: number; height: number; data: Float32Array; fullWidth?: number; fullHeight?: number; origin?: readonly [number, number] }
const clamp = (value: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, value))
const fract = (value: number): number => value - Math.floor(value)
const mix = (a: number, b: number, weight: number): number => a + (b - a) * weight
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const luma = (rgb: Rgb): number => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
const linear = (x: number): number => Math.sign(x) * colorGradeLinear(Math.abs(x))
const encoded = (x: number): number => Math.sign(x) * colorGradeSrgb(Math.abs(x))
const map = (rgb: Rgb, fn: (value: number, channel: number) => number): Rgb => rgb.map(fn) as Rgb
function weights(rgb: Rgb): Rgb { const y = clamp(luma(rgb)); const shadow = 1 - smooth(0, .5, y); const high = smooth(.5, 1, y); return [shadow, 1 - shadow - high, high] }
function hueBase(h: number): Rgb { return [0, 2 / 3, 1 / 3].map(offset => clamp(Math.abs(fract(h + offset) * 6 - 3) - 1)) as Rgb }
function tint(h: number): Rgb { const rgb = hueBase(h / 360); const y = luma(rgb); return map(rgb, x => x - y) }
function hue(rgb: Rgb): number {
  const hi = Math.max(...rgb); const lo = Math.min(...rgb); const d = hi - lo
  if (d < 1e-6) return 0
  return fract((hi === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : hi === rgb[2] ? (rgb[0] - rgb[1]) / d + 4 : (rgb[1] - rgb[2]) / d) / 6 + 1)
}
function range(x: number, lo: number, hi: number, feather: number): number { return x >= lo && x <= hi ? 1 : feather <= 0 ? 0 : 1 - smooth(0, feather, Math.max(lo - x, x - hi)) }
function hueRange(x: number, lo: number, hi: number, feather: number): number {
  if (lo === 0 && hi === 1) return 1
  const h = fract(x - lo + 1); const span = fract(hi - lo + 1)
  return h <= span ? 1 : feather <= 0 ? 0 : 1 - smooth(0, feather, Math.min(h - span, 1 - h))
}
function curve(data: Float32Array, x: number): number { const at = clamp(x) * (data.length - 1); const left = Math.floor(at); return mix(data[left], data[Math.min(left + 1, data.length - 1)], fract(at)) }
/** Adobe .cube: red changes fastest; 1D linear / 3D trilinear sampling matches WGSL. */
export function sampleCubeLut(cube: CubeLut, rgb: Rgb): Rgb {
  const at = map(rgb, (x, c) => clamp((x - cube.domainMin[c]) / (cube.domainMax[c] - cube.domainMin[c])) * (cube.size - 1))
  if (cube.kind === '1d') return map(at, (x, c) => mix(cube.data[Math.floor(x) * 4 + c], cube.data[Math.min(Math.floor(x) + 1, cube.size - 1) * 4 + c], fract(x)))
  const a = at.map(Math.floor); const b = a.map(x => Math.min(x + 1, cube.size - 1)); const f = at.map(fract)
  const read = (x: number, y: number, z: number, c: number): number => cube.data[((z * cube.size + y) * cube.size + x) * 4 + c]
  return map(rgb, (_, c) => {
    const plane = (z: number): number => mix(mix(read(a[0], a[1], z, c), read(b[0], a[1], z, c), f[0]), mix(read(a[0], b[1], z, c), read(b[0], b[1], z, c), f[0]), f[1])
    return mix(plane(a[2]), plane(b[2]), f[2])
  })
}
function sample(tile: AdjustmentPixels, u: number, v: number): number[] {
  const px = u * (tile.fullWidth ?? tile.width) - (tile.origin?.[0] ?? 0) - .5; const py = v * (tile.fullHeight ?? tile.height) - (tile.origin?.[1] ?? 0) - .5; const x = Math.floor(px); const y = Math.floor(py)
  if (Math.abs(px - Math.round(px)) < 1e-8 && Math.abs(py - Math.round(py)) < 1e-8) {
    const index = (clamp(Math.round(py), 0, tile.height - 1) * tile.width + clamp(Math.round(px), 0, tile.width - 1)) * 4
    return [tile.data[index], tile.data[index + 1], tile.data[index + 2], tile.data[index + 3]]
  }
  const read = (ix: number, iy: number, c: number): number => tile.data[(clamp(iy, 0, tile.height - 1) * tile.width + clamp(ix, 0, tile.width - 1)) * 4 + c]
  return [0, 1, 2, 3].map(c => mix(mix(read(x, y, c), read(x + 1, y, c), fract(px)), mix(read(x, y + 1, c), read(x + 1, y + 1, c), fract(px)), fract(py)))
}
function straight(pixel: number[]): Rgb { return pixel[3] <= 1e-5 ? [0, 0, 0] : pixel.slice(0, 3).map(x => x / pixel[3]) as Rgb }

function evaluate(pass: AdjustmentPass, source: AdjustmentPixels, original: AdjustmentPixels, mask: AdjustmentPixels, u: number, v: number, lut: CubeLut | undefined, coordinates: AdjustmentCoordinates | undefined, uniforms: { a: Float32Array; b: Float32Array; c: Float32Array }): number[] {
  const c = sample(source, u, v); const alpha = c[3]; let rgb = straight(c)
  const { a, b, c: d } = uniforms
  switch (pass.entry) {
    case 'copy': return c
    case 'blur': {
      const result = [0, 0, 0, 0]; let total = 0
      for (let i = -a[3]; i <= a[3]; i++) { const w = Math.exp(i * i * -.5 / Math.max(a[2] * a[2], .0001)); const pixel = sample(source, u + a[0] * source.width / (source.fullWidth ?? source.width) * i, v + a[1] * source.height / (source.fullHeight ?? source.height) * i); pixel.forEach((x, channel) => { result[channel] += x * w }); total += w }
      return result.map(x => x / total)
    }
    case 'unsharp': { const base = sample(original, u, v); return [0, 1, 2].map(i => base[i] + (base[i] - c[i]) * a[0]).concat(base[3]) }
    case 'color_grade_linear': rgb = map(rgb, linear); break
    case 'color_grade_basic': {
      rgb = map(rgb, (x, i) => encoded(linear(x) * a[i])); const y = clamp(luma(rgb)); const w = weights(rgb)
      const offset = b[0] * w[2] * .25 + b[1] * w[0] * .25 + b[2] * y ** 4 * .25 + b[3] * (1 - y) ** 4 * .25
      rgb = map(rgb, x => (x - .5) * a[3] + .5 + offset); const saturation = Math.max(...rgb) - Math.min(...rgb); const y2 = luma(rgb)
      rgb = map(rgb, x => mix(y2, x, Math.max(0, 1 + d[0] + d[1] * (1 - clamp(saturation))))); break
    }
    case 'color_grade_creative': { const w = weights(rgb); const shadow = tint(a[1]); const high = tint(a[3]); rgb = map(rgb, (x, i) => mix(x, x * .75 + .125, a[0]) + shadow[i] * a[2] * w[0] * .25 + high[i] * b[0] * w[2] * .25); break }
    case 'color_grade_curve': if (pass.lookup?.kind === 'curve') rgb = map(rgb, (x, i) => b[1] === 0 || i === b[1] - 1 ? curve(pass.lookup!.kind === 'curve' ? pass.lookup!.data : new Float32Array(), x) : x); break
    case 'color_grade_hue_curve': {
      if (pass.lookup?.kind !== 'curve') throw new Error('曲线数据缺失')
      const chroma = Math.max(...rgb) - Math.min(...rgb); let light = (Math.max(...rgb) + Math.min(...rgb)) * .5; let sat = chroma / Math.max(1e-6, 1 - Math.abs(2 * light - 1)); let h = hue(rgb)
      const amount = (curve(pass.lookup.data, a[0] === 3 ? clamp(light) : a[0] === 4 ? clamp(sat) : h) - .5) * 2
      if (a[0] === 1) h = fract(h + amount * .5 + 1)
      else if (a[0] === 2) light = clamp(light + amount * .5 * Math.min(1, chroma * 100))
      else sat = clamp(sat * Math.max(0, 1 + amount))
      rgb = map(hueBase(h), x => (x - .5) * (1 - Math.abs(2 * light - 1)) * sat + light); break
    }
    case 'color_grade_wheel': { const w = weights(rgb)[a[3]]; const t = tint(a[0]); rgb = map(rgb, (x, i) => x + (t[i] * a[1] + a[2]) * .25 * w); break }
    case 'color_grade_lut': if (!lut) throw new Error('颜色查找表资源缺失'); else { const mapped = sampleCubeLut(lut, rgb); rgb = map(rgb, (x, i) => mix(x, mapped[i], a[0])); break }
    case 'color_grade_hsl_key': {
      rgb = map(rgb, x => clamp(x)); const chroma = Math.max(...rgb) - Math.min(...rgb); const light = (Math.max(...rgb) + Math.min(...rgb)) * .5; const sat = clamp(chroma / Math.max(1e-6, 1 - Math.abs(2 * light - 1)))
      let w = hueRange(hue(rgb), a[0], a[1], a[2]) * range(sat, b[0], b[1], b[2]) * range(light, d[0], d[1], d[2])
      if (chroma < 1e-6 && !(a[0] === 0 && a[1] === 1)) w = 0
      if (a[3] > .5) w = 1 - w
      if (alpha <= 1e-5) w = 0
      return [w, w, w, 1]
    }
    case 'color_grade_hsl_correct': {
      const w = clamp(sample(original, u, v)[0]); if (d[0] > .5) return [w * alpha, w * alpha, w * alpha, alpha]
      if (w <= 0 || alpha <= 1e-5) return c
      const base = map(rgb, linear); const mid = weights(rgb)[1]; rgb = map(base, (x, i) => (x * a[i] - .21404114) * a[3] + .21404114)
      const y = luma(rgb); const t = tint(b[1]); rgb = map(rgb, (x, i) => encoded(mix(base[i], mix(y, x, Math.max(0, 1 + b[0])) + (t[i] * b[2] + b[3]) * .25 * mid, w))); break
    }
    case 'color_grade_hsl_sharpen': { const base = sample(original, u, v); const w = clamp(sample(mask, u, v)[0]); const color = map(straight(base), linear); const blurred = straight(c); rgb = map(color, (x, i) => encoded(x + (x - blurred[i]) * a[0] * w)); return rgb.map(x => x * base[3]).concat(base[3]) }
    case 'color_grade_vignette': { if (coordinates && !source.fullWidth) { u = (u * source.width + coordinates.origin[0]) / coordinates.size[0]; v = (v * source.height + coordinates.origin[1]) / coordinates.size[1] } const distance = Math.hypot((u - .5) * 2 * mix(1, b[0], a[2]), (v - .5) * 2) / 1.41421356; const amount = smooth(a[1] * .8, a[1] * .8 + Math.max(.01, a[3]), distance) * Math.abs(a[0]); rgb = map(rgb, x => a[0] > 0 ? x + (1 - x) * amount : x * (1 - amount)); break }
  }
  return rgb.map(x => x * alpha).concat(alpha)
}

/** Float32 premultiplied encoded-sRGB backend. Only the workspace adapter handles working primaries. */
export function executeColorGradeCpuPlan(plan: AdjustmentPlan, input: AdjustmentPixels, luts: ReadonlyMap<string, CubeLut> = new Map(), coordinates?: AdjustmentCoordinates): AdjustmentPixels {
  const originalInput: AdjustmentPixels = coordinates ? { ...input, fullWidth: coordinates.size[0], fullHeight: coordinates.size[1], origin: coordinates.origin } : input
  const outputs = new Map<number | string, AdjustmentPixels>([['input', originalInput]])
  for (const pass of plan.passes) {
    const source = outputs.get(pass.source)!; const original = outputs.get(pass.original ?? 'input')!; const mask = outputs.get(pass.mask ?? 'input')!
    const width = pass.uniforms[0]; const height = pass.uniforms[1]; const data = new Float32Array(width * height * 4)
    const lut = pass.lookup?.kind === 'cube' ? luts.get(pass.lookup.ref) : undefined
    const uniforms = { a: pass.uniforms.subarray(4, 8), b: pass.uniforms.subarray(8, 12), c: pass.uniforms.subarray(12, 16) }
    const downsampleX = pass.entry === 'copy' && width < source.width
    const downsampleY = pass.entry === 'copy' && height < source.height
    const fullWidth = !coordinates ? width : downsampleX ? Math.ceil((source.fullWidth ?? source.width) / 2) : width > source.width ? coordinates.size[0] : source.fullWidth ?? width
    const fullHeight = !coordinates ? height : downsampleY ? Math.ceil((source.fullHeight ?? source.height) / 2) : height > source.height ? coordinates.size[1] : source.fullHeight ?? height
    const origin: readonly [number, number] = coordinates ? [Math.floor(coordinates.origin[0] * fullWidth / coordinates.size[0]), Math.floor(coordinates.origin[1] * fullHeight / coordinates.size[1])] : [0, 0]
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(evaluate(pass, source, original, mask, (origin[0] + x + .5) / fullWidth, (origin[1] + y + .5) / fullHeight, lut, coordinates, uniforms), (y * width + x) * 4)
    outputs.set(pass.target, { width, height, data, ...(coordinates ? { fullWidth, fullHeight, origin } : {}) })
  }
  return outputs.get('output')!
}
export function applyColorGradeCpu(input: AdjustmentPixels, params: Readonly<Record<string, unknown>>, luts?: ReadonlyMap<string, CubeLut>, coordinates?: AdjustmentCoordinates): AdjustmentPixels {
  return executeColorGradeCpuPlan(planColorGrade(params, input.width, input.height, coordinates?.size), input, luts, coordinates)
}
