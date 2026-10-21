import { linearSrgbToOklab, linearSrgbToXyz, luminance, MIDDLE_GRAY, srgbToLinear, TINT_DUV_PER_UNIT, xyToKelvinDuv, xyzToXy, type Vec3 } from './colorScience'

/**
 * Color readout shared by the scopes (histogram, waveform, vectorscope) and the assistant's color observation.
 * Input: straight sRGB-encoded RGBA, already downsampled (≈256 px long edge). Everything is in semantic units:
 * EV, percent of pixels, perceptual percent (0–100 on the display scale), kelvin, OkLCh chroma.
 */
export interface ColorReadout {
  exposure: { middleGrayOffsetEv: number; key: 'low' | 'normal' | 'high' }
  clipping: { highlightsPercent: number; shadowsPercent: number }
  tone: { p2: number; p50: number; p98: number }
  whiteBalance: { kelvin: number; tint: number; confidence: number; neutralPercent: number }
  color: { chromaMedian: number; chromaP95: number; oversaturatedPercent: number; palette: Array<{ hex: string; percent: number }> }
  skin: { candidatePercent: number; hueOffsetDegrees: number | null }
}
export interface ColorScopes {
  /** 64 bins each over 0–1 display values, normalized to the largest bin. */
  histogram: { luma: number[]; red: number[]; green: number[]; blue: number[] }
  /** Luma waveform: `columns` × `levels` densities (column-major, bottom level first), normalized 0–1. */
  waveform: { columns: number; levels: number; density: number[] }
  /** OkLab a/b density on a `size`² grid centered on neutral, covering ±`range` chroma; normalized 0–1. */
  vectorscope: { size: number; range: number; density: number[] }
}
export interface ColorStatistics { width: number; height: number; samples: number; readout: ColorReadout; scopes?: ColorScopes }

const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x))
const round = (x: number, digits = 2): number => { const f = 10 ** digits; return Math.round(x * f) / f }
const SKIN_HUE = 55
function quantile(sorted: Float32Array, q: number): number { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] : 0 }
function normalize(values: Float64Array | Uint32Array): number[] { let max = 0; for (const v of values) max = Math.max(max, v); return Array.from(values, v => max ? round(v / max, 3) : 0) }
const hex = (rgb: readonly number[]): string => `#${rgb.map(x => Math.round(clamp(x) * 255).toString(16).padStart(2, '0')).join('')}`

/** `scale`: 255 for 8-bit pixels, 1 for float. `scopes` adds the display arrays (heavier JSON). */
export function computeColorStatistics(pixels: ArrayLike<number>, width: number, height: number, options: { scale?: number; scopes?: boolean } = {}): ColorStatistics {
  const scale = options.scale ?? 255
  if (!(width > 0 && height > 0) || pixels.length < width * height * 4) throw new Error('颜色统计需要有效的 RGBA 画面。')
  const count = width * height
  const perceptual = new Float32Array(count); const chroma = new Float32Array(count)
  let samples = 0; let logSum = 0; let highlights = 0; let shadows = 0; let oversaturated = 0
  const neutral = [0, 0, 0]; let neutralCount = 0; const linear = new Float32Array(count * 3); const peak = new Float32Array(count)
  let skinCount = 0; const skinHues: number[] = []
  const palette = new Map<number, { sum: Vec3; n: number }>()
  const scopes = options.scopes ? { luma: new Float64Array(64), red: new Float64Array(64), green: new Float64Array(64), blue: new Float64Array(64), waveform: new Float64Array(64 * 48), vector: new Float64Array(48 * 48) } : undefined
  for (let i = 0; i < count; i++) {
    const a = pixels[i * 4 + 3] / scale
    if (a < .5) continue
    const encoded: Vec3 = [pixels[i * 4] / scale, pixels[i * 4 + 1] / scale, pixels[i * 4 + 2] / scale]
    const lin = encoded.map(x => srgbToLinear(clamp(x))) as Vec3
    const y = luminance(lin); const p = encoded[0] * .2126 + encoded[1] * .7152 + encoded[2] * .0722
    perceptual[samples] = clamp(p)
    logSum += Math.log(Math.max(1e-4, y))
    if (Math.max(...encoded) >= .99) highlights++
    if (Math.max(...encoded) <= .02) shadows++
    const lab = linearSrgbToOklab(lin); const c = Math.hypot(lab[1], lab[2]); chroma[samples] = c
    if (c > .25) oversaturated++
    // Neutral candidates for the illuminant: low relative chroma, neither crushed nor clipped (OpenCV gray-world rejection).
    if (c / Math.max(.05, lab[0]) < .18 && Math.max(...encoded) < .97 && Math.max(...encoded) > .05) { lin.forEach((x, k) => { neutral[k] += x }); neutralCount++ }
    linear.set(lin, samples * 3); peak[samples] = Math.max(...encoded)
    const hue = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360
    if (lab[0] > .35 && lab[0] < .9 && c > .03 && c < .16 && hue > 25 && hue < 85) { skinCount++; skinHues.push(hue) }
    const key = (Math.round(clamp(encoded[0]) * 7) << 6) | (Math.round(clamp(encoded[1]) * 7) << 3) | Math.round(clamp(encoded[2]) * 7)
    const bucket = palette.get(key) ?? { sum: [0, 0, 0], n: 0 }; bucket.sum = bucket.sum.map((x, k) => x + encoded[k]) as Vec3; bucket.n++; palette.set(key, bucket)
    if (scopes) {
      const bin = (x: number): number => Math.min(63, Math.max(0, Math.floor(x * 64)))
      scopes.luma[bin(p)]++; scopes.red[bin(encoded[0])]++; scopes.green[bin(encoded[1])]++; scopes.blue[bin(encoded[2])]++
      const column = Math.min(63, Math.floor((i % width) / width * 64)); const level = Math.min(47, Math.max(0, Math.floor(clamp(p) * 48)))
      scopes.waveform[column * 48 + level]++
      const range = .32; const vx = Math.floor((lab[1] / range * .5 + .5) * 48); const vy = Math.floor((lab[2] / range * .5 + .5) * 48)
      if (vx >= 0 && vx < 48 && vy >= 0 && vy < 48) scopes.vector[vy * 48 + vx]++
    }
    samples++
  }
  if (samples < 8) throw new Error('画面几乎全透明，无法统计颜色。')
  const sortedP = perceptual.slice(0, samples).sort(); const sortedC = chroma.slice(0, samples).sort()
  const logAverage = Math.exp(logSum / samples)
  const middleGrayOffsetEv = Math.log2(logAverage / MIDDLE_GRAY)
  // Key from the median vs. the log average: intentional low/high key keeps most mass away from the middle.
  const p50 = quantile(sortedP, .5)
  const key = p50 < .25 && quantile(sortedP, .9) < .55 ? 'low' : p50 > .7 && quantile(sortedP, .1) > .45 ? 'high' : 'normal'
  const estimate = (sum: number[]): { kelvin: number; duv: number } | undefined => sum.every(x => x > 1e-9) ? xyToKelvinDuv(...xyzToXy(linearSrgbToXyz(sum))) : undefined
  const grayWorld = neutralCount >= 8 ? estimate(neutral) : undefined
  // White patch: the brightest 5% that is not clipped (a clipped channel no longer carries the light's color).
  const threshold = quantile(sortedP, .95); const bright = [0, 0, 0]; let brightCount = 0
  for (let i = 0; i < samples; i++) if (perceptual[i] >= threshold && peak[i] < .99) { for (let k = 0; k < 3; k++) bright[k] += linear[i * 3 + k]; brightCount++ }
  const whitePatch = brightCount >= 8 ? estimate(bright) : undefined
  const light = grayWorld ?? whitePatch ?? { kelvin: 6500, duv: 0 }
  const neutralShare = neutralCount / samples
  const agreement = grayWorld && whitePatch ? Math.exp(-Math.abs(1e6 / grayWorld.kelvin - 1e6 / whitePatch.kelvin) / 40) : .5
  const confidence = clamp(Math.min(1, neutralShare / .3) * (.4 + .6 * agreement))
  const paletteEntries = [...palette.values()].sort((a, b) => b.n - a.n).slice(0, 5).map(entry => ({ hex: hex(entry.sum.map(x => x / entry.n)), percent: round(entry.n / samples * 100, 1) }))
  skinHues.sort((a, b) => a - b)
  const readout: ColorReadout = {
    exposure: { middleGrayOffsetEv: round(middleGrayOffsetEv), key },
    clipping: { highlightsPercent: round(highlights / samples * 100), shadowsPercent: round(shadows / samples * 100) },
    tone: { p2: round(quantile(sortedP, .02) * 100, 1), p50: round(p50 * 100, 1), p98: round(quantile(sortedP, .98) * 100, 1) },
    whiteBalance: { kelvin: Math.round(clamp(light.kelvin, 2000, 20000)), tint: round(clamp(light.duv / TINT_DUV_PER_UNIT, -100, 100), 1), confidence: round(confidence), neutralPercent: round(neutralShare * 100, 1) },
    color: { chromaMedian: round(quantile(sortedC, .5), 3), chromaP95: round(quantile(sortedC, .95), 3), oversaturatedPercent: round(oversaturated / samples * 100), palette: paletteEntries },
    skin: { candidatePercent: round(skinCount / samples * 100, 1), hueOffsetDegrees: skinCount >= 16 ? round(skinHues[Math.floor(skinHues.length / 2)] - SKIN_HUE, 1) : null },
  }
  return {
    width, height, samples, readout,
    ...(scopes ? { scopes: {
      histogram: { luma: normalize(scopes.luma), red: normalize(scopes.red), green: normalize(scopes.green), blue: normalize(scopes.blue) },
      waveform: { columns: 64, levels: 48, density: normalize(scopes.waveform) },
      vectorscope: { size: 48, range: .32, density: normalize(scopes.vector) },
    } } : {}),
  }
}
